const { changeShowtimeStatus, SHOWTIME_STATUS } = require('./service');

console.log('====================================');
console.log('   BẮT ĐẦU CHẠY KIỂM THỬ TASK T-15  ');
console.log('====================================');

let passed = 0;
let failed = 0;

// CASE 1: Chuyển 'nháp' -> 'đang bán' khi CHƯA có ghế (Mong đợi: BỊ TỪ CHỐI)
try {
  const showtime1 = { id: 1, name: 'Suất 1', status: SHOWTIME_STATUS.NHAP };
  changeShowtimeStatus(showtime1, SHOWTIME_STATUS.DANG_BAN, false);
  console.log('❌ Case 1 Thất bại: Lẽ ra phải từ chối khi chưa có ghế');
  failed++;
} catch (e) {
  if (e.message.includes('Chưa có sơ đồ ghế')) {
    console.log('✅ Case 1 ĐẠT: Đã từ chối chuyển sang đang bán khi chưa có sơ đồ ghế');
    passed++;
  } else {
    console.log('❌ Case 1 Thất bại với lỗi:', e.message);
    failed++;
  }
}

// CASE 2: Chuyển 'nháp' -> 'đã đóng' sai quy tắc (Mong đợi: BỊ TỪ CHỐI)
try {
  const showtime2 = { id: 2, name: 'Suất 2', status: SHOWTIME_STATUS.NHAP };
  changeShowtimeStatus(showtime2, SHOWTIME_STATUS.DA_DONG, true);
  console.log('❌ Case 2 Thất bại: Không được phép nhảy cóc sang đã đóng');
  failed++;
} catch (e) {
  console.log('✅ Case 2 ĐẠT: Đã chặn cặp chuyển không hợp lệ (nháp -> đã đóng)');
  passed++;
}

// CASE 3: Chuyển 'nháp' -> 'đang bán' khi ĐÃ có ghế (Mong đợi: THÀNH CÔNG)
try {
  const showtime3 = { id: 3, name: 'Suất 3', status: SHOWTIME_STATUS.NHAP };
  const res = changeShowtimeStatus(showtime3, SHOWTIME_STATUS.DANG_BAN, true);
  if (res.status === SHOWTIME_STATUS.DANG_BAN) {
    console.log('✅ Case 3 ĐẠT: Cho phép chuyển sang "đang bán" khi đã có sơ đồ ghế');
    passed++;
  }
} catch (e) {
  console.log('❌ Case 3 Thất bại:', e.message);
  failed++;
}

// CASE 4: Chuyển 'đang bán' -> 'đã đóng' (Mong đợi: THÀNH CÔNG)
try {
  const showtime4 = { id: 4, name: 'Suất 4', status: SHOWTIME_STATUS.DANG_BAN };
  const res = changeShowtimeStatus(showtime4, SHOWTIME_STATUS.DA_DONG, true);
  if (res.status === SHOWTIME_STATUS.DA_DONG) {
    console.log('✅ Case 4 ĐẠT: Đã đóng bán thành công');
    passed++;
  }
} catch (e) {
  console.log('❌ Case 4 Thất bại:', e.message);
  failed++;
}

// CASE 5: Đã đóng mà cố thay đổi trạng thái tiếp (Mong đợi: BỊ TỪ CHỐI)
try {
  const showtime5 = { id: 5, name: 'Suất 5', status: SHOWTIME_STATUS.DA_DONG };
  changeShowtimeStatus(showtime5, SHOWTIME_STATUS.DANG_BAN, true);
  console.log('❌ Case 5 Thất bại: Đã đóng thì không được đổi tiếp');
  failed++;
} catch (e) {
  console.log('✅ Case 5 ĐẠT: Đã chặn đổi trạng thái của suất diễn đã đóng');
  passed++;
}

console.log('------------------------------------');
console.log(`KẾT QUẢ: ${passed} Passed, ${failed} Failed`);
console.log('====================================');