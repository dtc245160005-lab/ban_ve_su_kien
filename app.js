require('dotenv').config();
const path = require('path');
const express = require('express');
const defaultDb = require('./db');
const { getRedis: defaultGetRedis, redisClient } = require('./lib/redis');
const { createRedisAuthStore } = require('./services/redisAuthStore');
const defaultAuthRouter = require('./routes/auth');
const { secure, apiFallbackForbidden } = require('./middleware/routeRegistry');

function createApp(options = {}) {
  const app = express();
  const db = options.db || defaultDb;
  const getRedis = options.getRedis || defaultGetRedis;

  // Cấu hình sessionStore gắn vào app.locals để middleware dùng chung
  if (options.sessionStore) {
    app.locals.sessionStore = options.sessionStore;
  } else if (options.redis) {
    app.locals.sessionStore = createRedisAuthStore(options.redis).sessionStore;
  } else {
    app.locals.sessionStore = createRedisAuthStore(redisClient).sessionStore;
  }

  // Cấu hình trust proxy theo biến môi trường TRUST_PROXY (mặc định: false)
  const trustProxyEnv = options.trustProxy !== undefined ? options.trustProxy : process.env.TRUST_PROXY;
  let trustProxy = false;
  if (trustProxyEnv === true || trustProxyEnv === 'true') {
    trustProxy = true;
  } else if (trustProxyEnv && !Number.isNaN(Number(trustProxyEnv))) {
    trustProxy = Number(trustProxyEnv);
  } else if (trustProxyEnv && trustProxyEnv !== 'false') {
    trustProxy = trustProxyEnv;
  }
  app.set('trust proxy', trustProxy);

  // Middleware để đọc dữ liệu dạng JSON từ client gửi lên
  app.use(express.json({ limit: '20kb' }));

  // Phục vụ tài nguyên tĩnh trong thư mục public
  app.use(express.static(path.join(__dirname, 'public')));

  // Chuyển hướng trang chủ sang giao diện đăng nhập
  app.get('/', (_req, res) => {
    res.redirect('/login.html');
  });

  // Health check endpoint (readiness check thực tế: ping DB và Redis)
  secure(app, 'get', '/health', 'public', async (_req, res) => {
    try {
      await db.raw('SELECT 1');
      const redis = options.redis || (await getRedis());
      const pong = await redis.ping();
      if (pong !== 'PONG') {
        throw new Error('Redis ping not PONG');
      }
      return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch {
      // Không để lộ chi tiết lỗi kỹ thuật
      return res.status(503).json({ status: 'error', message: 'Dịch vụ tạm thời không khả dụng' });
    }
  });

  // Routes xác thực
  const authRouter =
    options.authRouter ||
    defaultAuthRouter.createAuthRouter({
      db,
      redisClient: options.redis || redisClient,
      sessionStore: app.locals.sessionStore,
      activationService: options.activationService,
      emailService: options.emailService,
    });
  authRouter._mountPrefix = '/api/auth';
  app.use('/api/auth', authRouter);

  // API 1: Lấy danh sách sự kiện (public)
  secure(app, 'get', '/api/events', 'public', async (_req, res) => {
    try {
      const events = await db('events').select('*');
      res.status(200).json({ success: true, data: events });
    } catch (err) {
      console.error('Lỗi khi lấy danh sách sự kiện:', err.message);
      res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  // API 2: Thêm mới một sự kiện (organizer, admin)
  secure(app, 'post', '/api/events', { roles: ['organizer', 'admin'] }, async (req, res) => {
    try {
      const { title, description, price, total_tickets } = req.body;
      const [newEvent] = await db('events')
        .insert({ title, description, price, total_tickets })
        .returning('*');
      res.status(201).json({ success: true, data: newEvent });
    } catch (err) {
      console.error('Lỗi khi tạo sự kiện:', err.message);
      res.status(500).json({ success: false, message: 'Hệ thống đang bận. Vui lòng thử lại sau.' });
    }
  });

  // Mặc định đóng: mọi request vào /api/* không khớp route nào đã khai báo thì trả 403
  app.use('/api', apiFallbackForbidden);

  return app;
}

createApp.createApp = createApp;
module.exports = createApp;
