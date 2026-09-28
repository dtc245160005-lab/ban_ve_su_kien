require('dotenv').config();
const db = require('./db');
const { getRedis, closeRedis } = require('./lib/redis');
const createApp = require('./app');

async function start(options = {}) {
  const port = options.port !== undefined ? options.port : (process.env.PORT || 8090);
  let redis = null;

  // 1. Kiểm tra kết nối cơ sở dữ liệu
  try {
    await db.raw('SELECT 1');
    console.log('✅ Đã kết nối cơ sở dữ liệu thành công!');
  } catch (err) {
    console.error('❌ Khởi động thất bại: Không thể kết nối cơ sở dữ liệu.');
    throw new Error('Database connection failed', { cause: err });
  }

  // 2. Kết nối và kiểm tra Redis
  try {
    redis = await getRedis(options.redisUrl);
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error('Redis ping response invalid');
    }
    console.log('✅ Đã kết nối Redis thành công!');
  } catch (err) {
    console.error('❌ Khởi động thất bại: Không thể kết nối Redis.');
    if (redis && redis.isOpen) {
      await closeRedis();
    }
    throw new Error('Redis connection failed', { cause: err });
  }

  // 3. Khởi tạo Express app và bắt đầu lắng nghe
  const app = options.app || createApp(options);
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, () => {
      const address = s.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      console.log(`Server API đang chạy tại http://localhost:${actualPort}`);
      resolve(s);
    });
    s.once('error', reject);
  });

  return server;
}

if (require.main === module) {
  start()
    .then((server) => {
      const shutdown = async (signal) => {
        console.log(`\nNhận tín hiệu ${signal}, đang tiến hành tắt máy chủ...`);
        try {
          await new Promise((resolve) => server.close(resolve));
          console.log('Đã đóng HTTP server.');
        } catch (err) {
          console.error('Lỗi khi đóng HTTP server:', err.message);
        }
        try {
          await closeRedis();
          console.log('Đã ngắt kết nối Redis.');
        } catch (err) {
          console.error('Lỗi khi ngắt kết nối Redis:', err.message);
        }
        try {
          await db.destroy();
          console.log('Đã đóng kết nối cơ sở dữ liệu.');
        } catch (err) {
          console.error('Lỗi khi đóng kết nối Knex:', err.message);
        }
        process.exit(0);
      };

      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));
    })
    .catch((_err) => {
      console.error('Khởi động ứng dụng thất bại.');
      process.exit(1);
    });
}

module.exports = Object.assign(start, { start });