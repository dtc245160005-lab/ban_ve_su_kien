const db = require('../db');

/**
 * Service quản lý trạng thái suất chiếu
 */
class ShowtimeStatusService {
  /**
   * Cập nhật hoặc kiểm tra trạng thái suất chiếu
   * @param {number|string} showtimeId 
   */
  async updateStatus(showtimeId) {
    if (!showtimeId) {
      throw new Error('Showtime ID is required');
    }

    const showtime = await db('showtimes').where({ id: showtimeId }).first();
    if (!showtime) {
      return null;
    }

    return showtime;
  }
}

const service = new ShowtimeStatusService();

module.exports = {
  changeShowtimeStatus: (...args) => service.updateStatus(...args),
  showtimeStatusService: service
};