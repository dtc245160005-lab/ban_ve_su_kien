const pool = require('../config/db');

const DRAFT = 'draft';
const ON_SALE = 'on_sale';
const CLOSED = 'closed';
const ALL = [DRAFT, ON_SALE, CLOSED];

async function countSeatsByShowtimeId(client, showtimeId) {
  const res = await client.query('SELECT COUNT(*) FROM seats WHERE showtime_id = $1', [showtimeId]);
  return parseInt(res.rows[0].count, 10);
}

async function updateShowtimeStatus(showtimeId, newStatus, userId) {
  if (!ALL.includes(newStatus)) {
    throw new Error('Trạng thái không hợp lệ');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const showtimeRes = await client.query(
      `SELECT s.id, s.event_id, s.status, e.organizer_id, e.status AS event_status
       FROM showtimes s
       JOIN events e ON s.event_id = e.id
       WHERE s.id = $1`,
      [showtimeId]
    );

    if (showtimeRes.rows.length === 0) {
      throw new Error('Không tìm thấy suất diễn');
    }

    const showtime = showtimeRes.rows[0];

    if (userId && showtime.organizer_id !== userId) {
      throw new Error('Bạn không có quyền chỉnh sửa');
    }

    if (newStatus === ON_SALE) {
      const seatCount = await countSeatsByShowtimeId(client, showtimeId);
      if (seatCount === 0) {
        throw new Error('Chưa có sơ đồ ghế, không thể mở bán');
      }
    }

    await client.query(
      'UPDATE showtimes SET status = $1 WHERE id = $2',
      [newStatus, showtimeId]
    );

    if (newStatus === ON_SALE && showtime.event_status === 'draft') {
      await client.query(
        "UPDATE events SET status = 'published' WHERE id = $1",
        [showtime.event_id]
      );
    }

    await client.query('COMMIT');
    return { success: true, showtimeId, status: newStatus };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function validateReloadSeats(showtimeId) {
  const res = await pool.query('SELECT status FROM showtimes WHERE id = $1', [showtimeId]);
  if (res.rows.length > 0 && res.rows[0].status === ON_SALE) {
    throw new Error('Suất đang mở bán (on_sale), không được nạp lại sơ đồ ghế');
  }
  return true;
}

module.exports = {
  DRAFT,
  ON_SALE,
  CLOSED,
  ALL,
  updateShowtimeStatus,
  validateReloadSeats
};
