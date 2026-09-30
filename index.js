require('dotenv').config();
const db = require('./db');
const { getRedis, closeRedis } = require('./lib/redis');
const createApp = require('./app');
const { createExpiredSeatHoldsJob } = require('./jobs/expiredSeatHolds');

async function start(options = {}) {
  const port = options.port !== undefined ? options.port : (process.env.PORT || 8090);
  let redis = null;
  let backgroundJobs = null;

  // 1. Kiểm tra kết nối cơ sở dữ liệu
  try {
    await db.raw('SELECT 1');
    console.log('[DB] Kết nối cơ sở dữ liệu thành công.');
  } catch (err) {
    console.error('[DB] Khởi động thất bại: Không thể kết nối cơ sở dữ liệu.');
    throw new Error('Database connection failed', { cause: err });
  }

  // 2. Kết nối và kiểm tra Redis
  try {
    redis = await getRedis(options.redisUrl);
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error('Redis ping response invalid');
    }
    console.log('[Redis] Kết nối Redis thành công.');
  } catch (err) {
    console.error('[Redis] Khởi động thất bại: Không thể kết nối Redis.');
    if (redis && redis.isOpen) {
      await closeRedis();
    }
    throw new Error('Redis connection failed', { cause: err });
  }

  // 3. Kiểm tra cấu hình email service
  try {
    const emailService = options.emailService || require('./services/emailService');
    emailService.assertConfiguration();
  } catch (err) {
    console.error(`[Email] Khởi động thất bại: ${err.message}`);
    if (redis && redis.isOpen) {
      await closeRedis();
    }
    throw err;
  }

  // 4. Dọn dữ liệu quá hạn trước khi nhận request, sau đó chạy mỗi phút.
  if (options.backgroundJobsEnabled !== false) {
    try {
      backgroundJobs = options.backgroundJobs || createExpiredSeatHoldsJob({ db });
      await backgroundJobs.start();
    } catch (err) {
      console.error('[Jobs] Khởi động thất bại: Không thể dọn giữ chỗ quá hạn.');
      if (redis && redis.isOpen) await closeRedis();
      throw new Error('Background jobs failed to start', { cause: err });
    }
  }

  // 5. Khởi tạo Express app và bắt đầu lắng nghe
  const app = options.app || createApp(options);
  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const s = app.listen(port, () => {
        const address = s.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        console.log(`Server API đang chạy tại http://localhost:${actualPort}`);
        resolve(s);
      });
      s.once('error', reject);
    });
  } catch (err) {
    backgroundJobs?.stop();
    throw err;
  }

  server.backgroundJobs = backgroundJobs;
  server.once('close', () => backgroundJobs?.stop());

  return server;
}

if (require.main === module) {
  start()
    .then((server) => {
      const shutdown = async (signal) => {
        console.log(`\nNhận tín hiệu ${signal}, đang tiến hành tắt máy chủ...`);
        server.backgroundJobs?.stop();
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
