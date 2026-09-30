const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const Core = require('../public/seat-map-core');

const payload = {
  seats: [
    { id: 2, row: 'R02', rowOrder: 2, number: 1, category: 'VIP', status: 'SOLD' },
    { id: 1, row: 'R01', rowOrder: 1, number: 1, category: 'Thường', status: 'AVAILABLE' },
  ],
};

test('T-20 dùng một Canvas, có chú giải màu và ký hiệu, không tạo nút cho từng ghế', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/seat-map.html'), 'utf8');
  const dom = new JSDOM(html);
  assert.equal(dom.window.document.querySelectorAll('#seatCanvas').length, 1);
  assert.equal(dom.window.document.querySelectorAll('.legend-seat').length, 3);
  assert.equal(dom.window.document.querySelectorAll('button').length, 3);
  assert.match(dom.window.document.querySelector('.legend').textContent, /Trống/);
  assert.match(dom.window.document.querySelector('.legend').textContent, /Đã bán/);
});

test('T-20 chuẩn hóa, sắp ghế và hit-test đúng sau pan/zoom', () => {
  const normalized = Core.normalizePayload(payload);
  assert.deepEqual(normalized.seats.map((seat) => seat.id), [1, 2]);
  assert.equal(normalized.seats[0].code, 'R01-001');

  const layout = Core.buildLayout(normalized.seats);
  const transform = { scale: 2, x: 35, y: 20 };
  const target = layout.seats[0];
  const screenPoint = {
    x: transform.x + (target.x + target.width / 2) * transform.scale,
    y: transform.y + (target.y + target.height / 2) * transform.scale,
  };
  assert.equal(Core.hitTest(layout.seats, screenPoint, transform).id, target.id);
});

test('T-20 dữ liệu mẫu thể hiện đủ ba trạng thái xác định', () => {
  const seats = Array.from({ length: 60 }, (_, index) => ({
    id: index + 1,
    row: 'A',
    rowOrder: 1,
    number: index + 1,
    status: 'AVAILABLE',
  }));
  const summary = Core.summarize(Core.decorateDemoStatuses(seats));
  assert.ok(summary.AVAILABLE > 0);
  assert.ok(summary.HELD > 0);
  assert.ok(summary.SOLD > 0);
});

test('T-20 ghế đã bán hoặc đang giữ không thể được chọn', () => {
  assert.equal(Core.isSelectableSeat({ status: 'AVAILABLE' }), true);
  assert.equal(Core.isSelectableSeat({ status: 'HELD' }), false);
  assert.equal(Core.isSelectableSeat({ status: 'SOLD' }), false);
});
