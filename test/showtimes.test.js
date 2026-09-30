const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');

const testPrefix = `bvsk-st-test:${process.pid}:`;
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

describe('S-04 / T-09 / T-10 Showtimes Management API Tests', () => {
  const defaultPassword = 'Password123!@#';
  const organizerAEmail = `st_org_a_${process.pid}@example.test`;
  const organizerBEmail = `st_org_b_${process.pid}@example.test`;
  const adminEmail = `st_admin_${process.pid}@example.test`;

  let app;
  let server;
  let baseUrl;
  let organizerA;
  let organizerB;
  let adminUser;
  let cookieA;
  let cookieB;
  let cookieAdmin;
  let eventA;

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

    // 4. Tạo sự kiện mẫu của Organizer A
    [eventA] = await db('events')
      .insert({
        title: 'Đêm nhạc Trịnh Công Sơn',
        venue: 'Cung Văn hóa Hữu nghị Việt Xô',
        status: 'draft',
        owner_id: organizerA.id,
      })
      .returning('*');

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
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await cleanTestKeys(redisClient);
    await closeRedis();

    const testUsers = [organizerA?.id, organizerB?.id, adminUser?.id].filter(Boolean);
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

  test('1. Thêm suất diễn ở tương lai: 201', async () => {
    const futureDate = '2026-11-15T19:30:00+07:00';
    const res = await fetch(`${baseUrl}/api/organizer/events/${eventA.id}/showtimes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({
        starts_at: futureDate,
        room_name: 'Khán phòng A',
      }),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    const st = data.data || data.showtime;
    assert.ok(st.id);
    assert.strictEqual(Number(st.event_id), eventA.id);
    assert.strictEqual(st.room_name, 'Khán phòng A');
    assert.strictEqual(data.warnings, undefined);
  });

  test('2. Thêm suất diễn ở quá khứ: 400 kèm lỗi rõ ràng', async () => {
    const pastDate = '2026-01-01T10:00:00+07:00';
    const res = await fetch(`${baseUrl}/api/organizer/events/${eventA.id}/showtimes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({
        starts_at: pastDate,
        room_name: 'Phòng quá khứ',
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.errors);
    assert.strictEqual(data.errors.starts_at, 'Thời điểm bắt đầu phải ở tương lai.');
  });

  test('3. Thêm suất diễn với chuỗi không có múi giờ: 400', async () => {
    const dateWithoutTz = '2026-12-01T19:30:00';
    const res = await fetch(`${baseUrl}/api/organizer/events/${eventA.id}/showtimes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({
        starts_at: dateWithoutTz,
        room_name: 'Phòng không timezone',
      }),
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.errors);
    assert.ok(data.errors.starts_at);
  });

  test('4. Hai suất diễn cùng sự kiện trùng hoàn toàn thời gian: suất thứ hai vẫn nhận 201 kèm warnings', async () => {
    const duplicateTime = '2026-12-25T20:00:00+07:00';

    // Tạo suất diễn thứ nhất
    const res1 = await fetch(`${baseUrl}/api/organizer/events/${eventA.id}/showtimes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({
        starts_at: duplicateTime,
        room_name: 'Sân khấu chính',
      }),
    });
    assert.strictEqual(res1.status, 201);
    const data1 = await res1.json();
    const st1 = data1.data || data1.showtime;
    assert.strictEqual(data1.warnings, undefined);

    // Tạo suất diễn thứ hai trùng đúng thời điểm duplicateTime
    const res2 = await fetch(`${baseUrl}/api/organizer/events/${eventA.id}/showtimes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({
        starts_at: duplicateTime,
        room_name: 'Sân khấu phụ',
      }),
    });
    assert.strictEqual(res2.status, 201);
    const data2 = await res2.json();
    assert.ok(data2.warnings, 'Phải có mảng cảnh báo warnings');
    assert.strictEqual(Array.isArray(data2.warnings), true);
    assert.ok(data2.warnings.length > 0);
    assert.ok(data2.warnings[0].includes(`Trùng thời điểm với suất diễn #${st1.id}`));
  });

  test('5. Lưu "2026-12-01T19:30:00+07:00" thì DB lưu 12:30 UTC, và API trả lại đúng thời điểm đó', async () => {
    const inputTime = '2026-12-01T19:30:00+07:00';
    const res = await fetch(`${baseUrl}/api/organizer/events/${eventA.id}/showtimes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({
        starts_at: inputTime,
        room_name: 'Phòng kiểm tra UTC',
      }),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    const st = data.data || data.showtime;

    // Kiểm tra bản ghi trong PostgreSQL qua db.raw để xem thời gian UTC
    const rawResult = await db.raw(
      `SELECT to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as utc_str FROM showtimes WHERE id = ?`,
      [st.id]
    );
    const storedUtc = rawResult.rows[0].utc_str;
    assert.strictEqual(storedUtc, '2026-12-01T12:30:00Z', 'CSDL phải lưu chính xác 12:30:00 UTC');

    // Kiểm tra API trả lại thời điểm khớp với thời điểm gốc
    const returnedTime = new Date(st.starts_at).toISOString();
    assert.strictEqual(returnedTime, '2026-12-01T12:30:00.000Z');
  });

  test('6. Sửa suất diễn (PUT): hợp lệ (200), ở quá khứ (400), trùng giờ với suất khác (200 + warnings)', async () => {
    const [stA1] = await db('showtimes')
      .insert({
        event_id: eventA.id,
        starts_at: new Date('2026-12-10T14:00:00Z'),
        room_name: 'Phòng gốc',
      })
      .returning('*');

    const [stA2] = await db('showtimes')
      .insert({
        event_id: eventA.id,
        starts_at: new Date('2026-12-10T16:00:00Z'),
        room_name: 'Phòng mốc',
      })
      .returning('*');

    // Sửa hợp lệ -> 200
    const updateValidRes = await fetch(`${baseUrl}/api/organizer/showtimes/${stA1.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({
        starts_at: '2026-12-10T15:00:00Z',
        room_name: 'Phòng đã sửa',
      }),
    });
    assert.strictEqual(updateValidRes.status, 200);
    const updateData = await updateValidRes.json();
    const updatedSt = updateData.data || updateData.showtime;
    assert.strictEqual(updatedSt.room_name, 'Phòng đã sửa');

    // Sửa thành giờ quá khứ -> 400
    const updatePastRes = await fetch(`${baseUrl}/api/organizer/showtimes/${stA1.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({
        starts_at: '2026-01-01T10:00:00Z',
      }),
    });
    assert.strictEqual(updatePastRes.status, 400);

    // Sửa trùng giờ với stA2 (16:00:00Z) -> 200 kèm warnings
    const updateDupRes = await fetch(`${baseUrl}/api/organizer/showtimes/${stA1.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({
        starts_at: '2026-12-10T16:00:00Z',
      }),
    });
    assert.strictEqual(updateDupRes.status, 200);
    const updateDupData = await updateDupRes.json();
    assert.ok(updateDupData.warnings);
    assert.ok(updateDupData.warnings[0].includes(`#${stA2.id}`));
  });

  test('7. Phân quyền: Organizer B không được thêm, sửa, xoá suất diễn của sự kiện A: 403', async () => {
    // B thêm suất diễn vào sự kiện của A -> 403
    const addRes = await fetch(`${baseUrl}/api/organizer/events/${eventA.id}/showtimes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieB },
      body: JSON.stringify({
        starts_at: '2026-12-12T10:00:00Z',
      }),
    });
    assert.strictEqual(addRes.status, 403);

    // Tạo 1 showtime của A
    const [st] = await db('showtimes')
      .insert({
        event_id: eventA.id,
        starts_at: new Date('2026-12-12T10:00:00Z'),
      })
      .returning('*');

    // B sửa suất diễn của A -> 403
    const putRes = await fetch(`${baseUrl}/api/organizer/showtimes/${st.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: cookieB },
      body: JSON.stringify({
        starts_at: '2026-12-12T11:00:00Z',
      }),
    });
    assert.strictEqual(putRes.status, 403);

    // B xoá suất diễn của A -> 403
    const delRes = await fetch(`${baseUrl}/api/organizer/showtimes/${st.id}`, {
      method: 'DELETE',
      headers: { cookie: cookieB },
    });
    assert.strictEqual(delRes.status, 403);

    // Thử ID không tồn tại -> 404
    const notFoundRes = await fetch(`${baseUrl}/api/organizer/showtimes/999999`, {
      method: 'DELETE',
      headers: { cookie: cookieA },
    });
    assert.strictEqual(notFoundRes.status, 404);
  });

  test('8. Admin có quyền thêm, sửa, xoá suất diễn của sự kiện A', async () => {
    // Admin thêm suất diễn -> 201
    const addRes = await fetch(`${baseUrl}/api/organizer/events/${eventA.id}/showtimes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieAdmin },
      body: JSON.stringify({
        starts_at: '2026-12-30T10:00:00Z',
        room_name: 'Phòng VIP Admin',
      }),
    });
    assert.strictEqual(addRes.status, 201);
    const addData = await addRes.json();
    const stId = (addData.data || addData.showtime).id;

    // Admin sửa suất diễn -> 200
    const putRes = await fetch(`${baseUrl}/api/organizer/showtimes/${stId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: cookieAdmin },
      body: JSON.stringify({
        starts_at: '2026-12-30T11:00:00Z',
        room_name: 'Phòng VIP Admin Đã Đổi',
      }),
    });
    assert.strictEqual(putRes.status, 200);

    // Admin xoá suất diễn -> 200
    const delRes = await fetch(`${baseUrl}/api/organizer/showtimes/${stId}`, {
      method: 'DELETE',
      headers: { cookie: cookieAdmin },
    });
    assert.strictEqual(delRes.status, 200);
  });

  test('9. Trạng thái showtime: trả số ghế, đổi trạng thái và kiểm tra quyền', async () => {
    const [emptyShowtime] = await db('showtimes')
      .insert({
        event_id: eventA.id,
        starts_at: new Date('2026-12-31T10:00:00Z'),
      })
      .returning('*');

    const noSeatsRes = await fetch(`${baseUrl}/api/organizer/showtimes/${emptyShowtime.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ status: 'on_sale' }),
    });
    assert.strictEqual(noSeatsRes.status, 409);

    const [showtime] = await db('showtimes')
      .insert({
        event_id: eventA.id,
        starts_at: new Date('2027-01-01T10:00:00Z'),
      })
      .returning('*');
    const [category] = await db('seat_categories')
      .insert({ showtime_id: showtime.id, name: 'Phổ thông' })
      .returning('*');
    await db('seats').insert({
      showtime_id: showtime.id,
      category_id: category.id,
      row_label: 'A',
      seat_number: 1,
    });

    const detailRes = await fetch(`${baseUrl}/api/organizer/events/${eventA.id}`, {
      headers: { cookie: cookieA },
    });
    assert.strictEqual(detailRes.status, 200);
    const detailData = await detailRes.json();
    const returnedShowtime = detailData.data.showtimes.find((item) => item.id === showtime.id);
    assert.strictEqual(Number(returnedShowtime.seat_count), 1);

    const openRes = await fetch(`${baseUrl}/api/organizer/showtimes/${showtime.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ status: 'on_sale' }),
    });
    assert.strictEqual(openRes.status, 200);
    assert.strictEqual((await openRes.json()).data.status, 'on_sale');

    const closeRes = await fetch(`${baseUrl}/api/organizer/showtimes/${showtime.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ status: 'closed' }),
    });
    assert.strictEqual(closeRes.status, 200);
    assert.strictEqual((await closeRes.json()).data.status, 'closed');

    const unauthorizedRes = await fetch(`${baseUrl}/api/organizer/showtimes/${showtime.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieB },
      body: JSON.stringify({ status: 'on_sale' }),
    });
    assert.strictEqual(unauthorizedRes.status, 403);
  });
});
