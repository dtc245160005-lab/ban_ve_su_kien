const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateEventForm,
  validateShowtimeForm,
  toIsoVietnam,
  formatVietnamDateTime,
} = require('../public/eventForm');

describe('Event and Showtime Form Validation Logic (public/eventForm.js)', () => {
  describe('validateEventForm', () => {
    test('Hợp lệ: tên, địa điểm và mô tả đầy đủ', () => {
      const result = validateEventForm({
        title: 'Hòa nhạc Mùa Thu',
        venue: 'Nhà hát Lớn Hà Nội',
        description: 'Chương trình hòa nhạc cổ điển đặc sắc.',
      });
      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.errors, {});
    });

    test('Hợp lệ: mô tả để trống hoặc undefined', () => {
      const result1 = validateEventForm({
        title: 'Hội thảo Công nghệ 2026',
        venue: 'Trung tâm Hội nghị Quốc gia',
      });
      assert.strictEqual(result1.valid, true);

      const result2 = validateEventForm({
        title: 'Hội thảo Công nghệ 2026',
        venue: 'Trung tâm Hội nghị Quốc gia',
        description: '',
      });
      assert.strictEqual(result2.valid, true);
    });

    test('Không hợp lệ: thiếu tên sự kiện hoặc chỉ có khoảng trắng', () => {
      const res1 = validateEventForm({
        venue: 'Hà Nội',
      });
      assert.strictEqual(res1.valid, false);
      assert.ok(res1.errors.title);

      const res2 = validateEventForm({
        title: '   ',
        venue: 'Hà Nội',
      });
      assert.strictEqual(res2.valid, false);
      assert.ok(res2.errors.title);
    });

    test('Không hợp lệ: tên sự kiện vượt quá 200 ký tự', () => {
      const res = validateEventForm({
        title: 'A'.repeat(201),
        venue: 'Hà Nội',
      });
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.title);
    });

    test('Không hợp lệ: thiếu địa điểm hoặc chỉ có khoảng trắng', () => {
      const res1 = validateEventForm({
        title: 'Đêm nhạc acoustic',
      });
      assert.strictEqual(res1.valid, false);
      assert.ok(res1.errors.venue);

      const res2 = validateEventForm({
        title: 'Đêm nhạc acoustic',
        venue: '   ',
      });
      assert.strictEqual(res2.valid, false);
      assert.ok(res2.errors.venue);
    });

    test('Không hợp lệ: địa điểm vượt quá 255 ký tự', () => {
      const res = validateEventForm({
        title: 'Đêm nhạc',
        venue: 'B'.repeat(256),
      });
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.venue);
    });

    test('Không hợp lệ: mô tả vượt quá 5000 ký tự', () => {
      const res = validateEventForm({
        title: 'Đêm nhạc',
        venue: 'Hà Nội',
        description: 'C'.repeat(5001),
      });
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.description);
    });

    test('An toàn: dữ liệu null hoặc undefined', () => {
      const res = validateEventForm(null);
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.title);
      assert.ok(res.errors.venue);
    });
  });

  describe('validateShowtimeForm', () => {
    const fixedNow = new Date('2026-10-01T10:00:00.000Z');

    test('Hợp lệ: thời điểm bắt đầu trong tương lai có múi giờ +07:00', () => {
      const res = validateShowtimeForm(
        {
          starts_at: '2026-10-05T19:30:00+07:00',
          room_name: 'Khán phòng 1',
        },
        fixedNow
      );
      assert.strictEqual(res.valid, true);
      assert.deepStrictEqual(res.errors, {});
    });

    test('Hợp lệ: thời điểm bắt đầu trong tương lai có múi giờ Z và không có room_name', () => {
      const res = validateShowtimeForm(
        {
          starts_at: '2026-10-05T12:30:00Z',
        },
        fixedNow
      );
      assert.strictEqual(res.valid, true);
      assert.deepStrictEqual(res.errors, {});
    });

    test('Không hợp lệ: thiếu thời điểm bắt đầu', () => {
      const res = validateShowtimeForm({}, fixedNow);
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.starts_at);
    });

    test('Không hợp lệ: chuỗi thời gian không có thông tin múi giờ', () => {
      const res = validateShowtimeForm(
        {
          starts_at: '2026-10-05T19:30:00',
        },
        fixedNow
      );
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.starts_at);
      assert.match(res.errors.starts_at, /múi giờ/i);
    });

    test('Không hợp lệ: chuỗi thời gian không thể parse thành ngày', () => {
      const res = validateShowtimeForm(
        {
          starts_at: 'invalid-date+07:00',
        },
        fixedNow
      );
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.starts_at);
    });

    test('Không hợp lệ: thời điểm bắt đầu ở quá khứ', () => {
      const res = validateShowtimeForm(
        {
          starts_at: '2026-09-01T19:30:00+07:00',
        },
        fixedNow
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errors.starts_at, 'Thời điểm bắt đầu phải ở tương lai.');
    });

    test('Không hợp lệ: thời điểm bắt đầu đúng bằng hiện tại', () => {
      const res = validateShowtimeForm(
        {
          starts_at: fixedNow.toISOString(),
        },
        fixedNow
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errors.starts_at, 'Thời điểm bắt đầu phải ở tương lai.');
    });

    test('Không hợp lệ: tên phòng vượt quá 100 ký tự', () => {
      const res = validateShowtimeForm(
        {
          starts_at: '2026-10-05T19:30:00+07:00',
          room_name: 'P'.repeat(101),
        },
        fixedNow
      );
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.room_name);
    });
  });

  describe('toIsoVietnam', () => {
    test('Chuyển đổi chuỗi datetime-local không có giây sang ISO +07:00', () => {
      const converted = toIsoVietnam('2026-12-01T19:30');
      assert.strictEqual(converted, '2026-12-01T19:30:00+07:00');
    });

    test('Chuyển đổi chuỗi datetime-local có giây sang ISO +07:00', () => {
      const converted = toIsoVietnam('2026-12-01T19:30:45');
      assert.strictEqual(converted, '2026-12-01T19:30:45+07:00');
    });

    test('Giữ nguyên nếu chuỗi đã có múi giờ +07:00 hoặc Z', () => {
      assert.strictEqual(toIsoVietnam('2026-12-01T19:30:00+07:00'), '2026-12-01T19:30:00+07:00');
      assert.strictEqual(toIsoVietnam('2026-12-01T12:30:00Z'), '2026-12-01T12:30:00Z');
    });

    test('Chuỗi rỗng hoặc giá trị không hợp lệ', () => {
      assert.strictEqual(toIsoVietnam(''), '');
      assert.strictEqual(toIsoVietnam(null), '');
      assert.strictEqual(toIsoVietnam(undefined), '');
    });
  });

  describe('formatVietnamDateTime', () => {
    test('Định dạng thời gian theo múi giờ Việt Nam', () => {
      // 2026-12-01T12:30:00Z tương đương 19:30:00 ngày 01/12/2026 tại Việt Nam (+07:00)
      const formatted = formatVietnamDateTime('2026-12-01T12:30:00Z');
      assert.ok(formatted.includes('19:30'));
      assert.ok(formatted.includes('1/12') || formatted.includes('01/12') || formatted.includes('12/1'));
    });

    test('Xử lý an toàn khi đầu vào rỗng hoặc không hợp lệ', () => {
      assert.strictEqual(formatVietnamDateTime(''), '');
      assert.strictEqual(formatVietnamDateTime(null), '');
      assert.strictEqual(formatVietnamDateTime('invalid-date'), '');
    });
  });
});
