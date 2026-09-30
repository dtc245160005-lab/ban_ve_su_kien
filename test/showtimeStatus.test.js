const { DRAFT, ON_SALE, CLOSED, ALL, updateShowtimeStatus } = require('../services/showtimeStatus');

describe('T-15: Quản lý trạng thái suất diễn', () => {
  test('Kiểm tra danh sách hằng số trạng thái', () => {
    expect(DRAFT).toBe('draft');
    expect(ON_SALE).toBe('on_sale');
    expect(CLOSED).toBe('closed');
    expect(ALL).toEqual(['draft', 'on_sale', 'closed']);
  });

  test('Chặn cập nhật trạng thái không nằm trong danh mục', async () => {
    await expect(updateShowtimeStatus(9999, 'trang_thai_la')).rejects.toThrow('Trạng thái không hợp lệ');
  });
});
