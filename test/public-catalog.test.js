const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');

const createApp = require('../app');
const db = require('../db');

function createMockRedis() {
  const store = new Map();
  return {
    get: async (key) => store.get(key) || null,
    set: async (key, val) => {
      store.set(key, val);
      return 'OK';
    },
    del: async (key) => {
      store.delete(key);
      return 1;
    },
    flush: () => store.clear(),
  };
}

describe('T-17 Public Catalog API & Service Tests', () => {
  const defaultPassword = 'Password123!@#';
  let app;
  let server;
  let baseUrl;
  let roleOrganizerId;
  let passwordHash;
  let testRedis;

  const createdUserIds = new Set();
  const createdEventIds = new Set();
  const createdShowtimeIds = new Set();
  const createdSeatCategoryIds = new Set();
  const createdSeatIds = new Set();

  function createUniquePrefix() {
    return `t17-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function cleanupTrackedData() {
    if (createdSeatIds.size > 0) {
      await db('seats').whereIn('id', Array.from(createdSeatIds)).del();
      createdSeatIds.clear();
    }
    if (createdSeatCategoryIds.size > 0) {
      await db('seat_categories').whereIn('id', Array.from(createdSeatCategoryIds)).del();
      createdSeatCategoryIds.clear();
    }
    if (createdShowtimeIds.size > 0) {
      await db('seats').whereIn('showtime_id', Array.from(createdShowtimeIds)).del();
      await db('seat_categories').whereIn('showtime_id', Array.from(createdShowtimeIds)).del();
      await db('showtimes').whereIn('id', Array.from(createdShowtimeIds)).del();
      createdShowtimeIds.clear();
    }
    if (createdEventIds.size > 0) {
      await db('events').whereIn('id', Array.from(createdEventIds)).del();
      createdEventIds.clear();
    }
    if (createdUserIds.size > 0) {
      await db('user_roles').whereIn('user_id', Array.from(createdUserIds)).del();
      await db('users').whereIn('id', Array.from(createdUserIds)).del();
      createdUserIds.clear();
    }
  }

  async function createOrganizer(prefix) {
    const [user] = await db('users')
      .insert({
        email: `${prefix}-org@example.test`,
        password_hash: passwordHash,
        is_active: true,
      })
      .returning('*');
    createdUserIds.add(user.id);
    await db('user_roles').insert({ user_id: user.id, role_id: roleOrganizerId });
    return user;
  }

  async function createEvent(ownerId, prefix, fields = {}) {
    const [event] = await db('events')
      .insert({
        owner_id: ownerId,
        title: `${prefix} ${fields.title || 'Event'}`,
        description: fields.description || 'Description',
        venue: fields.venue || 'Venue',
        status: fields.status || 'published',
      })
      .returning('*');
    createdEventIds.add(event.id);
    return event;
  }

  async function createShowtime(eventId, fields = {}) {
    const [showtime] = await db('showtimes')
      .insert({
        event_id: eventId,
        starts_at: fields.starts_at || new Date(Date.now() + 86400000),
        room_name: fields.room_name || 'Room',
        status: fields.status || 'on_sale',
      })
      .returning('*');
    createdShowtimeIds.add(showtime.id);
    return showtime;
  }

  async function createShowtimesBulk(rows) {
    const inserted = await db('showtimes').insert(rows).returning('*');
    for (const st of inserted) {
      createdShowtimeIds.add(st.id);
    }
    return inserted;
  }

  before(async () => {
    await db.raw('SELECT 1');

    for (const name of ['organizer', 'admin', 'buyer']) {
      await db('roles').insert({ name }).onConflict('name').ignore();
    }
    const rolesFromDb = await db('roles').select('id', 'name');
    const orgRole = rolesFromDb.find((r) => r.name === 'organizer');
    roleOrganizerId = orgRole.id;

    passwordHash = await argon2.hash(defaultPassword, { type: argon2.argon2id });

    testRedis = createMockRedis();
    app = createApp({ db, redis: testRedis });
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    if (testRedis) {
      testRedis.flush();
    }
    await cleanupTrackedData();
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await cleanupTrackedData();
    await db.destroy();
  });

  it('1. Chỉ trả suất on_sale của event published và starts_at trong tương lai; draft/closed/quá khứ/event draft không xuất hiện', async () => {
    const prefix = createUniquePrefix();
    const organizer = await createOrganizer(prefix);

    // Event 1: published
    const publishedEvent = await createEvent(organizer.id, prefix, {
      title: 'Sự kiện công khai hợp lệ',
      description: 'Mô tả sự kiện hợp lệ',
      venue: 'Nhà hát lớn',
      status: 'published',
    });

    // Event 2: draft
    const draftEvent = await createEvent(organizer.id, prefix, {
      title: 'Sự kiện bản nháp',
      description: 'Mô tả nháp',
      venue: 'Nhà văn hoá',
      status: 'draft',
    });

    // Event 3: archived
    const archivedEvent = await createEvent(organizer.id, prefix, {
      title: 'Sự kiện lưu trữ',
      description: 'Mô tả lưu trữ',
      venue: 'Cung thể thao',
      status: 'archived',
    });

    const now = Date.now();
    const futureDate1 = new Date(now + 24 * 3600 * 1000); // +1 ngày
    const futureDate2 = new Date(now + 48 * 3600 * 1000); // +2 ngày
    const pastDate = new Date(now - 24 * 3600 * 1000); // -1 ngày

    // Suất hợp lệ: on_sale, published, tương lai
    const validShowtime = await createShowtime(publishedEvent.id, {
      starts_at: futureDate1,
      room_name: 'Khán phòng A',
      status: 'on_sale',
    });

    // Suất không hợp lệ 1: draft, published, tương lai
    const draftShowtime = await createShowtime(publishedEvent.id, {
      starts_at: futureDate2,
      room_name: 'Khán phòng B',
      status: 'draft',
    });

    // Suất không hợp lệ 2: closed, published, tương lai
    const closedShowtime = await createShowtime(publishedEvent.id, {
      starts_at: futureDate2,
      room_name: 'Khán phòng C',
      status: 'closed',
    });

    // Suất không hợp lệ 3: on_sale, published, QUÁ KHỨ
    const pastShowtime = await createShowtime(publishedEvent.id, {
      starts_at: pastDate,
      room_name: 'Khán phòng D',
      status: 'on_sale',
    });

    // Suất không hợp lệ 4: on_sale, event draft, tương lai
    const draftEventShowtime = await createShowtime(draftEvent.id, {
      starts_at: futureDate1,
      room_name: 'Khán phòng E',
      status: 'on_sale',
    });

    // Suất không hợp lệ 5: on_sale, event archived, tương lai
    const archivedEventShowtime = await createShowtime(archivedEvent.id, {
      starts_at: futureDate1,
      room_name: 'Khán phòng F',
      status: 'on_sale',
    });

    // Thu thập tất cả các item trên catalog qua phân trang (để chịu được dữ liệu test khác)
    const allRetrieved = [];
    let currentCursor = '';
    while (true) {
      const url = currentCursor
        ? `${baseUrl}/api/events/showtimes?limit=50&cursor=${encodeURIComponent(currentCursor)}`
        : `${baseUrl}/api/events/showtimes?limit=50`;

      const res = await fetch(url);
      assert.strictEqual(res.status, 200);

      const body = await res.json();
      assert.strictEqual(body.success, true);
      const items = body.items || body.data?.items;
      allRetrieved.push(...items);

      const nextCursor = body.nextCursor !== undefined ? body.nextCursor : body.data?.nextCursor;
      if (!nextCursor) {
        break;
      }
      currentCursor = nextCursor;
    }

    const retrievedIds = new Set(allRetrieved.map((it) => it.showtimeId));

    assert.ok(
      retrievedIds.has(validShowtime.id),
      'Suất hợp lệ (on_sale, published, tương lai) phải xuất hiện trong danh sách'
    );
    assert.strictEqual(
      retrievedIds.has(draftShowtime.id),
      false,
      'Suất draft không được xuất hiện trong danh sách'
    );
    assert.strictEqual(
      retrievedIds.has(closedShowtime.id),
      false,
      'Suất closed không được xuất hiện trong danh sách'
    );
    assert.strictEqual(
      retrievedIds.has(pastShowtime.id),
      false,
      'Suất quá khứ không được xuất hiện trong danh sách'
    );
    assert.strictEqual(
      retrievedIds.has(draftEventShowtime.id),
      false,
      'Suất của sự kiện draft không được xuất hiện trong danh sách'
    );
    assert.strictEqual(
      retrievedIds.has(archivedEventShowtime.id),
      false,
      'Suất của sự kiện archived không được xuất hiện trong danh sách'
    );
  });

  it('2. Không lộ owner_id, status nội bộ, created_at trong item', async () => {
    const prefix = createUniquePrefix();
    const organizer = await createOrganizer(prefix);

    const event = await createEvent(organizer.id, prefix, {
      title: 'Sự kiện kiểm tra trường bảo mật',
      description: 'Mô tả chi tiết',
      venue: 'Nhà hát Hoà Bình',
      status: 'published',
    });

    const showtime = await createShowtime(event.id, {
      starts_at: new Date(Date.now() + 24 * 3600 * 1000),
      room_name: 'Phòng VIP',
      status: 'on_sale',
    });

    const res = await fetch(`${baseUrl}/api/events/showtimes?limit=50`);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    const items = body.items || body.data?.items;
    const item = items.find((it) => it.showtimeId === showtime.id);
    assert.ok(item, 'Showtime do test tạo phải được tìm thấy');

    assert.strictEqual(item.owner_id, undefined, 'Không được để lộ owner_id');
    assert.strictEqual(item.status, undefined, 'Không được để lộ status');
    assert.strictEqual(item.created_at, undefined, 'Không được để lộ created_at');
    assert.strictEqual(item.updated_at, undefined, 'Không được để lộ updated_at');
    assert.strictEqual(item.notes, undefined, 'Không được để lộ notes');

    // Phải có đúng các trường công khai
    assert.strictEqual(item.showtimeId, showtime.id);
    assert.strictEqual(item.eventId, event.id);
    assert.strictEqual(item.title, event.title);
    assert.strictEqual(item.description, event.description);
    assert.strictEqual(item.venue, event.venue);
    assert.strictEqual(item.roomName, 'Phòng VIP');
    assert.ok(item.startsAt);
    assert.strictEqual(item.minPrice, null);
    assert.strictEqual(item.maxPrice, null);
  });

  it('3. Tạo 45 suất on_sale, đi hết các trang với limit 20: tổng 45, không trùng id, không sót, đúng thứ tự; có 2 suất cùng starts_at vẫn không trùng/sót', async () => {
    const prefix = createUniquePrefix();
    const organizer = await createOrganizer(prefix);

    const pageEvent = await createEvent(organizer.id, prefix, {
      title: 'Sự kiện phân trang 45 suất',
      description: 'Mô tả test keyset pagination',
      venue: 'Nhà thi đấu Quân khu 7',
      status: 'published',
    });

    const baseTime = Date.now() + 10 * 24 * 3600 * 1000;
    const showtimeRows = [];

    for (let i = 0; i < 45; i++) {
      // 2 suất i=10 và i=11 có cùng starts_at để kiểm tra tuple comparison (starts_at, id)
      const minuteOffset = i === 11 ? 10 * 60 : i * 60;
      showtimeRows.push({
        event_id: pageEvent.id,
        starts_at: new Date(baseTime + minuteOffset * 60 * 1000),
        room_name: `Phòng ${i + 1}`,
        status: 'on_sale',
      });
    }

    const inserted = await createShowtimesBulk(showtimeRows);
    assert.strictEqual(inserted.length, 45);

    // Thứ tự mong đợi: starts_at ASC, id ASC
    const expectedSorted = [...inserted].sort((a, b) => {
      const timeA = new Date(a.starts_at).getTime();
      const timeB = new Date(b.starts_at).getTime();
      if (timeA !== timeB) return timeA - timeB;
      return a.id - b.id;
    });
    const expectedIds = expectedSorted.map((s) => s.id);
    const myShowtimeIds = new Set(expectedIds);

    const allRetrieved = [];
    let currentCursor = '';
    let pageCount = 0;

    while (true) {
      pageCount++;
      const url = currentCursor
        ? `${baseUrl}/api/events/showtimes?limit=20&cursor=${encodeURIComponent(currentCursor)}`
        : `${baseUrl}/api/events/showtimes?limit=20`;

      const res = await fetch(url);
      assert.strictEqual(res.status, 200);

      const body = await res.json();
      const items = body.items || body.data?.items;
      allRetrieved.push(...items);

      const nextCursor = body.nextCursor !== undefined ? body.nextCursor : body.data?.nextCursor;
      if (!nextCursor || pageCount > 50) {
        break;
      }
      currentCursor = nextCursor;
    }

    // Lọc riêng các suất do chính test này tạo để assert
    const myRetrieved = allRetrieved.filter((it) => myShowtimeIds.has(it.showtimeId));
    assert.strictEqual(myRetrieved.length, 45, 'Tổng số suất do test tạo phải lấy về đủ 45');

    const retrievedIds = myRetrieved.map((it) => it.showtimeId);
    const uniqueIds = new Set(retrievedIds);
    assert.strictEqual(uniqueIds.size, 45, 'Không được trùng lặp id giữa các trang');

    // Kiểm tra thứ tự tăng dần theo startsAt rồi đến showtimeId
    assert.deepStrictEqual(
      retrievedIds,
      expectedIds,
      'Thứ tự 45 suất diễn lấy về phải chính xác tăng dần theo (starts_at ASC, id ASC)'
    );
  });

  it('4. Cursor hỏng → 400; limit > 50 bị kẹp về 50', async () => {
    // 1. Cursor không phải base64url hợp lệ
    const resBad1 = await fetch(`${baseUrl}/api/events/showtimes?cursor=!!!invalid_cursor!!!`);
    assert.strictEqual(resBad1.status, 400);

    // 2. Cursor chứa JSON sai cấu trúc
    const badJsonCursor = Buffer.from(JSON.stringify({ bad: 'data' })).toString('base64url');
    const resBad2 = await fetch(`${baseUrl}/api/events/showtimes?cursor=${badJsonCursor}`);
    assert.strictEqual(resBad2.status, 400);

    // 3. Cursor có thời gian không hợp lệ
    const badDateCursor = Buffer.from(JSON.stringify({ s: 'khong-phai-ngay', i: 1 })).toString('base64url');
    const resBad3 = await fetch(`${baseUrl}/api/events/showtimes?cursor=${badDateCursor}`);
    assert.strictEqual(resBad3.status, 400);

    // 4. Cursor thiếu id
    const missingIdCursor = Buffer.from(JSON.stringify({ s: new Date().toISOString() })).toString('base64url');
    const resBad4 = await fetch(`${baseUrl}/api/events/showtimes?cursor=${missingIdCursor}`);
    assert.strictEqual(resBad4.status, 400);

    // 5. Cursor có id âm
    const negativeIdCursor = Buffer.from(JSON.stringify({ s: new Date().toISOString(), i: -10 })).toString('base64url');
    const resBad5 = await fetch(`${baseUrl}/api/events/showtimes?cursor=${negativeIdCursor}`);
    assert.strictEqual(resBad5.status, 400);

    // 6. limit > 50 bị kẹp về 50
    const prefix = createUniquePrefix();
    const organizer = await createOrganizer(prefix);

    const event = await createEvent(organizer.id, prefix, {
      title: 'Sự kiện kiểm tra limit kẹp 50',
      venue: 'Nhà hát Lớn',
      status: 'published',
    });

    const futureBase = Date.now() + 5 * 24 * 3600 * 1000;
    const sixtyShowtimes = [];
    for (let k = 0; k < 60; k++) {
      sixtyShowtimes.push({
        event_id: event.id,
        starts_at: new Date(futureBase + k * 60 * 1000),
        room_name: `Rạp ${k + 1}`,
        status: 'on_sale',
      });
    }
    await createShowtimesBulk(sixtyShowtimes);

    const resLimit = await fetch(`${baseUrl}/api/events/showtimes?limit=100`);
    assert.strictEqual(resLimit.status, 200);
    const bodyLimit = await resLimit.json();
    const items = bodyLimit.items || bodyLimit.data?.items;
    assert.strictEqual(items.length, 50, 'Số lượng item phải bị kẹp về đúng 50 khi client yêu cầu limit 100');
    assert.ok(bodyLimit.nextCursor || bodyLimit.data?.nextCursor, 'Phải có nextCursor vì còn suất phía sau');
  });

  it('5. Cache Redis: gọi 2 lần, lần 2 lấy từ Redis (dùng redis giả lập inject qua options); Redis ném lỗi vẫn trả 200', async () => {
    const prefix = createUniquePrefix();
    const organizer = await createOrganizer(prefix);

    const cachedEvent = await createEvent(organizer.id, prefix, {
      title: 'Sự kiện kiểm tra cache',
      venue: 'Sân khấu Sen Hồng',
      status: 'published',
    });

    const showtime1 = await createShowtime(cachedEvent.id, {
      starts_at: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      room_name: 'Sân khấu ngoài trời',
      status: 'on_sale',
    });

    const memoryCache = new Map();
    let getCalls = 0;
    let setCalls = 0;

    const mockRedis = {
      get: async (key) => {
        getCalls++;
        return memoryCache.get(key) || null;
      },
      set: async (key, val) => {
        setCalls++;
        memoryCache.set(key, val);
        return 'OK';
      },
    };

    const cachedApp = createApp({ db, redis: mockRedis });
    const cachedServer = cachedApp.listen(0);
    const cachedUrl = `http://127.0.0.1:${cachedServer.address().port}`;

    try {
      // Lần 1: cache miss, đọc DB và ghi cache
      const res1 = await fetch(`${cachedUrl}/api/events/showtimes?limit=10`);
      assert.strictEqual(res1.status, 200);
      assert.strictEqual(getCalls, 1);
      assert.strictEqual(setCalls, 1);

      // Thêm một suất diễn mới vào DB
      await createShowtime(cachedEvent.id, {
        starts_at: new Date(Date.now() + 3 * 24 * 3600 * 1000),
        room_name: 'Sân khấu 2',
        status: 'on_sale',
      });

      // Lần 2: cache hit, đọc từ mockRedis (vẫn là dữ liệu cũ đã cache)
      const res2 = await fetch(`${cachedUrl}/api/events/showtimes?limit=10`);
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(getCalls, 2);
      assert.strictEqual(setCalls, 1, 'Không gọi set lại lần 2');

      const body1 = await res1.json();
      const body2 = await res2.json();
      assert.deepStrictEqual(body1, body2);

      // Thử nghiệm Redis ném lỗi: app vẫn trả 200 dữ liệu từ DB (không 500)
      const errorRedis = {
        get: async () => {
          throw new Error('Redis connection lost');
        },
        set: async () => {
          throw new Error('Redis connection lost');
        },
      };

      const errorApp = createApp({ db, redis: errorRedis });
      const errorServer = errorApp.listen(0);
      const errorUrl = `http://127.0.0.1:${errorServer.address().port}`;

      try {
        const resErr = await fetch(`${errorUrl}/api/events/showtimes?limit=10`);
        assert.strictEqual(resErr.status, 200, 'Redis lỗi thì bỏ qua cache và vẫn trả dữ liệu từ DB (không 500)');
        const bodyErr = await resErr.json();
        assert.strictEqual(bodyErr.success, true);
        const errItems = bodyErr.items || bodyErr.data?.items;
        // Phải có ít nhất showtime1 do test này tạo
        assert.ok(errItems.some((it) => it.showtimeId === showtime1.id));
      } finally {
        await new Promise((r) => errorServer.close(r));
      }
    } finally {
      await new Promise((r) => cachedServer.close(r));
    }
  });

  it('6. Chi tiết: on_sale → onSale true; closed → 200 onSale false; id không tồn tại → 404', async () => {
    const prefix = createUniquePrefix();
    const organizer = await createOrganizer(prefix);

    const detailEvent = await createEvent(organizer.id, prefix, {
      title: 'Sự kiện kiểm tra chi tiết',
      description: 'Chi tiết mô tả sự kiện',
      venue: 'Cung Văn hoá Hữu nghị',
      status: 'published',
    });

    // 1. Suất on_sale có 2 ghế
    const showtimeOnSale = await createShowtime(detailEvent.id, {
      starts_at: new Date(Date.now() + 20 * 24 * 3600 * 1000),
      room_name: 'Hội trường 1',
      status: 'on_sale',
    });

    const [seatCategory] = await db('seat_categories')
      .insert({
        showtime_id: showtimeOnSale.id,
        name: 'VIP',
      })
      .returning('*');
    createdSeatCategoryIds.add(seatCategory.id);

    const insertedSeats = await db('seats')
      .insert([
        { showtime_id: showtimeOnSale.id, category_id: seatCategory.id, row_label: 'A', seat_number: 1 },
        { showtime_id: showtimeOnSale.id, category_id: seatCategory.id, row_label: 'A', seat_number: 2 },
      ])
      .returning('*');
    for (const seat of insertedSeats) {
      createdSeatIds.add(seat.id);
    }

    // 2. Suất closed
    const showtimeClosed = await createShowtime(detailEvent.id, {
      starts_at: new Date(Date.now() + 21 * 24 * 3600 * 1000),
      room_name: 'Hội trường 2',
      status: 'closed',
    });

    // 3. Suất draft
    const showtimeDraft = await createShowtime(detailEvent.id, {
      starts_at: new Date(Date.now() + 22 * 24 * 3600 * 1000),
      room_name: 'Hội trường 3',
      status: 'draft',
    });

    // 4. Suất của draft event
    const draftEv = await createEvent(organizer.id, prefix, {
      title: 'Sự kiện draft ẩn',
      venue: 'Nhà rạp',
      status: 'draft',
    });

    const showtimeInDraftEvent = await createShowtime(draftEv.id, {
      starts_at: new Date(Date.now() + 23 * 24 * 3600 * 1000),
      room_name: 'Phòng 4',
      status: 'on_sale',
    });

    // Kiểm tra 1: on_sale -> 200, onSale: true, seatCount: 2
    const resOnSale = await fetch(`${baseUrl}/api/events/showtimes/${showtimeOnSale.id}`);
    assert.strictEqual(resOnSale.status, 200);
    const bodyOnSale = await resOnSale.json();
    const dataOnSale = bodyOnSale.data || bodyOnSale;
    assert.strictEqual(dataOnSale.onSale, true);
    assert.strictEqual(dataOnSale.seatCount, 2);
    assert.strictEqual(dataOnSale.showtimeId, showtimeOnSale.id);
    assert.strictEqual(dataOnSale.title, detailEvent.title);
    assert.strictEqual(dataOnSale.venue, detailEvent.venue);
    assert.strictEqual(dataOnSale.roomName, 'Hội trường 1');
    assert.strictEqual(dataOnSale.minPrice, null);
    assert.strictEqual(dataOnSale.maxPrice, null);
    assert.strictEqual(dataOnSale.owner_id, undefined);
    assert.strictEqual(dataOnSale.status, undefined);

    // Kiểm tra 2: closed -> 200, onSale: false
    const resClosed = await fetch(`${baseUrl}/api/events/showtimes/${showtimeClosed.id}`);
    assert.strictEqual(resClosed.status, 200);
    const bodyClosed = await resClosed.json();
    const dataClosed = bodyClosed.data || bodyClosed;
    assert.strictEqual(dataClosed.onSale, false);

    // Kiểm tra 3: draft -> 200, onSale: false
    const resDraft = await fetch(`${baseUrl}/api/events/showtimes/${showtimeDraft.id}`);
    assert.strictEqual(resDraft.status, 200);
    const bodyDraft = await resDraft.json();
    const dataDraft = bodyDraft.data || bodyDraft;
    assert.strictEqual(dataDraft.onSale, false);

    // Kiểm tra 4: Suất của sự kiện draft -> 404
    const resDraftEv = await fetch(`${baseUrl}/api/events/showtimes/${showtimeInDraftEvent.id}`);
    assert.strictEqual(resDraftEv.status, 404);

    // Kiểm tra 5: Suất không tồn tại -> 404
    const resNotFound = await fetch(`${baseUrl}/api/events/showtimes/9999999`);
    assert.strictEqual(resNotFound.status, 404);

    // Kiểm tra 6: Id không phải số nguyên -> 404
    const resBadId = await fetch(`${baseUrl}/api/events/showtimes/not-an-id`);
    assert.strictEqual(resBadId.status, 404);
  });

  it('7. Hiệu năng: 200 suất on_sale, trang đầu (không cache) chạy dưới 500ms', async () => {
    const prefix = createUniquePrefix();
    const organizer = await createOrganizer(prefix);

    const perfEvent = await createEvent(organizer.id, prefix, {
      title: 'Sự kiện kiểm tra hiệu năng 200 suất',
      venue: 'Sân vận động Mỹ Đình',
      status: 'published',
    });

    const perfBaseTime = Date.now() + 30 * 24 * 3600 * 1000;
    const bulkShowtimes = [];

    for (let i = 0; i < 200; i++) {
      bulkShowtimes.push({
        event_id: perfEvent.id,
        starts_at: new Date(perfBaseTime + i * 3600 * 1000),
        room_name: `Khu ${i + 1}`,
        status: 'on_sale',
      });
    }

    await createShowtimesBulk(bulkShowtimes);

    // Tạo app không có redis cache để đo thời gian truy vấn DB thuần tuý
    const noCacheApp = createApp({ db, redis: null });
    const noCacheServer = noCacheApp.listen(0);
    const noCacheUrl = `http://127.0.0.1:${noCacheServer.address().port}`;

    try {
      const startTime = performance.now();
      const res = await fetch(`${noCacheUrl}/api/events/showtimes?limit=20`);
      const duration = performance.now() - startTime;

      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      const items = body.items || body.data?.items;
      assert.strictEqual(items.length, 20);

      assert.ok(
        duration < 500,
        `Trang đầu (không cache) phải chạy dưới 500ms (thực tế: ${duration.toFixed(2)}ms)`
      );
    } finally {
      await new Promise((r) => noCacheServer.close(r));
    }
  });
});
