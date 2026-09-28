const SHOWTIME_STATUS = {
  NHAP: 'nháp',
  DANG_BAN: 'đang bán',
  DA_DONG: 'đã đóng',
};

/**
 * Hàm duy nhất chịu trách nhiệm chuyển trạng thái và kiểm tra điều kiện
 * @param {Object} showtime - Đối tượng suất diễn
 * @param {string} targetStatus - Trạng thái đích muốn chuyển tới
 * @param {boolean} hasSeats - Đã có cấu hình sơ đồ ghế hay chưa
 */
function changeShowtimeStatus(showtime, targetStatus, hasSeats = false) {
  if (!showtime) {
    throw new Error('Suất diễn không tồn tại');
  }

  const currentStatus = showtime.status;

  // 1. Chuyển từ 'nháp' sang 'đang bán'
  if (currentStatus === SHOWTIME_STATUS.NHAP) {
    if (targetStatus !== SHOWTIME_STATUS.DANG_BAN) {
      throw new Error(`Không thể chuyển trạng thái từ "${currentStatus}" sang "${targetStatus}"`);
    }

    // Luật nghiệp vụ T-15: Chưa có ghế thì từ chối chuyển
    if (!hasSeats) {
      throw new Error('Chưa có sơ đồ ghế, không thể chuyển sang trạng thái đang bán!');
    }
  } 
  // 2. Chuyển từ 'đang bán' sang 'đã đóng'
  else if (currentStatus === SHOWTIME_STATUS.DANG_BAN) {
    if (targetStatus !== SHOWTIME_STATUS.DA_DONG) {
      throw new Error(`Không thể chuyển trạng thái từ "${currentStatus}" sang "${targetStatus}"`);
    }
  } 
  // 3. Suất diễn đã đóng: không cho phép thay đổi tiếp
  else if (currentStatus === SHOWTIME_STATUS.DA_DONG) {
    throw new Error('Suất diễn đã đóng, không thể thay đổi trạng thái');
  } else {
    throw new Error('Trạng thái hiện tại không hợp lệ');
  }

  // Cập nhật trạng thái
  showtime.status = targetStatus;
  return showtime;
}

module.exports = {
  SHOWTIME_STATUS,
  changeShowtimeStatus,
};