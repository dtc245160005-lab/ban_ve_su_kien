const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseCursor, createPublicCatalogService } = require('../services/publicCatalogService');

function encode(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

const validCursor = encode({ s: '2030-01-01T12:30:00.000Z', i: 7 });

function assert400(fn) {
  assert.throws(fn, (err) => err.status === 400);
}

describe('T-17 parseCursor — kiểm tra con trỏ phân trang', () => {
  it('cursor rỗng hoặc không truyền thì là trang đầu', () => {
    assert.equal(parseCursor(undefined), null);
    assert.equal(parseCursor(''), null);
  });

  it('cursor hợp lệ được giải mã đúng', () => {
    assert.deepEqual(parseCursor(validCursor), { startsAtIso: '2030-01-01T12:30:00.000Z', id: 7 });
  });

  it('cursor hợp lệ bị thêm ký tự lạ thì trả 400', () => {
    assert400(() => parseCursor(`${validCursor}!`));
    assert400(() => parseCursor(`${validCursor}=`));
    assert400(() => parseCursor(` ${validCursor}`));
  });

  it('cursor không phải chuỗi (tham số lặp ?cursor=a&cursor=b) thì trả 400', () => {
    assert400(() => parseCursor([validCursor, validCursor]));
  });

  it('id trong cursor vượt kiểu integer của PostgreSQL hoặc không phải số nguyên thì trả 400', () => {
    assert400(() => parseCursor(encode({ s: '2030-01-01T12:30:00.000Z', i: 2147483648 })));
    assert400(() => parseCursor(encode({ s: '2030-01-01T12:30:00.000Z', i: '7' })));
    assert400(() => parseCursor(encode({ s: '2030-01-01T12:30:00.000Z', i: 0 })));
    assert.equal(parseCursor(encode({ s: '2030-01-01T12:30:00.000Z', i: 2147483647 })).id, 2147483647);
  });
});

describe('T-17 getPublicShowtime — id ngoài miền integer', () => {
  it('id lớn hơn 2147483647 trả 404 mà không truy vấn cơ sở dữ liệu', async () => {
    const db = () => {
      throw new Error('không được truy vấn DB');
    };
    const service = createPublicCatalogService({ db, redis: null });
    await assert.rejects(service.getPublicShowtime('2147483648'), (err) => err.status === 404);
  });
});

describe('T-17 cache Redis dùng tiền tố khoá của môi trường', () => {
  it('khoá cache có tiền tố keyPrefix', async () => {
    const keys = [];
    const redis = {
      get: async (key) => {
        keys.push(key);
        return JSON.stringify({ items: [], nextCursor: null });
      },
    };
    const service = createPublicCatalogService({ db: () => {}, redis, keyPrefix: 'staging:' });
    await service.listOnSaleShowtimes({});
    assert.deepEqual(keys, ['staging:catalog:onsale:v1:first:20']);
  });
});
