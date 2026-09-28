require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./db');
const { getRedis } = require('./lib/redis');
const authRouter = require('./routes/auth');

const app = express();
const port = process.env.PORT || 8090;

// Cấu hình trust proxy theo biến môi trường TRUST_PROXY (mặc định: false)
const trustProxyEnv = process.env.TRUST_PROXY;
let trustProxy = false;
if (trustProxyEnv === 'true') {
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes xác thực
app.use('/api/auth', authRouter);

// API 1: Lấy danh sách sự kiện
app.get('/api/events', async (req, res) => {
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

if (require.main === module) {
  app.listen(port, async () => {
    console.log(`Server API đang chạy tại http://localhost:${port}`);
    try {
      await db.raw('SELECT 1');
      console.log('✅ Đã kết nối PostgreSQL thành công!');
    } catch (err) {
      console.error('❌ Lỗi kết nối PostgreSQL:', err.message);
    }
    try {
      await getRedis();
      console.log('✅ Đã kết nối Redis thành công!');
    } catch (err) {
      console.error('❌ Lỗi kết nối Redis:', err.message);
    }
  });
}

module.exports = app;