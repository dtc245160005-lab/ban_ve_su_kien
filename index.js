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
// API: Kiểm tra lượt giữ chỗ hiện tại còn hiệu lực hay không (Task S-14)
app.get('/api/reservations/check/:id', async (req, res) => {
  try {
    const reservationId = req.params.id;

    // 1. Tìm thông tin giữ chỗ trong database
    const reservation = await db('reservations').where({ id: reservationId }).first();

    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy lượt giữ chỗ' });
    }

    // 2. Tính thời gian còn hiệu lực
    const now = new Date();
    const expiresAt = new Date(reservation.expires_at);
    const remainingSeconds = Math.floor((expiresAt - now) / 1000);

    // 3. Nếu đã hết thời gian giữ chỗ
    if (remainingSeconds <= 0) {
      await db('reservations').where({ id: reservationId }).update({ status: 'expired' });
      return res.json({ success: false, expired: true, message: 'Lượt giữ chỗ đã hết hạn' });
    }

    // 4. Lấy danh sách ID ghế thuộc lượt giữ chỗ
    const seats = await db('reservation_seats')
      .where({ reservation_id: reservationId })
      .pluck('seat_id');

    return res.json({
      success: true,
      expired: false,
      reservationId: reservation.id,
      seats: seats,
      remainingSeconds: remainingSeconds
    });
  } catch (error) {
    console.error('Lỗi check reservation:', error);
    return res.status(500).json({ success: false, error: error.message });
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