const db = require('../db');
const { ALL } = require('./showtimeStatus');

class ShowtimeStatusService {
  async changeShowtimeStatus(showtimeId, newStatus, user) {
    if (!showtimeId) {
      const err = new Error('Showtime ID is required');
      err.statusCode = 400;
      throw err;
    }

    // 1. Kiểm tra trạng thái hợp lệ (nếu không thuộc ALL ném 409)
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
      const isAdmin = user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin'));
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

    const updated = await db('showtimes').where({ id: showtimeId }).first();
    return updated;
  }

  async updateStatus(showtimeId, newStatus, user) {
    return this.changeShowtimeStatus(showtimeId, newStatus, user);
  }
}

const service = new ShowtimeStatusService();

module.exports = {
  changeShowtimeStatus: (showtimeId, newStatus, user) => service.changeShowtimeStatus(showtimeId, newStatus, user),
  showtimeStatusService: service
};
