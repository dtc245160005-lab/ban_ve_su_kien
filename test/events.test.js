const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');

const testPrefix = `bvsk-events-test:${process.pid}:`;
process.env.REDIS_KEY_PREFIX = testPrefix;

const createApp = require('../app');
const db = require('../db');
const { getRedis, redisClient, closeRedis } = require('../lib/redis');

async function cleanTestKeys(client) {
  if (!client || !client.isOpen) return;
  let cursor = 0;
  do {
    const reply = await client.scan(cursor, {
      MATCH: `${testPrefix}*`,
      COUNT: 100,
    });
    cursor = reply.cursor;
    if (reply.keys.length > 0) {
      await client.del(reply.keys);
    }
  } while (cursor !== 0);
}

async function loginAndGetCookie(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const cookie = res.headers.get('set-cookie');
  const body = await res.json();
  return { status: res.status, cookie, body };
}

describe('S-04 / T-09 / T-10 Events Management API Tests', () => {
  const defaultPassword = 'Password123!@#';
  const organizerAEmail = `org_a_${process.pid}@example.test`;
  const organizerBEmail = `org_b_${process.pid}@example.test`;
  const adminEmail = `admin_ev_${process.pid}@example.test`;
  const buyerEmail = `buyer_ev_${process.pid}@example.test`;

  let app;
  let server;
  let baseUrl;
  let organizerA;
  let organizerB;
  let adminUser;
  let buyerUser;
  let cookieA;
  let cookieB;
  let cookieAdmin;
  let cookieBuyer;

  before(async () => {
    await db.raw('SELECT 1');
    await getRedis();
    await cleanTestKeys(redisClient);

    const requiredRoles = ['buyer', 'organizer', 'checker', 'accountant', 'admin'];
    for (const name of requiredRoles) {
      await db('roles').insert({ name }).onConflict('name').ignore();
    }
    const rolesFromDb = await db('roles').select('id', 'name');
    const roleMap = new Map(rolesFromDb.map((r) => [r.name, r.id]));

    const passwordHash = await argon2.hash(defaultPassword, { type: argon2.argon2id });

    // 1. Tạo Organizer A
    [organizerA] = await db('users')
      .insert({ email: organizerAEmail, password_hash: passwordHash, is_active: true })
      .returning('*');
    await db('user_roles').insert({ user_id: organizerA.id, role_id: roleMap.get('organizer') });

    // 2. Tạo Organizer B
    [organizerB] = await db('users')
      .insert({ email: organizerBEmail, password_hash: passwordHash, is_active: true })
      .returning('*');
    await db('user_roles').insert({ user_id: organizerB.id, role_id: roleMap.get('organizer') });

    // 3. Tạo Admin
    [adminUser] = await db('users')
      .insert({ email: adminEmail, password_hash: passwordHash, is_active: true })
      .returning('*');
    await db('user_roles').insert({ user_id: adminUser.id, role_id: roleMap.get('admin') });

    // 4. Tạo Buyer
    [buyerUser] = await db('users')
      .insert({ email: buyerEmail, password_hash: passwordHash, is_active: true })
      .returning('*');
    await db('user_roles').insert({ user_id: buyerUser.id, role_id: roleMap.get('buyer') });

    app = createApp();
    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Đăng nhập lấy cookie
    const resA = await loginAndGetCookie(baseUrl, organizerAEmail, defaultPassword);
    cookieA = resA.cookie;

    const resB = await loginAndGetCookie(baseUrl, organizerBEmail, defaultPassword);
    cookieB = resB.cookie;

    const resAdmin = await loginAndGetCookie(baseUrl, adminEmail, defaultPassword);
    cookieAdmin = resAdmin.cookie;

    const resBuyer = await loginAndGetCookie(baseUrl, buyerEmail, defaultPassword);
    cookieBuyer = resBuyer.cookie;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await cleanTestKeys(redisClient);
    await closeRedis();

    const testUsers = [organizerA?.id, organizerB?.id, adminUser?.id, buyerUser?.id].filter(Boolean);
    if (testUsers.length > 0) {
      const userEvents = await db('events').whereIn('owner_id', testUsers).select('id');
      const eventIds = userEvents.map((e) => e.id);
      if (eventIds.length > 0) {
        await db('showtimes').whereIn('event_id', eventIds).del();
        await db('events').whereIn('id', eventIds).del();
      }
      await db('user_roles').whereIn('user_id', testUsers).del();
      await db('users').whereIn('id', testUsers).del();
    }
    await db.destroy();
  });

  test('1. Organizer tạo sự kiện hợp lệ: 201, status="draft", owner_id đúng. GET /api/events (public) KHÔNG thấy', async () => {
    const res = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: cookieA,
      },
      body: JSON.stringify({
        title: 'Lễ hội Ánh sáng 2026',
        venue: 'Công viên Thống Nhất',
        description: 'Lễ hội ánh sáng mùa thu',
      }),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    const event = data.data || data.event;
    assert.ok(event.id);
    assert.strictEqual(event.title, 'Lễ hội Ánh sáng 2026');
    assert.strictEqual(event.venue, 'Công viên Thống Nhất');
    assert.strictEqual(event.status, 'draft');
    assert.strictEqual(Number(event.owner_id), organizerA.id);

    // Kiểm tra GET /api/events (public): KHÔNG thấy sự kiện draft này
    const publicRes = await fetch(`${baseUrl}/api/events`);
    assert.strictEqual(publicRes.status, 200);
    const publicData = await publicRes.json();
    const publicEvents = publicData.data || publicData.events || [];
    const found = publicEvents.find((e) => e.id === event.id);
    assert.strictEqual(found, undefined, 'Sự kiện draft tuyệt đối không được xuất hiện ở public events');
  });

  test('2. Đổi status sang "published" trong DB: GET /api/events thấy sự kiện, response KHÔNG có owner_id', async () => {
    // Tạo sự kiện mới của A
    const [ev] = await db('events')
      .insert({
        title: 'Đêm nhạc Cổ điển Published',
        venue: 'Nhà hát Lớn Hà Nội',
        description: 'Chương trình công khai',
        status: 'published',
        owner_id: organizerA.id,
      })
      .returning('*');

    const res = await fetch(`${baseUrl}/api/events`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const publicEvents = data.data || data.events || [];
    const found = publicEvents.find((e) => e.id === ev.id);

    assert.ok(found, 'Phải tìm thấy sự kiện đã published ở public endpoint');
    assert.strictEqual(found.title, 'Đêm nhạc Cổ điển Published');
    assert.strictEqual(found.venue, 'Nhà hát Lớn Hà Nội');
    assert.strictEqual(found.owner_id, undefined, 'Public response tuyệt đối không chứa trường owner_id');
  });

  test('organizer publishes only after a future showtime has saved seats, then buyer sees it', async () => {
    const [event] = await db('events').insert({
      title: 'Publish flow test', venue: 'Test venue', status: 'draft', owner_id: organizerA.id,
    }).returning('*');
    const url = `${baseUrl}/api/organizer/events/${event.id}/publish`;
    const request = (cookie) => fetch(url, { method: 'POST', headers: { cookie } });

    assert.strictEqual((await request(cookieBuyer)).status, 403);
    assert.strictEqual((await request(cookieB)).status, 403);
    assert.strictEqual((await request(cookieA)).status, 409);

    const [showtime] = await db('showtimes').insert({
      event_id: event.id, starts_at: new Date(Date.now() + 86400000),
    }).returning('*');
    assert.strictEqual((await request(cookieA)).status, 409);
    const seatMapsUrl = `${baseUrl}/api/workspaces/buyer/events/${event.id}/seat-maps`;
    assert.strictEqual((await fetch(seatMapsUrl, { headers: { cookie: cookieBuyer } })).status, 404);

    const [category] = await db('seat_categories').insert({ showtime_id: showtime.id, name: 'VIP' }).returning('*');
    await db('seats').insert({ showtime_id: showtime.id, category_id: category.id, row_label: 'A', seat_number: 1 });

    const response = await request(cookieA);
    assert.strictEqual(response.status, 200);
    assert.strictEqual((await response.json()).data.status, 'published');
    assert.strictEqual((await request(cookieA)).status, 409);

    const buyerResponse = await fetch(`${baseUrl}/api/workspaces/buyer`, { headers: { cookie: cookieBuyer } });
    assert.strictEqual(buyerResponse.status, 200);
    const buyerData = await buyerResponse.json();
    assert.ok(buyerData.data.events.some((item) => item.id === event.id));
    assert.strictEqual((await fetch(seatMapsUrl, { headers: { cookie: cookieA } })).status, 403);
    const mapResponse = await fetch(seatMapsUrl, { headers: { cookie: cookieBuyer } });
    assert.strictEqual(mapResponse.status, 200);
    const mapData = (await mapResponse.json()).data;
    assert.strictEqual(mapData.showtimes[0].seatCount, 1);
    assert.deepStrictEqual(mapData.showtimes[0].rows, [{ row: 'A', seats: [{ number: 1, category: 'VIP' }] }]);
  });

  test('3. Phân quyền: Organizer B GET, PUT, DELETE sự kiện của Organizer A: 403. Id không tồn tại: 404', async () => {
    // Tạo sự kiện thuộc sở hữu của Organizer A
    const [evA] = await db('events')
      .insert({
        title: 'Sự kiện riêng của A',
        venue: 'Địa điểm A',
        status: 'draft',
        owner_id: organizerA.id,
      })
      .returning('*');

    // Organizer B cố GET sự kiện của A -> 403
    const getRes = await fetch(`${baseUrl}/api/organizer/events/${evA.id}`, {
      headers: { cookie: cookieB },
    });
    assert.strictEqual(getRes.status, 403);
    const getBody = await getRes.json();
    assert.strictEqual(getBody.success, false);

    // Organizer B cố PUT sự kiện của A -> 403
    const putRes = await fetch(`${baseUrl}/api/organizer/events/${evA.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: cookieB },
      body: JSON.stringify({ title: 'Hack Title', venue: 'Hack Venue' }),
    });
    assert.strictEqual(putRes.status, 403);

    // Organizer B cố DELETE sự kiện của A -> 403
    const delRes = await fetch(`${baseUrl}/api/organizer/events/${evA.id}`, {
      method: 'DELETE',
      headers: { cookie: cookieB },
    });
    assert.strictEqual(delRes.status, 403);

    // Kiểm tra Id không tồn tại: 404
    const notFoundRes = await fetch(`${baseUrl}/api/organizer/events/999999`, {
      headers: { cookie: cookieA },
    });
    assert.strictEqual(notFoundRes.status, 404);
  });

  test('4. Admin có toàn quyền xem, sửa, xoá sự kiện của Organizer A', async () => {
    const [evA] = await db('events')
      .insert({
        title: 'Sự kiện A cho Admin sửa',
        venue: 'Hà Nội',
        status: 'draft',
        owner_id: organizerA.id,
      })
      .returning('*');

    // Admin GET sự kiện của A: 200
    const getRes = await fetch(`${baseUrl}/api/organizer/events/${evA.id}`, {
      headers: { cookie: cookieAdmin },
    });
    assert.strictEqual(getRes.status, 200);

    // Admin PUT sự kiện của A: 200
    const putRes = await fetch(`${baseUrl}/api/organizer/events/${evA.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: cookieAdmin },
      body: JSON.stringify({ title: 'Tiêu đề đã được Admin duyệt', venue: 'Địa điểm VIP' }),
    });
    assert.strictEqual(putRes.status, 200);
    const putData = await putRes.json();
    const updated = putData.data || putData.event;
    assert.strictEqual(updated.title, 'Tiêu đề đã được Admin duyệt');

    // Admin DELETE sự kiện của A: 200
    const delRes = await fetch(`${baseUrl}/api/organizer/events/${evA.id}`, {
      method: 'DELETE',
      headers: { cookie: cookieAdmin },
    });
    assert.strictEqual(delRes.status, 200);
  });

  test('5. Buyer gọi POST /api/organizer/events: 403. Chưa đăng nhập: 401', async () => {
    // Buyer gọi: 403
    const buyerRes = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieBuyer },
      body: JSON.stringify({ title: 'Tạo bởi Buyer', venue: 'Hà Nội' }),
    });
    assert.strictEqual(buyerRes.status, 403);

    // Chưa đăng nhập: 401
    const unauthRes = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Không auth', venue: 'Hà Nội' }),
    });
    assert.strictEqual(unauthRes.status, 401);
  });

  test('6. PUT gửi kèm owner_id hoặc status: các trường này bị bỏ qua, không đổi', async () => {
    const [ev] = await db('events')
      .insert({
        title: 'Sự kiện thử nghiệm bảo mật',
        venue: 'TP.HCM',
        status: 'draft',
        owner_id: organizerA.id,
      })
      .returning('*');

    const res = await fetch(`${baseUrl}/api/organizer/events/${ev.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({
        title: 'Tiêu đề mới',
        venue: 'Địa điểm mới',
        owner_id: organizerB.id, // Cố tình đổi chủ sở hữu sang B
        status: 'published', // Cố tình tự publish qua PUT
      }),
    });

    assert.strictEqual(res.status, 200);
    const inDb = await db('events').where({ id: ev.id }).first();
    assert.strictEqual(inDb.title, 'Tiêu đề mới');
    assert.strictEqual(inDb.venue, 'Địa điểm mới');
    assert.strictEqual(Number(inDb.owner_id), organizerA.id, 'owner_id không được thay đổi');
    assert.strictEqual(inDb.status, 'draft', 'status không được thay đổi qua PUT');
  });

  test('7. Xoá sự kiện còn suất diễn: 409. Xoá hết suất diễn rồi xoá sự kiện: 200', async () => {
    const [ev] = await db('events')
      .insert({
        title: 'Sự kiện có suất diễn',
        venue: 'Hà Nội',
        status: 'draft',
        owner_id: organizerA.id,
      })
      .returning('*');

    // Thêm suất diễn cho sự kiện
    const [st] = await db('showtimes')
      .insert({
        event_id: ev.id,
        starts_at: new Date('2026-11-20T19:00:00+07:00'),
        room_name: 'Phòng 1',
      })
      .returning('*');

    // Thử xoá sự kiện khi còn suất diễn -> 409
    const delEventRes1 = await fetch(`${baseUrl}/api/organizer/events/${ev.id}`, {
      method: 'DELETE',
      headers: { cookie: cookieA },
    });
    assert.strictEqual(delEventRes1.status, 409);
    const delEventBody1 = await delEventRes1.json();
    assert.strictEqual(delEventBody1.success, false);
    assert.strictEqual(delEventBody1.message, 'Không thể xoá sự kiện khi còn suất diễn.');

    // Xoá suất diễn trước -> 200
    const delShowtimeRes = await fetch(`${baseUrl}/api/organizer/showtimes/${st.id}`, {
      method: 'DELETE',
      headers: { cookie: cookieA },
    });
    assert.strictEqual(delShowtimeRes.status, 200);

    // Xoá sự kiện sau khi không còn suất diễn -> 200
    const delEventRes2 = await fetch(`${baseUrl}/api/organizer/events/${ev.id}`, {
      method: 'DELETE',
      headers: { cookie: cookieA },
    });
    assert.strictEqual(delEventRes2.status, 200);

    // Xác nhận đã xoá trong DB
    const checkDb = await db('events').where({ id: ev.id }).first();
    assert.strictEqual(checkDb, undefined);
  });

  test('8. GET /api/organizer/events: organizer chỉ thấy sự kiện của mình kèm showtimes_count, admin thấy tất cả', async () => {
    // Tạo 1 event cho A và 1 event cho B
    const [evA] = await db('events')
      .insert({ title: 'Sự kiện A count test', venue: 'A', status: 'draft', owner_id: organizerA.id })
      .returning('*');
    await db('showtimes').insert([
      { event_id: evA.id, starts_at: new Date('2026-12-01T10:00:00Z'), room_name: 'P1' },
      { event_id: evA.id, starts_at: new Date('2026-12-01T14:00:00Z'), room_name: 'P2' },
    ]);

    const [evB] = await db('events')
      .insert({ title: 'Sự kiện B count test', venue: 'B', status: 'draft', owner_id: organizerB.id })
      .returning('*');

    // Organizer A gọi: chỉ thấy sự kiện của A, không thấy của B
    const resA = await fetch(`${baseUrl}/api/organizer/events`, {
      headers: { cookie: cookieA },
    });
    assert.strictEqual(resA.status, 200);
    const dataA = await resA.json();
    const listA = dataA.data || dataA.events || [];
    const itemA = listA.find((e) => e.id === evA.id);
    assert.ok(itemA);
    assert.strictEqual(itemA.showtimes_count, 2);
    const itemBInA = listA.find((e) => e.id === evB.id);
    assert.strictEqual(itemBInA, undefined, 'Organizer A không được thấy sự kiện của B');

    // Admin gọi: thấy cả sự kiện của A và của B
    const resAdmin = await fetch(`${baseUrl}/api/organizer/events`, {
      headers: { cookie: cookieAdmin },
    });
    assert.strictEqual(resAdmin.status, 200);
    const dataAdmin = await resAdmin.json();
    const listAdmin = dataAdmin.data || dataAdmin.events || [];
    assert.ok(listAdmin.some((e) => e.id === evA.id));
    assert.ok(listAdmin.some((e) => e.id === evB.id));
  });

  test('9. GET /api/organizer/events/:id: trả thông tin sự kiện kèm showtimes sắp theo starts_at', async () => {
    const [ev] = await db('events')
      .insert({ title: 'Sự kiện sắp xếp showtimes', venue: 'Hà Nội', status: 'draft', owner_id: organizerA.id })
      .returning('*');

    // Thêm showtimes lộn xộn thứ tự thời gian
    await db('showtimes').insert([
      { event_id: ev.id, starts_at: new Date('2026-12-05T20:00:00Z'), room_name: 'Suất 2' },
      { event_id: ev.id, starts_at: new Date('2026-12-01T10:00:00Z'), room_name: 'Suất 1' },
      { event_id: ev.id, starts_at: new Date('2026-12-10T15:00:00Z'), room_name: 'Suất 3' },
    ]);

    const res = await fetch(`${baseUrl}/api/organizer/events/${ev.id}`, {
      headers: { cookie: cookieA },
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const event = data.data || data.event;
    const showtimes = event.showtimes || data.showtimes;
    assert.strictEqual(showtimes.length, 3);
    assert.strictEqual(showtimes[0].room_name, 'Suất 1');
    assert.strictEqual(showtimes[1].room_name, 'Suất 2');
    assert.strictEqual(showtimes[2].room_name, 'Suất 3');
  });

  test('10. Kiểm tra dữ liệu: trả 400 { errors: { ... } } khi thiếu trường bắt buộc hoặc sai độ dài', async () => {
    // Thiếu title
    const resNoTitle = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ venue: 'Hà Nội' }),
    });
    assert.strictEqual(resNoTitle.status, 400);
    const bodyNoTitle = await resNoTitle.json();
    assert.ok(bodyNoTitle.errors);
    assert.ok(bodyNoTitle.errors.title);

    // Title quá 200 ký tự
    const resLongTitle = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ title: 'T'.repeat(201), venue: 'Hà Nội' }),
    });
    assert.strictEqual(resLongTitle.status, 400);
    const bodyLongTitle = await resLongTitle.json();
    assert.ok(bodyLongTitle.errors?.title);

    // Thiếu venue
    const resNoVenue = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ title: 'Sự kiện thiếu venue' }),
    });
    assert.strictEqual(resNoVenue.status, 400);
    const bodyNoVenue = await resNoVenue.json();
    assert.ok(bodyNoVenue.errors?.venue);

    // Mô tả quá 5000 ký tự
    const resLongDesc = await fetch(`${baseUrl}/api/organizer/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ title: 'Hợp lệ', venue: 'Hà Nội', description: 'D'.repeat(5001) }),
    });
    assert.strictEqual(resLongDesc.status, 400);
    const bodyLongDesc = await resLongDesc.json();
    assert.ok(bodyLongDesc.errors?.description);
  });

  test('11. Migration: dữ liệu events cũ không có chủ thì được gán cho admin khi migrate', async () => {
    const schemaName = `iso_mig_${process.pid}_${Date.now()}`;
    await db.raw(`CREATE SCHEMA "${schemaName}"`);
    const knex = require('knex');
    const testDb = knex({
      ...db.client.config,
      searchPath: [schemaName],
    });

    try {
      // 1. Chạy 3 migration đầu (trước migration T-09)
      await testDb.migrate.up({ schemaName });
      await testDb.migrate.up({ schemaName });
      await testDb.migrate.up({ schemaName });

      // 2. Chèn tài khoản admin
      const [adminRole] = await testDb('roles').insert({ name: 'admin' }).returning('*');
      const [adminUser] = await testDb('users')
        .insert({
          email: `admin_mig_${Date.now()}@example.test`,
          password_hash: '$argon2id$dummy',
          is_active: true,
        })
        .returning('*');
      await testDb('user_roles').insert({ user_id: adminUser.id, role_id: adminRole.id });

      // 3. Chèn 1 sự kiện cũ (chưa có owner_id, có price, total_tickets)
      const [oldEvent] = await testDb('events')
        .insert({
          title: 'Sự kiện cũ chưa có chủ',
          description: 'Dữ liệu trước T-09',
          price: 150000,
          total_tickets: 50,
        })
        .returning('*');

      // 4. Chạy migration T-09 (migration thứ 4)
      await testDb.migrate.up({ schemaName });

      // 5. Kiểm tra sự kiện cũ đã có owner_id là adminUser.id và status='draft'
      const updatedOldEvent = await testDb('events').where({ id: oldEvent.id }).first();
      assert.ok(updatedOldEvent);
      assert.strictEqual(Number(updatedOldEvent.owner_id), adminUser.id);
      assert.strictEqual(updatedOldEvent.status, 'draft');

      // 6. Kiểm tra rollback và migrate lại trong schema riêng vẫn sạch sẽ
      await testDb.migrate.rollback({ schemaName }, true);
      await testDb.migrate.latest({ schemaName });
    } finally {
      await testDb.destroy();
      await db.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
  });
});

