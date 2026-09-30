const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSeatMap } = require('../services/seatMapService');
const {
  createSeatMap,
  parseArguments,
  validateSeatMap,
} = require('../scripts/generate-seat-map');

test('T-21 sinh đúng 2.000 ghế và nạp được bằng service S-05/T-12', () => {
  const payload = createSeatMap();
  assert.equal(payload.seats.length, 2000);
  assert.deepEqual(payload.seats[0], { row: 'R01', number: 1, category: 'VIP' });
  assert.deepEqual(payload.seats.at(-1), {
    row: 'R40',
    number: 50,
    category: 'Phổ thông',
  });
  assert.equal(validateSeatMap(payload), true);
  assert.equal(parseSeatMap(Buffer.from(JSON.stringify(payload))).length, 2000);
});

test('T-21 hỗ trợ số ghế tùy chọn và hàng cuối không đầy', () => {
  const payload = createSeatMap({ count: 123, seatsPerRow: 20 });
  assert.equal(payload.seats.length, 123);
  assert.equal(payload.seats.at(-1).row, 'R07');
  assert.equal(payload.seats.at(-1).number, 3);
  assert.equal(parseSeatMap(JSON.stringify(payload)).length, 123);
});

test('T-21 tham số CLI tạo count từ rows khi không truyền count', () => {
  assert.deepEqual(
    parseArguments(['--rows', '8', '--seats-per-row', '25', '--output', 'tmp/map.json']),
    { count: 200, seatsPerRow: 25, output: 'tmp/map.json' },
  );
});
