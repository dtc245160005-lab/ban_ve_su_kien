require('dotenv').config();
const path = require('path');
const express = require('express');
const defaultDb = require('./db');
const { getRedis: defaultGetRedis, redisClient } = require('./lib/redis');
const { createRedisAuthStore } = require('./services/redisAuthStore');
const defaultAuthRouter = require('./routes/auth');
const defaultEventsModule = require('./routes/events');
const { createWorkspaceRouter } = require('./routes/workspaces');
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
      return res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        revision: options.revision || process.env.RENDER_GIT_COMMIT ||
          (process.env.APP_REVISION !== 'unknown' ? process.env.APP_REVISION : null) || null,
      });
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
      resendLimiter: options.resendLimiter,
    });
  authRouter._mountPrefix = '/api/auth';
  app.use('/api/auth', authRouter);

  // Routes sự kiện công khai (chỉ xem các sự kiện đã published)
  const publicEventsRouter =
    options.publicEventsRouter ||
    defaultEventsModule.createPublicEventsRouter({
      db,
      eventService: options.eventService,
    });
  publicEventsRouter._mountPrefix = '/api/events';
  app.use('/api/events', publicEventsRouter);

  // Routes quản lý sự kiện và suất diễn dành cho ban tổ chức và admin
  const organizerEventsRouter =
    options.organizerEventsRouter ||
    defaultEventsModule.createOrganizerEventsRouter({
      db,
      eventService: options.eventService,
    });
  organizerEventsRouter._mountPrefix = '/api/organizer';
  app.use('/api/organizer', organizerEventsRouter);

  const workspaceRouter = options.workspaceRouter || createWorkspaceRouter({
    db,
    staffService: options.staffService,
  });
  workspaceRouter._mountPrefix = '/api/workspaces';
  app.use('/api/workspaces', workspaceRouter);

  // Mặc định đóng: mọi request vào /api/* không khớp route nào đã khai báo thì trả 403
  app.use('/api', apiFallbackForbidden);

  return app;
}

createApp.createApp = createApp;
module.exports = createApp;
