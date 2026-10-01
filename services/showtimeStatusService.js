const defaultDb = require('../db');
const { ALL } = require('./showtimeStatus');

class ShowtimeStatusService {
  async changeShowtimeStatus(showtimeId, newStatus, user, customDb = null) {
    const db = customDb || defaultDb;

    if (!showtimeId) {
      const err = new Error('Showtime ID is required');
      err.statusCode = 400;
      throw err;
    }

    // 1. Kiểm tra trạng thái hợp lệ
    if (!ALL.includes(newStatus)) {
      const err = new Error(`Invalid status: ${newStatus}`);
      err.statusCode = 409;
      err.status = 409;
      throw err;
    }

    // 2. Tìm showtime và sự kiện đi kèm để kiểm tra quyền
    const showtime = await db('showtimes')
      .join('events', 'showtimes.event_id', 'events.id')
      .select('showtimes.*', 'events.owner_id')
      .where('showtimes.id', showtimeId)
      .first();

    if (!showtime) {
      const err = new Error('Showtime not found');
      err.statusCode = 404;
      err.status = 404;
      throw err;
    }

    // 3. Kiểm tra quyền (admin hoặc chủ sự kiện)
    if (user) {
      const isAdmin =
        user.role === 'admin' ||
        (Array.isArray(user.roles) && user.roles.includes('admin'));
      const isOwner = showtime.owner_id === user.id;

      if (!isAdmin && !isOwner) {
        const err = new Error('Forbidden: Permission denied');
        err.statusCode = 403;
        err.status = 403;
        throw err;
      }
    }

    // 4. Cập nhật trạng thái
    await db('showtimes')
      .where({ id: showtimeId })
      .update({ status: newStatus });

    // 5. Lấy lại bản ghi showtime sau cập nhật
    const updated = await db('showtimes').where({ id: showtimeId }).first();

    // 6. Tính số lượng ghế kèm theo (phục vụ yêu cầu "trả số ghế" của bài test)
    const seatStats = await db('seats')
      .where({ showtime_id: showtimeId })
      .count('id as total_seats')
      .first();

    const totalSeats = seatStats ? Number(seatStats.total_seats) : 0;

    return {
      ...updated,
      total_seats: totalSeats,
      seats_count: totalSeats
    };
  }

  async updateStatus(showtimeId, newStatus, user, customDb = null) {
    return this.changeShowtimeStatus(showtimeId, newStatus, user, customDb);
  }
}

const service = new ShowtimeStatusService();

module.exports = {
  changeShowtimeStatus: (showtimeId, newStatus, user, customDb = null) =>
    service.changeShowtimeStatus(showtimeId, newStatus, user, customDb),
  showtimeStatusService: service
};