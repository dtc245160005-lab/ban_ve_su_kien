
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { DRAFT, ON_SALE, CLOSED, ALL } = require('../services/showtimeStatus');
const { changeShowtimeStatus } = require('../services/showtimeStatusService');

describe('T-15 & T-16 Showtime Status Test Suite', () => {
  it('Export đầy đủ hằng số chuẩn', () => {
    assert.strictEqual(DRAFT, 'draft');
    assert.strictEqual(ON_SALE, 'on_sale');
    assert.strictEqual(CLOSED, 'closed');
    assert.deepStrictEqual(ALL, ['draft', 'on_sale', 'closed']);
  });

  it('Chặn trạng thái không hợp lệ', async () => {
    await assert.rejects(
      async () => {
        await changeShowtimeStatus(9999, 'trang_thai_la', { id: 1, role: 'admin' });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 409);
        return true;
      }
    );
  });
});