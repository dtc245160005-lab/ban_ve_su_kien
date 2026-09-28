const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redisClient = createClient({
  url: redisUrl,
});

redisClient.on('error', (error) => {
  console.error('Redis error:', error.message);
});

let connectPromise = null;

function getRedis() {
  if (redisClient.isOpen) {
    return Promise.resolve(redisClient);
  }
  if (!connectPromise) {
    connectPromise = redisClient
      .connect()
      .then(() => redisClient)
      .catch((err) => {
        connectPromise = null;
        throw err;
      });
  }
  return connectPromise;
}

module.exports = {
  getRedis,
  redisClient,
};
