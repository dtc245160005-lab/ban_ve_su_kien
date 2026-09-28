const { createClient } = require('redis');

let currentClient = null;
let currentUrl = null;
let connectPromise = null;

function getClient(targetUrl) {
  const envUrl = process.env.REDIS_URL;
  const validEnvUrl = envUrl && envUrl !== 'undefined' ? envUrl : null;
  const url = targetUrl || validEnvUrl || 'redis://localhost:6379';

  if (currentClient && (currentUrl !== url || (!currentClient.isOpen && !connectPromise))) {
    if (currentClient.isOpen) {
      currentClient.quit().catch(() => {});
    }
    currentClient = null;
    connectPromise = null;
  }
  if (!currentClient) {
    currentUrl = url;
    currentClient = createClient({
      url,
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: (retries) => {
          if (retries > 2) {
            return new Error('Redis connection failed');
          }
          return Math.min(retries * 50, 200);
        },
      },
    });
    currentClient.on('error', (error) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('Redis error:', error.message);
      }
    });
  }
  return currentClient;
}

const redisClient = new Proxy({}, {
  get(_target, prop) {
    const client = getClient();
    const val = client[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  },
});

function getRedis(url) {
  const client = getClient(url);
  if (client.isOpen) {
    return Promise.resolve(client);
  }
  if (!connectPromise) {
    connectPromise = client
      .connect()
      .then(() => client)
      .catch(async (err) => {
        connectPromise = null;
        currentClient = null;
        try {
          await client.disconnect().catch(() => {});
        } catch {
          // Bỏ qua lỗi ngắt kết nối
        }
        throw err;
      });
  }
  return connectPromise;
}

async function closeRedis() {
  if (currentClient) {
    if (currentClient.isOpen) {
      try {
        await currentClient.quit();
      } catch {
        try {
          currentClient.disconnect();
        } catch {
          // Bỏ qua lỗi đóng kết nối
        }
      }
    }
  }
  currentClient = null;
  connectPromise = null;
  currentUrl = null;
}

module.exports = {
  getRedis,
  redisClient,
  closeRedis,
};
