/* eslint-disable */
const { DRAFT, ON_SALE, CLOSED, ALL } = require('../services/showtimeStatus');
const { changeShowtimeStatus } = require('../services/showtimeStatusService');

describe('T-15 & T-16 Showtime Status Test Suite', () => {
  test('Export đầy đủ hằng số chuẩn', () => {
    expect(DRAFT).toBe('draft');
    expect(ON_SALE).toBe('on_sale');
    expect(CLOSED).toBe('closed');
    expect(ALL).toEqual(['draft', 'on_sale', 'closed']);
  });

  test('Chặn trạng thái không hợp lệ', async () => {
    await expect(
      changeShowtimeStatus(9999, 'trang_thai_la', { id: 1, role: 'admin' })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});