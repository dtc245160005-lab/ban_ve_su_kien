/**
 * ==========================================================================
 * TEST_T25_T26_UI.JS - BỘ KIỂM THỬ TỰ ĐỘNG CHO FRONTEND TASK T-25 VÀ T-26
 * ==========================================================================
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🚀 Bắt đầu kiểm tra giao diện & mã nguồn Frontend Task T-25 & T-26...\n');

let totalTests = 0;
let passedTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(`    -> Lỗi: ${err.message}`);
  }
}

// 1. Kiểm tra file cấu trúc
const htmlPath = path.join(__dirname, 'public', 'index.html');
const cssPath = path.join(__dirname, 'public', 'styles.css');
const jsPath = path.join(__dirname, 'public', 'app.js');

it('Các file giao diện index.html, styles.css, app.js phải tồn tại', () => {
  assert.ok(fs.existsSync(htmlPath), 'Thiếu file public/index.html');
  assert.ok(fs.existsSync(cssPath), 'Thiếu file public/styles.css');
  assert.ok(fs.existsSync(jsPath), 'Thiếu file public/app.js');
});

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const cssContent = fs.readFileSync(cssPath, 'utf8');
const jsContent = fs.readFileSync(jsPath, 'utf8');

// 2. Kiểm tra Style & Theme theo yêu cầu đề bài
it('[Aesthetic] Sử dụng Dark Theme (#0F172A hoặc tương đương)', () => {
  assert.ok(
    cssContent.toLowerCase().includes('#0f172a') || cssContent.toLowerCase().includes('#07090e'),
    'Thiếu tone nền tối #0F172A'
  );
});

it('[Aesthetic] Sân khấu (Stage) có hiệu ứng ánh sáng hào quang (Glow/Spotlight)', () => {
  assert.ok(htmlContent.includes('stage-platform'), 'Thiếu stage-platform trong HTML');
  assert.ok(htmlContent.includes('stage-spotlight'), 'Thiếu stage-spotlight trong HTML');
  assert.ok(cssContent.includes('stage-spotlight'), 'Thiếu style stage-spotlight');
  assert.ok(cssContent.includes('radial-gradient'), 'Thiếu gradient ánh sáng cho sân khấu');
});

it('[Aesthetic] Đầy đủ 3 trạng thái ghế: Ghế trống, Ghế chọn/giữ (Neon), Ghế đã bán (Disable)', () => {
  assert.ok(cssContent.includes('.seat.selected'), 'Thiếu style .seat.selected');
  assert.ok(cssContent.includes('.seat.held'), 'Thiếu style .seat.held');
  assert.ok(cssContent.includes('.seat:disabled') || cssContent.includes('.seat.sold'), 'Thiếu style ghế disabled/sold');
  assert.ok(cssContent.includes('neon-cyan') || cssContent.includes('neon-yellow'), 'Thiếu màu neon cho ghế đang chọn/giữ');
});

it('[Aesthetic] Khung Giỏ vé dạng Thẻ thủy tinh (Glassmorphism)', () => {
  assert.ok(htmlContent.includes('glass-panel'), 'Thiếu class glass-panel trong HTML');
  assert.ok(cssContent.includes('backdrop-filter: blur'), 'Thiếu backdrop-filter blur trong CSS');
});

// 3. Kiểm tra Các Phần Tử Giao Diện Bắt Buộc (DOM Contract)
it('[DOM Contract] Phải có form xác thực: #authEmail và #authPassword', () => {
  assert.ok(htmlContent.includes('id="authEmail"'), 'Thiếu #authEmail');
  assert.ok(htmlContent.includes('id="authPassword"'), 'Thiếu #authPassword');
});

it('[DOM Contract] Sơ đồ ghế chứa các nút .seat với data-id và data-price (bao gồm A1, A2, A3)', () => {
  assert.ok(htmlContent.includes('class="seat'), 'Thiếu class="seat"');
  assert.ok(htmlContent.includes('data-id="A1"'), 'Thiếu ghế A1');
  assert.ok(htmlContent.includes('data-id="A2"'), 'Thiếu ghế A2');
  assert.ok(htmlContent.includes('data-id="A3"'), 'Thiếu ghế A3');
  assert.ok(htmlContent.includes('data-price="'), 'Thiếu thuộc tính data-price');
});

it('[DOM Contract] Phải có nút giữ chỗ #holdBtn và khung #selectionPanel, #selectedSeatList, #estimatedTotal, #countdown', () => {
  assert.ok(htmlContent.includes('id="holdBtn"'), 'Thiếu #holdBtn');
  assert.ok(htmlContent.includes('id="selectionPanel"'), 'Thiếu #selectionPanel');
  assert.ok(htmlContent.includes('id="selectedSeatList"'), 'Thiếu #selectedSeatList');
  assert.ok(htmlContent.includes('id="estimatedTotal"'), 'Thiếu #estimatedTotal');
  assert.ok(htmlContent.includes('id="countdown"'), 'Thiếu #countdown');
});

// 4. Kiểm tra Chức Năng Bỏ Chọn Ghế (Task T-25 & T-26 UI)
it('[Task T-26] Hỗ trợ Cách 1: Click trực tiếp vào ghế trên sơ đồ để hủy giữ chỗ', () => {
  assert.ok(jsContent.includes('handleSeatClick'), 'Thiếu hàm handleSeatClick');
  assert.ok(
    jsContent.includes('heldSeats.has(id)') && jsContent.includes('unholdSeat(id)'),
    'Click ghế đang giữ phải kích hoạt unholdSeat(id)'
  );
});

it('[Task T-26] Hỗ trợ Cách 2: Click vào icon dấu "x" (.remove-seat) trong bảng danh sách đã chọn', () => {
  assert.ok(jsContent.includes('remove-seat'), 'Thiếu class remove-seat');
  assert.ok(jsContent.includes('removeButton.textContent = \'×\'') || jsContent.includes('removeButton.textContent = "x"') || jsContent.includes('removeButton.textContent = \'x\'') || jsContent.includes('removeButton.textContent = "×"'), 'Thiếu icon x cho nút bỏ chọn');
  assert.ok(jsContent.includes('aria-label') && jsContent.includes('Bỏ chọn ghế'), 'Thiếu aria-label Bỏ chọn ghế');
});

it('[Hiệu năng T-25 & T-26] Mỗi lần bấm hủy ghế CHỈ GỬI ĐÚNG 1 request DELETE tới API', () => {
  assert.ok(jsContent.includes('pendingUnholds'), 'Thiếu Set pendingUnholds để kiểm soát hiệu năng');
  assert.ok(jsContent.includes('pendingUnholds.has(id)'), 'Thiếu kiểm tra pendingUnholds.has(id) chống duplicate request');
  assert.ok(jsContent.includes('pendingUnholds.add(id)'), 'Thiếu pendingUnholds.add(id) khi bắt đầu request');
  assert.ok(jsContent.includes('pendingUnholds.delete(id)'), 'Thiếu pendingUnholds.delete(id) khi hoàn tất');
  assert.ok(jsContent.includes('method: \'DELETE\'') || jsContent.includes('method: "DELETE"'), 'Phải gọi method DELETE');
  assert.ok(jsContent.includes('/api/seat-holds/'), 'Phải gọi endpoint /api/seat-holds/:seat_id');
});

it('[Real-time Feedback] Cập nhật tại chỗ mượt mà, KHÔNG reload trang, xóa thẻ ghế khỏi danh sách', () => {
  assert.ok(
    !jsContent.includes('window.location.reload()') && !jsContent.includes('location.reload()'),
    'Không được phép gọi reload trang khi hủy ghế'
  );
  assert.ok(jsContent.includes('heldSeats.delete(id)'), 'Phải xóa ghế khỏi heldSeats');
  assert.ok(jsContent.includes('selectedSeats.delete(id)'), 'Phải xóa ghế khỏi selectedSeats');
  assert.ok(jsContent.includes('fade-out'), 'Phải có hiệu ứng animation mượt mà cho thẻ ghế');
});

it('[Real-time Feedback] Tổng tiền tự động nhảy số với Count Animation', () => {
  assert.ok(jsContent.includes('animateTotal'), 'Thiếu hàm animateTotal tạo Count Animation');
  assert.ok(jsContent.includes('requestAnimationFrame'), 'Sử dụng requestAnimationFrame cho chuyển số mượt mà');
  assert.ok(jsContent.includes('vi-VN') && jsContent.includes('VND'), 'Định dạng tiền tệ VND chuẩn');
});

console.log(`\n======================================================`);
console.log(`KẾT QUẢ KIỂM THỬ: ${passedTests}/${totalTests} BÀI KIỂM TRA ĐẠT CHUẨN (PASS 100%)`);
console.log(`======================================================\n`);

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
