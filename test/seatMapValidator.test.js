const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateSeatMapText } = require('../public/seatMapValidator');

describe('T-13 / S-06 seatMapValidator Unit Tests', () => {
  test('INVALID_JSON: cú pháp hỏng, tự tính line và column, không ném lỗi', () => {
    const raw = '{\n  "seats": [\n    { "row": "A",\n';
    const result = validateSeatMapText(raw);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.length, 1);
    const err = result.errors[0];
    assert.strictEqual(err.code, 'INVALID_JSON');
    assert.ok(err.line !== null, 'Phải có số dòng');
    assert.ok(err.column !== null, 'Phải có số cột');
    assert.match(err.message, /sai cú pháp/i);
    assert.strictEqual(err.index, null);
    assert.strictEqual(err.field, null);
  });

  test('ROOT_NOT_OBJECT: gốc là mảng hoặc primitive', () => {
    for (const input of ['[]', '"hello"', '123', 'true', 'null']) {
      const result = validateSeatMapText(input);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].code, 'ROOT_NOT_OBJECT');
      assert.strictEqual(result.errors[0].index, null);
    }
  });

  test('SEATS_MISSING: thiếu trường seats hoặc seats không phải mảng', () => {
    for (const input of ['{}', '{"seats": "not_an_array"}', '{"seats": 123}', '{"seats": {}}']) {
      const result = validateSeatMapText(input);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors[0].code, 'SEATS_MISSING');
      assert.strictEqual(result.errors[0].field, 'seats');
    }
  });

  test('SEATS_EMPTY: mảng seats rỗng', () => {
    const result = validateSeatMapText(JSON.stringify({ seats: [] }));
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors[0].code, 'SEATS_EMPTY');
    assert.strictEqual(result.errors[0].field, 'seats');
  });

  test('TOO_MANY_SEATS: quá 10.000 ghế', () => {
    const seats = Array.from({ length: 10001 }, (_, i) => ({
      row: 'A',
      number: i + 1,
      category: 'VIP',
    }));
    const result = validateSeatMapText(JSON.stringify({ seats }));
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === 'TOO_MANY_SEATS'));
  });

  test('SEAT_NOT_OBJECT: phần tử ghế không phải object', () => {
    const result = validateSeatMapText(JSON.stringify({ seats: ['string_seat', 123, null] }));
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.length, 3);
    assert.strictEqual(result.errors[0].code, 'SEAT_NOT_OBJECT');
    assert.strictEqual(result.errors[0].index, 0);
    assert.strictEqual(result.errors[1].code, 'SEAT_NOT_OBJECT');
    assert.strictEqual(result.errors[1].index, 1);
    assert.strictEqual(result.errors[2].code, 'SEAT_NOT_OBJECT');
    assert.strictEqual(result.errors[2].index, 2);
  });

  test('FIELD_MISSING: thiếu row, number hoặc category (một ghế thiếu 2 trường ra 2 lỗi)', () => {
    const result = validateSeatMapText(JSON.stringify({
      seats: [
        { row: 'A' }, // thiếu number và category -> 2 lỗi
        { number: 1, category: 'VIP' }, // thiếu row -> 1 lỗi
      ],
    }));
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.length, 3);
    assert.strictEqual(result.errors[0].code, 'FIELD_MISSING');
    assert.strictEqual(result.errors[0].field, 'number');
    assert.strictEqual(result.errors[0].index, 0);

    assert.strictEqual(result.errors[1].code, 'FIELD_MISSING');
    assert.strictEqual(result.errors[1].field, 'category');
    assert.strictEqual(result.errors[1].index, 0);

    assert.strictEqual(result.errors[2].code, 'FIELD_MISSING');
    assert.strictEqual(result.errors[2].field, 'row');
    assert.strictEqual(result.errors[2].index, 1);
  });

  test('FIELD_TYPE: row/category không phải chuỗi; number không phải số nguyên', () => {
    const result = validateSeatMapText(JSON.stringify({
      seats: [
        { row: 123, number: 1, category: 'VIP' },
        { row: 'A', number: '1', category: 'VIP' },
        { row: 'A', number: 1.5, category: 'VIP' },
        { row: 'A', number: 1, category: false },
      ],
    }));
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.length, 4);

    assert.strictEqual(result.errors[0].code, 'FIELD_TYPE');
    assert.strictEqual(result.errors[0].field, 'row');

    assert.strictEqual(result.errors[1].code, 'FIELD_TYPE');
    assert.strictEqual(result.errors[1].field, 'number');

    assert.strictEqual(result.errors[2].code, 'FIELD_TYPE');
    assert.strictEqual(result.errors[2].field, 'number');

    assert.strictEqual(result.errors[3].code, 'FIELD_TYPE');
    assert.strictEqual(result.errors[3].field, 'category');
  });

  test('ROW_BLANK & CATEGORY_BLANK: chuỗi rỗng sau khi trim', () => {
    const result = validateSeatMapText(JSON.stringify({
      seats: [
        { row: '   ', number: 1, category: 'VIP' },
        { row: 'A', number: 2, category: '   ' },
      ],
    }));
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.length, 2);
    assert.strictEqual(result.errors[0].code, 'ROW_BLANK');
    assert.strictEqual(result.errors[0].field, 'row');
    assert.strictEqual(result.errors[1].code, 'CATEGORY_BLANK');
    assert.strictEqual(result.errors[1].field, 'category');
  });

  test('ROW_TOO_LONG: row dài quá 32 ký tự', () => {
    const result = validateSeatMapText(JSON.stringify({
      seats: [
        { row: 'A'.repeat(33), number: 1, category: 'VIP' },
      ],
    }));
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors[0].code, 'ROW_TOO_LONG');
    assert.strictEqual(result.errors[0].field, 'row');
  });

  test('CATEGORY_TOO_LONG: category dài quá 100 ký tự', () => {
    const result = validateSeatMapText(JSON.stringify({
      seats: [
        { row: 'A', number: 1, category: 'C'.repeat(101) },
      ],
    }));
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors[0].code, 'CATEGORY_TOO_LONG');
    assert.strictEqual(result.errors[0].field, 'category');
  });

  test('NUMBER_NOT_POSITIVE: number <= 0 hoặc > 2147483647', () => {
    const result = validateSeatMapText(JSON.stringify({
      seats: [
        { row: 'A', number: 0, category: 'VIP' },
        { row: 'A', number: -10, category: 'VIP' },
        { row: 'A', number: 2147483648, category: 'VIP' },
      ],
    }));
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.length, 3);
    for (const err of result.errors) {
      assert.strictEqual(err.code, 'NUMBER_NOT_POSITIVE');
      assert.strictEqual(err.field, 'number');
    }
  });

  test('DUPLICATE_SEAT: trùng row sau trim và number, chỉ rõ related index', () => {
    const result = validateSeatMapText(JSON.stringify({
      seats: [
        { row: '  A ', number: 5, category: 'VIP' }, // index 0 (Ghế #1)
        { row: 'B', number: 1, category: 'Thường' }, // index 1 (Ghế #2)
        { row: 'A', number: 5, category: 'Thường' }, // index 2 (Ghế #3) -> trùng với index 0
      ],
    }));
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.length, 1);
    const err = result.errors[0];
    assert.strictEqual(err.code, 'DUPLICATE_SEAT');
    assert.strictEqual(err.index, 2);
    assert.strictEqual(err.related, 0);
    assert.match(err.message, /Ghế #3 \(A-5\) trùng với ghế #1/);
  });

  test('Tệp nhiều lỗi (multi-error.json) trả đủ và đúng danh sách lỗi', () => {
    const fixturePath = path.join(__dirname, 'fixtures/seatmaps/multi-error.json');
    const content = fs.readFileSync(fixturePath, 'utf8');
    const result = validateSeatMapText(content);

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length >= 8, `Cần ít nhất 8 lỗi, nhận được ${result.errors.length}`);

    const errorCodes = new Set(result.errors.map((e) => e.code));
    assert.ok(errorCodes.has('SEAT_NOT_OBJECT'));
    assert.ok(errorCodes.has('FIELD_MISSING'));
    assert.ok(errorCodes.has('FIELD_TYPE'));
    assert.ok(errorCodes.has('ROW_BLANK'));
    assert.ok(errorCodes.has('CATEGORY_TOO_LONG'));
    assert.ok(errorCodes.has('NUMBER_NOT_POSITIVE'));
    assert.ok(errorCodes.has('ROW_TOO_LONG'));
    assert.ok(errorCodes.has('DUPLICATE_SEAT'));
  });

  test('Tệp đúng (valid-small.json) trả errors=[] và summary đầy đủ', () => {
    const fixturePath = path.join(__dirname, 'fixtures/seatmaps/valid-small.json');
    const content = fs.readFileSync(fixturePath, 'utf8');
    const result = validateSeatMapText(content);

    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
    assert.ok(result.seats && result.seats.length === 10);
    assert.ok(result.summary);
    assert.strictEqual(result.summary.seatCount, 10);
    assert.strictEqual(result.summary.rows.length, 3);
    assert.strictEqual(result.summary.categories.length, 2);
    assert.deepStrictEqual(result.summary.categories, [
      { name: 'VIP', count: 3 },
      { name: 'Thường', count: 7 },
    ]);
  });

  test('Tối đa 200 lỗi thì có truncated = true', () => {
    const brokenSeats = Array.from({ length: 300 }, (_, i) => ({
      row: '', // ROW_BLANK
      number: -i, // NUMBER_NOT_POSITIVE
      category: '', // CATEGORY_BLANK
    }));
    const result = validateSeatMapText(JSON.stringify({ seats: brokenSeats }));
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.errors.length, 200);
    assert.strictEqual(result.truncated, true);
  });

  test('2.000 ghế hợp lệ chạy dưới 100ms', () => {
    const seats = Array.from({ length: 2000 }, (_, index) => ({
      row: String.fromCharCode(65 + Math.floor(index / 100)),
      number: (index % 100) + 1,
      category: index % 2 === 0 ? 'VIP' : 'Thường',
    }));
    const jsonStr = JSON.stringify({ seats });

    const start = performance.now();
    const result = validateSeatMapText(jsonStr);
    const duration = performance.now() - start;

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.seats.length, 2000);
    assert.ok(duration < 100, `Chạy 2.000 ghế mất ${duration.toFixed(2)} ms (yêu cầu < 100ms)`);
  });
});
