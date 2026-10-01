const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  DRAFT,
  ON_SALE,
  CLOSED,
  isValidTransition,
  assertCanManage,
  changeShowtimeStatus,
} = require('../services/showtimeStatusService');

describe('T-15 & T-16 Showtime Status Full Test Suite', () => {
  const statuses = [DRAFT, ON_SALE, CLOSED];
  const validTransitions = [
    `${DRAFT}->${ON_SALE}`,
    `${ON_SALE}->${CLOSED}`,
    `${CLOSED}->${ON_SALE}`,
  ];

  it('Kiểm tra toàn bộ 9 cặp chuyển đổi trạng thái', () => {
    for (const from of statuses) {
      for (const to of statuses) {
        const pair = `${from}->${to}`;
        const isValid = isValidTransition(from, to);
        if (validTransitions.includes(pair)) {
          assert.strictEqual(isValid, true, `Cặp ${pair} phải hợp lệ`);
        } else {
          assert.strictEqual(isValid, false, `Cặp ${pair} không hợp lệ (409)`);
        }
      }
    }
  });

  describe('Kiểm tra quyền hạn assertCanManage', () => {
    it('Chặn Buyer (403)', () => {
      assert.throws(
        () => {
          assertCanManage({ id: 2, roles: ['buyer'] }, 1);
        },
        (err) => err.statusCode === 403
      );
    });

    it('Chặn Organizer khác không sở hữu sự kiện (403)', () => {
      assert.throws(
        () => {
          assertCanManage({ id: 2, roles: ['organizer'] }, 1);
        },
        (err) => err.statusCode === 403
      );
    });

    it('Cho phép Organizer chính chủ sở hữu sự kiện', () => {
      assert.doesNotThrow(() => {
        assertCanManage({ id: 1, roles: ['organizer'] }, 1);
      });
    });

    it('Cho phép Admin quản trị hệ thống', () => {
      assert.doesNotThrow(() => {
        assertCanManage({ id: 99, roles: ['admin'] }, 1);
      });
    });
  });

  describe('Kiểm tra AC T-15: Chặn mở bán khi chưa có ghế', () => {
    it('Ném 409 khi mở bán suất diễn có 0 ghế', async () => {
      const mockDb = {
        transaction: async (callback) => {
          const trx = (table) => {
            if (table === 'showtimes') {
              return {
                join: () => ({
                  select: () => ({
                    where: () => ({
                      forUpdate: () => ({
                        first: async () => ({ id: 50, status: DRAFT, owner_id: 1 }),
                      }),
                    }),
                  }),
                }),
              };
            }
            if (table === 'seats') {
              return {
                where: () => ({
                  count: () => ({
                    first: async () => ({ total_seats: 0 }),
                  }),
                }),
              };
            }
          };
          return callback(trx);
        },
      };

      await assert.rejects(
        async () => {
          await changeShowtimeStatus(50, ON_SALE, { id: 1, roles: ['organizer'] }, mockDb);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 409);
          return true;
        }
      );
    });
  });
});