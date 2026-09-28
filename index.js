require('dotenv').config();
    const express = require('express');
    const db = require('./db');

    const app = express();
    const port = process.env.PORT || 8090;

    // Middleware để đọc dữ liệu dạng JSON từ client gửi lên
    app.use(express.json());

    // Cung cấp giao diện frontend tĩnh
    app.use(express.static('public'));

    // API: Lấy thời gian server để đồng bộ độ lệch giờ (T-24)
    app.get('/api/time', (req, res) => {
      res.json({ server_time: new Date().toISOString() });
    });

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

    // API 3: Giữ chỗ ghế (T-23)
    app.post('/api/seat-holds', async (req, res) => {
      const { seat_ids, user_id } = req.body;
      if (!seat_ids || !Array.isArray(seat_ids) || seat_ids.length === 0 || !user_id) {
        return res.status(400).json({ success: false, message: 'Thiếu thông tin ghế hoặc user_id' });
      }

      const HOLD_MINUTES = 10;

      try {
        const result = await db.transaction(async (trx) => {
          const now = new Date();

          // Kiểm tra xem user hiện tại đã có giữ chỗ nào còn hạn không
          const existingUserHold = await trx('seat_holds')
            .where('user_id', user_id)
            .andWhere('expires_at', '>', now)
            .first();

          let expiresAt;
          if (existingUserHold) {
            expiresAt = existingUserHold.expires_at; // Dùng chung thời hạn lượt hiện tại
          } else {
            expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60000);
          }

          // Kiểm tra xem ghế đã bị user khác giữ hay chưa
          const conflictingHolds = await trx('seat_holds')
            .whereIn('seat_id', seat_ids)
            .andWhere('expires_at', '>', now)
            .andWhere('user_id', '!=', user_id);

          if (conflictingHolds.length > 0) {
            throw new Error('Ghế vừa có người chọn');
          }

          // Xóa giữ chỗ cũ (nếu có) của user hiện tại với những ghế này để tránh lỗi unique constraint
          await trx('seat_holds')
            .whereIn('seat_id', seat_ids)
            .del();

          const newHolds = seat_ids.map(seat_id => ({
            seat_id,
            user_id,
            expires_at: expiresAt
          }));

          await trx('seat_holds').insert(newHolds);

          return { expires_at: expiresAt };
        });

        res.status(200).json({ success: true, data: result });
      } catch (err) {
        if (err.message === 'Ghế vừa có người chọn') {
          res.status(409).json({ success: false, message: err.message });
        } else {
          res.status(500).json({ success: false, message: err.message });
        }
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