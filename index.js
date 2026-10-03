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

          // Kiểm tra TẦNG ỨNG DỤNG: lấy trước danh sách ghế trùng để báo lỗi đầy đủ (UX tốt)
          const conflictingHolds = await trx('seat_holds')
            .whereIn('seat_id', seat_ids)
            .andWhere('expires_at', '>', now)
            .andWhere('user_id', '!=', user_id);

          if (conflictingHolds.length > 0) {
            const rejectedSeats = conflictingHolds.map(h => h.seat_id);
            const err = new Error('Ghế vừa có người chọn');
            err.rejected_seats = rejectedSeats;
            throw err;
          }

          // Xóa các bản ghi đã hết hạn của chính các ghế này (nếu có) để dọn dẹp
          // Không xóa của người khác nếu đang còn hạn (DB Trigger sẽ chặn)
          await trx('seat_holds')
            .whereIn('seat_id', seat_ids)
            .andWhere('expires_at', '<=', now)
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
        // T-30: Xử lý lỗi từ tầng ứng dụng
        if (err.message === 'Ghế vừa có người chọn') {
          console.log(`[Tranh chấp giữ chỗ - App] Các ghế bị từ chối: ${err.rejected_seats.join(', ')}`);
          return res.status(409).json({ success: false, message: err.message, rejected_seats: err.rejected_seats });
        }
        
        // T-30: Xử lý lỗi từ tầng CƠ SỞ DỮ LIỆU (Trigger quăng ra trong trường hợp race condition)
        if (err.message && err.message.includes('seat_already_held_active:')) {
          const seat_id = err.message.split('seat_already_held_active:')[1].split('"')[0].trim();
          console.log(`[Tranh chấp giữ chỗ - DB] Ghế bị từ chối do race condition: ${seat_id}`);
          return res.status(409).json({ success: false, message: 'Ghế vừa có người chọn', rejected_seats: [seat_id] });
        }

        res.status(500).json({ success: false, message: err.message });
      }
    });

    // API 4: Tạo đơn hàng từ các ghế đang giữ (T-37)
    app.post('/api/orders', async (req, res) => {
      const { user_id, event_id } = req.body;
      if (!user_id || !event_id) {
        return res.status(400).json({ success: false, message: 'Thiếu user_id hoặc event_id' });
      }

      try {
        const result = await db.transaction(async (trx) => {
          // Khóa giao dịch cho user này để chống race condition khi bấm đúp
          await trx.raw('SELECT pg_advisory_xact_lock(?)', [user_id]);

          // Kiểm tra xem đã có đơn chờ chưa
          const existingOrder = await trx('orders')
            .where({ user_id, event_id, status: 'chờ' })
            .first();

          if (existingOrder) {
            const items = await trx('order_items').where({ order_id: existingOrder.id });
            return { is_existing: true, order: existingOrder, items };
          }

          const now = new Date();

          // Đọc giữ chỗ còn hiệu lực
          const activeHolds = await trx('seat_holds')
            .where('user_id', user_id)
            .andWhere('expires_at', '>', now);

          if (activeHolds.length === 0) {
            // Giữ chỗ hết hạn hoặc không có
            const err = new Error('Giữ chỗ đã hết hạn hoặc không tồn tại');
            err.code = 409;
            throw err;
          }

          // Lấy thông tin sự kiện để lấy giá
          const event = await trx('events').where({ id: event_id }).first();
          if (!event) {
            throw new Error('Không tìm thấy sự kiện');
          }
          
          const price = event.price;
          const total_amount = price * activeHolds.length;

          // Gia hạn giữ chỗ thêm 15 phút cho thời hạn thanh toán
          const expiresAt = new Date(now.getTime() + 15 * 60000);
          
          await trx('seat_holds')
            .where('user_id', user_id)
            .update({ expires_at: expiresAt });

          // Tạo đơn hàng
          const [order] = await trx('orders')
            .insert({
              user_id,
              event_id,
              status: 'chờ',
              total_amount,
              expires_at: expiresAt
            })
            .returning('*');

          // Tạo order items
          const orderItemsData = activeHolds.map(hold => ({
            order_id: order.id,
            seat_id: hold.seat_id,
            price_at_booking: price
          }));

          const items = await trx('order_items').insert(orderItemsData).returning('*');

          return { is_existing: false, order, items };
        });

        res.status(200).json({ success: true, data: result });
      } catch (err) {
        if (err.code === 409) {
          return res.status(409).json({ success: false, message: err.message, lost_seats: [] });
        }
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