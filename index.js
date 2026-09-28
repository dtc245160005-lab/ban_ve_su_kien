require('dotenv').config();
    const express = require('express');
    const db = require('./db');

    const app = express();
    const port = process.env.PORT || 8090;

    // Middleware để đọc dữ liệu dạng JSON từ client gửi lên
    app.use(express.json());

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

    app.listen(port, async () => {
      console.log(`Server API đang chạy tại http://localhost:${port}`);
      try {
        await db.raw('SELECT 1');
        console.log('✅ Đã kết nối PostgreSQL thành công!');
      } catch (err) {
        console.error('❌ Lỗi kết nối PostgreSQL:', err.message);
      }
    });