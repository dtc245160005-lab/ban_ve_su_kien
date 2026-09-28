require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./db');
const { getRedis } = require('./lib/redis');
const authRouter = require('./routes/auth');

function createApp(options = {}) {
  const app = express();

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
  app.get('/health', async (_req, res) => {
    try {
      await db.raw('SELECT 1');
      const redis = await getRedis();
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
  app.use('/api/auth', options.authRouter || authRouter);

  // API 1: Lấy danh sách sự kiện
  app.get('/api/events', async (_req, res) => {
    try {
      const events = await db('events').select('*');
      res.status(200).json({ success: true, data: events });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // API 2: Thêm mới một sự kiện
  app.post('/api/events', async (req, res) => {
    try {
      const { title, description, price, total_tickets } = req.body;
      const [newEvent] = await db('events')
        .insert({ title, description, price, total_tickets })
        .returning('*');
      res.status(201).json({ success: true, data: newEvent });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return app;
}

createApp.createApp = createApp;
module.exports = createApp;
