const pool = require('../config/db');
const { assertCanManage } = require('./eventService');
const { logEvent } = require('./auditService');
const { DRAFT, ON_SALE, CLOSED, ALL } = require('./showtimeStatus');

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

const VALID_TRANSITIONS = {
  [DRAFT]: [ON_SALE],
  [ON_SALE]: [CLOSED],
  [CLOSED]: [ON_SALE]
};

async function changeShowtimeStatus(showtimeId, target, user) {
  if (!ALL.includes(target)) {
    throw new AppError('Trạng thái không hợp lệ', 409);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Khoá bản ghi showtime với FOR UPDATE OF s
    const stRes = await client.query(
      `SELECT s.id, s.event_id, s.status, e.organizer_id, e.status AS event_status
       FROM showtimes s
       JOIN events e ON s.event_id = e.id
       WHERE s.id = $1
       FOR UPDATE OF s`,
      [showtimeId]
    );

    if (stRes.rows.length === 0) {
      throw new AppError('Không tìm thấy suất diễn', 404);
    }

    const showtime = stRes.rows[0];

    // 2. Kiểm tra quyền sở hữu bằng assertCanManage có sẵn
    if (typeof assertCanManage === 'function') {
      assertCanManage({ organizer_id: showtime.organizer_id }, user);
    } else if (user && user.role !== 'admin' && showtime.organizer_id !== user.id) {
      throw new AppError('Bạn không có quyền quản lý suất diễn này', 403);
    }

    // 3. Kiểm tra chuyển đổi trạng thái hợp lệ
    const allowed = VALID_TRANSITIONS[showtime.status] || [];
    if (!allowed.includes(target)) {
      throw new AppError(`Không thể chuyển trạng thái từ '${showtime.status}' sang '${target}'`, 409);
    }

    // 4. Nếu mở bán (on_sale): tự đếm bảng seats của suất
    if (target === ON_SALE) {
      const seatRes = await client.query(
        'SELECT COUNT(*)::int AS count FROM seats WHERE showtime_id = $1',
        [showtimeId]
      );
      if (!seatRes.rows[0] || seatRes.rows[0].count === 0) {
        throw new AppError('Chưa có sơ đồ ghế', 409);
      }
    }

    // 5. Cập nhật showtimes.status
    await client.query(
      'UPDATE showtimes SET status = $1 WHERE id = $2',
      [target, showtimeId]
    );

    // 6. Mở bán lần đầu: cập nhật events.status sang published
    if (target === ON_SALE && showtime.event_status === 'draft') {
      await client.query(
        "UPDATE events SET status = 'published' WHERE id = $1",
        [showtime.event_id]
      );
    }

    await client.query('COMMIT');

    // 7. Ghi audit log (không log kèm email)
    if (typeof logEvent === 'function') {
      logEvent('showtime_status_changed', {
        showtimeId: Number(showtimeId),
        from: showtime.status,
        to: target,
        userId: user ? user.id : null
      });
    }

    return { id: Number(showtimeId), status: target };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  changeShowtimeStatus
};