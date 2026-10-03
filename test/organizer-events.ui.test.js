const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');
const { JSDOM, CookieJar } = require('jsdom');
const whatwgURL = require('whatwg-url');
const LocationImpl = require('jsdom/lib/jsdom/living/window/Location-impl.js');

const testPrefix = `bvsk-ui-test:${process.pid}:`;
process.env.REDIS_KEY_PREFIX = testPrefix;

const start = require('../index');
const db = require('../db');
const { getRedis, redisClient, closeRedis } = require('../lib/redis');

// Intercept JSDOM navigation to track URL updates properly
LocationImpl.implementation.prototype._locationObjectNavigate = function (url, _flags) {
  const serialized = whatwgURL.serializeURL(url);
  this._relevantDocument._URL = url;
  if (this._relevantDocument._defaultView) {
    this._relevantDocument._defaultView._lastNavigatedUrl = serialized;
  }
};

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

async function waitFor(predicate, timeout = 4000, interval = 25) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch {
      // ignore & retry
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  const finalResult = await predicate();
  if (finalResult) return finalResult;
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

describe('T-10 Organizer Events UI Tests (JSDOM)', () => {
  const defaultPassword = 'Password123!@#';
  const organizerAEmail = `org_ui_a_${process.pid}_${Date.now()}@example.test`;
  const organizerBEmail = `org_ui_b_${process.pid}_${Date.now()}@example.test`;

  let server;
  let baseUrl;
  let organizerA;
  let organizerB;
  let cookieA;
  let cookieB;
  let jarA;
  let jarB;
  let createdEventIds = [];
  let openWindows = [];

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

    // Tạo Organizer A
    [organizerA] = await db('users')
      .insert({ email: organizerAEmail, password_hash: passwordHash, is_active: true })
      .returning('*');
    await db('user_roles').insert({ user_id: organizerA.id, role_id: roleMap.get('organizer') });

    // Tạo Organizer B
    [organizerB] = await db('users')
      .insert({ email: organizerBEmail, password_hash: passwordHash, is_active: true })
      .returning('*');
    await db('user_roles').insert({ user_id: organizerB.id, role_id: roleMap.get('organizer') });

    // Khởi động server
    server = await start({ port: 0 });
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Đăng nhập lấy cookie
    const resA = await loginAndGetCookie(baseUrl, organizerAEmail, defaultPassword);
    cookieA = resA.cookie;
    jarA = new CookieJar();
    jarA.setCookieSync(cookieA, baseUrl);

    const resB = await loginAndGetCookie(baseUrl, organizerBEmail, defaultPassword);
    cookieB = resB.cookie;
    jarB = new CookieJar();
    jarB.setCookieSync(cookieB, baseUrl);
  });

  afterEach(() => {
    while (openWindows.length > 0) {
      const win = openWindows.pop();
      try {
        win.close();
      } catch {
        // ignore
      }
    }
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await cleanTestKeys(redisClient);
    await closeRedis();

    const userIds = [organizerA?.id, organizerB?.id].filter(Boolean);
    if (userIds.length > 0) {
      const allEvents = await db('events').whereIn('owner_id', userIds).select('id');
      const allEventIds = allEvents.map((e) => e.id);
      if (allEventIds.length > 0) {
        await db('showtimes').whereIn('event_id', allEventIds).del();
        await db('events').whereIn('id', allEventIds).del();
      }
      await db('user_roles').whereIn('user_id', userIds).del();
      await db('users').whereIn('id', userIds).del();
    }

    await db.destroy();
  });

  async function openPage(urlPath, options = {}) {
    const cookieJar = options.cookieJar || jarA;
    const dom = await JSDOM.fromURL(`${baseUrl}${urlPath}`, {
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      cookieJar,
      beforeParse(window) {
        window.alert = options.alert || (() => {});
        window.confirm = options.confirm || (() => true);
        window.prompt = options.prompt || ((_msg, def) => def);

        const nodeFetch = globalThis.fetch;
        window.fetch = async (url, fetchOpts = {}) => {
          if (typeof options.fetch === 'function') {
            const intercepted = await options.fetch(url, fetchOpts, window);
            if (intercepted) return intercepted;
          }
          const fullUrl = typeof url === 'string' && url.startsWith('/') ? `${baseUrl}${url}` : url;
          const headers = new Headers(fetchOpts.headers || {});
          if (!headers.has('cookie') && cookieJar) {
            const c = cookieJar.getCookieStringSync(fullUrl);
            if (c) headers.set('cookie', c);
          }
          const res = await nodeFetch(fullUrl, {
            ...fetchOpts,
            headers,
          });
          const setCookie = res.headers.get('set-cookie');
          if (setCookie && cookieJar) {
            cookieJar.setCookieSync(setCookie, fullUrl);
          }
          return res;
        };
      },
    });

    // Chờ scripts tải và gắn xong các handler
    await waitFor(() => {
      const doc = dom.window.document;
      const form = doc.getElementById('createEventForm');
      return typeof dom.window.validateEventForm === 'function' &&
        form &&
        typeof form.onsubmit === 'function'
        ? dom
        : null;
    });

    openWindows.push(dom.window);
    return dom;
  }

  test('a. Danh sách: A có 2 sự kiện sẵn thì trang hiện đúng 2 dòng với đúng tiêu đề; KHÔNG hiện sự kiện của B', async () => {
    // Seed 2 sự kiện cho A, 1 sự kiện cho B
    const [evA1] = await db('events')
      .insert({ owner_id: organizerA.id, title: 'Đêm Nhạc Trịnh A1', venue: 'Nhà hát Lớn', status: 'draft' })
      .returning('*');
    const [evA2] = await db('events')
      .insert({ owner_id: organizerA.id, title: 'Hòa Nhạc Cổ Điển A2', venue: 'Nhạc viện', status: 'draft' })
      .returning('*');
    const [evB1] = await db('events')
      .insert({ owner_id: organizerB.id, title: 'Sự Kiện Riêng Tư B1', venue: 'Trung tâm B', status: 'draft' })
      .returning('*');

    createdEventIds.push(evA1.id, evA2.id, evB1.id);

    const dom = await openPage('/organizer-events.html', { cookieJar: jarA });
    const { window } = dom;

    const cards = await waitFor(() => {
      const items = window.document.querySelectorAll('#eventsListContainer .event-card');
      return items.length >= 2 ? items : null;
    });

    const cardTexts = Array.from(cards).map((c) => c.textContent);
    const combinedText = cardTexts.join(' | ');

    assert.ok(combinedText.includes('Đêm Nhạc Trịnh A1'), 'Danh sách phải có sự kiện A1');
    assert.ok(combinedText.includes('Hòa Nhạc Cổ Điển A2'), 'Danh sách phải có sự kiện A2');
    assert.ok(!combinedText.includes('Sự Kiện Riêng Tư B1'), 'Danh sách KHÔNG được hiện sự kiện của B');
  });

  test('b. Tạo: điền form hợp lệ, submit. Danh sách có thêm dòng mới, DB có bản ghi status="draft", owner_id = A', async () => {
    const newTitle = `Hội Nghị Công Nghệ Mới ${Date.now()}`;
    const dom = await openPage('/organizer-events.html', { cookieJar: jarA });
    const { window } = dom;

    await waitFor(() => {
      const summary = window.document.getElementById('accountSummary');
      return summary && summary.textContent.includes('organizer') ? summary : null;
    });

    const titleInput = window.document.getElementById('createTitle');
    const venueInput = window.document.getElementById('createVenue');
    const descInput = window.document.getElementById('createDescription');
    const form = window.document.getElementById('createEventForm');

    titleInput.value = newTitle;
    venueInput.value = 'Trung tâm Hội nghị Quốc gia';
    descInput.value = 'Mô tả hội nghị công nghệ năm 2026';

    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // Đợi thông báo thành công và danh sách có thêm dòng mới
    await waitFor(() => {
      const msg = window.document.getElementById('createEventMsg');
      return msg && msg.textContent.includes('thành công') ? msg : null;
    });

    await waitFor(() => {
      const container = window.document.getElementById('eventsListContainer');
      return container && container.textContent.includes(newTitle) ? container : null;
    });

    // Kiểm tra CSDL
    const created = await db('events').where({ title: newTitle }).first();
    assert.ok(created, 'Sự kiện phải tồn tại trong CSDL');
    assert.strictEqual(created.status, 'draft');
    assert.strictEqual(Number(created.owner_id), organizerA.id);
    createdEventIds.push(created.id);
  });

  test('c. Lỗi tại ô (phía trình duyệt): để trống title rồi submit. Lỗi hiện ngay dưới ô title, không có request POST nào được gửi đi', async () => {
    let postSent = false;
    const dom = await openPage('/organizer-events.html', {
      cookieJar: jarA,
      fetch: async (url, opts, _win) => {
        if (typeof url === 'string' && url.includes('/api/organizer/events') && opts.method === 'POST') {
          postSent = true;
        }
      },
    });
    const { window } = dom;

    const titleInput = window.document.getElementById('createTitle');
    const venueInput = window.document.getElementById('createVenue');
    const form = window.document.getElementById('createEventForm');
    const titleError = window.document.getElementById('createTitleError');

    titleInput.value = '   '; // trống
    venueInput.value = 'Địa điểm hợp lệ';

    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // Lỗi hiện ngay dưới ô title
    await waitFor(() => {
      return titleError.textContent.trim().length > 0 ? titleError : null;
    });

    assert.match(titleError.textContent, /Tên sự kiện là bắt buộc/);
    assert.strictEqual(postSent, false, 'Không được gửi bất kỳ request POST nào đến máy chủ');
  });

  test('d. Lỗi tại ô (từ máy chủ): gửi venue dài 300 ký tự (tạm tắt kiểm tra phía trình duyệt). Máy chủ trả 400 và lỗi hiện đúng dưới ô venue', async () => {
    const dom = await openPage('/organizer-events.html', { cookieJar: jarA });
    const { window } = dom;

    const titleInput = window.document.getElementById('createTitle');
    const venueInput = window.document.getElementById('createVenue');
    const venueError = window.document.getElementById('createVenueError');
    const form = window.document.getElementById('createEventForm');

    // Tạm tắt kiểm tra phía trình duyệt và bỏ maxlength để test lỗi trả về từ máy chủ
    venueInput.removeAttribute('maxlength');
    window.validateEventForm = () => ({ valid: true, errors: {} });

    titleInput.value = 'Sự kiện có venue quá dài';
    venueInput.value = 'V'.repeat(300);

    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // Máy chủ trả 400 và lỗi hiện đúng dưới ô venue
    await waitFor(() => {
      return venueError.textContent.trim().length > 0 ? venueError : null;
    });

    assert.match(venueError.textContent, /255 ký tự/);
  });

  test('e. Sửa: mở sự kiện, đổi title, lưu. Danh sách và DB đều có title mới', async () => {
    const [eventToEdit] = await db('events')
      .insert({ owner_id: organizerA.id, title: 'Tên Ban Đầu Để Sửa', venue: 'Hội trường 1', status: 'draft' })
      .returning('*');
    createdEventIds.push(eventToEdit.id);

    const dom = await openPage(`/organizer-events.html?id=${eventToEdit.id}`, { cookieJar: jarA });
    const { window } = dom;

    // Chờ chi tiết sự kiện tải xong
    await waitFor(() => {
      const editTitle = window.document.getElementById('editTitle');
      return editTitle && editTitle.value === 'Tên Ban Đầu Để Sửa' ? editTitle : null;
    });

    const editTitle = window.document.getElementById('editTitle');
    const editForm = window.document.getElementById('editEventForm');
    const updatedTitle = `Tên Đã Cập Nhật ${Date.now()}`;

    editTitle.value = updatedTitle;
    editForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // Đợi thông báo thành công
    await waitFor(() => {
      const msg = window.document.getElementById('editEventMsg');
      return msg && msg.textContent.includes('thành công') ? msg : null;
    });

    // Kiểm tra trong CSDL
    const fromDb = await db('events').where({ id: eventToEdit.id }).first();
    assert.strictEqual(fromDb.title, updatedTitle);

    // Mở trang danh sách để kiểm tra tiêu đề mới hiển thị
    const listDom = await openPage('/organizer-events.html', { cookieJar: jarA });
    await waitFor(() => {
      const container = listDom.window.document.getElementById('eventsListContainer');
      return container && container.textContent.includes(updatedTitle) ? container : null;
    });
  });

  test('f. Suất diễn: thêm suất ở tương lai hiện theo Asia/Ho_Chi_Minh; thêm suất trùng giờ hiện cảnh báo vàng; nhập giờ quá khứ hiện lỗi', async () => {
    const [eventWithSt] = await db('events')
      .insert({ owner_id: organizerA.id, title: 'Sự kiện Quản Lý Suất Diễn', venue: 'Rạp Galaxy', status: 'draft' })
      .returning('*');
    createdEventIds.push(eventWithSt.id);

    const dom = await openPage(`/organizer-events.html?id=${eventWithSt.id}`, { cookieJar: jarA });
    const { window } = dom;

    // Đợi form chỉnh sửa và chi tiết tải hoàn tất
    await waitFor(() => {
      const editTitle = window.document.getElementById('editTitle');
      return editTitle && editTitle.value === 'Sự kiện Quản Lý Suất Diễn' ? editTitle : null;
    });

    const startsAtInput = window.document.getElementById('showtimeStartsAt');
    const roomInput = window.document.getElementById('showtimeRoomName');
    const stForm = window.document.getElementById('addShowtimeForm');
    const startsAtError = window.document.getElementById('showtimeStartsAtError');
    const warningBanner = window.document.getElementById('showtimeWarning');

    // 1. Thêm suất diễn ở tương lai
    startsAtInput.value = '2030-10-20T19:30';
    roomInput.value = 'Khán phòng Sao Mai';
    stForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // Đợi xuất hiện trong danh sách suất diễn
    await waitFor(() => {
      const row = window.document.querySelector('#showtimesListContainer .showtime-row');
      return row ? row : null;
    });

    const firstRowText = window.document.querySelector('#showtimesListContainer .showtime-row').textContent;
    assert.ok(firstRowText.includes('20/10'), 'Thời gian phải hiển thị đúng ngày Việt Nam');
    assert.ok(firstRowText.includes('19:30'), 'Thời gian phải hiển thị đúng giờ Việt Nam');
    assert.ok(firstRowText.includes('Khán phòng Sao Mai'), 'Phải hiển thị tên phòng');

    // 2. Thêm suất trùng giờ: hiện cảnh báo vàng và vẫn lưu
    startsAtInput.value = '2030-10-20T19:30';
    roomInput.value = 'Khán phòng Thăng Long';
    stForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => {
      return warningBanner.style.display === 'block' && warningBanner.textContent.trim().length > 0
        ? warningBanner
        : null;
    });

    assert.ok(warningBanner.textContent.includes('Trùng thời điểm'), 'Phải hiển thị cảnh báo trùng giờ');

    await waitFor(() => {
      const rows = window.document.querySelectorAll('#showtimesListContainer .showtime-row');
      return rows.length === 2 ? rows : null;
    });

    const showtimesInDb = await db('showtimes').where({ event_id: eventWithSt.id });
    assert.strictEqual(showtimesInDb.length, 2, 'Cả hai suất diễn phải được lưu vào CSDL');

    // 3. Nhập giờ quá khứ: lỗi hiện dưới ô thời gian
    startsAtInput.value = '2020-01-01T08:00';
    roomInput.value = 'Phòng Quá Khứ';
    stForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => {
      return startsAtError.textContent.trim().length > 0 ? startsAtError : null;
    });

    assert.match(startsAtError.textContent, /Thời điểm bắt đầu phải ở tương lai/);
  });

  test('publish button makes a ready draft visible to buyers', async () => {
    const [event] = await db('events').insert({
      owner_id: organizerA.id, title: 'Ready for sale', venue: 'Venue', status: 'draft',
    }).returning('*');
    createdEventIds.push(event.id);
    const [showtime] = await db('showtimes').insert({
      event_id: event.id, starts_at: new Date(Date.now() + 86400000),
    }).returning('*');
    const [category] = await db('seat_categories').insert({ showtime_id: showtime.id, name: 'VIP' }).returning('*');
    await db('seats').insert({ showtime_id: showtime.id, category_id: category.id, row_label: 'A', seat_number: 1 });

    const dom = await openPage(`/organizer-events.html?id=${event.id}`, { cookieJar: jarA });
    const { window } = dom;
    const button = await waitFor(() => {
      const candidate = window.document.getElementById('publishEventBtn');
      return candidate && !candidate.hidden && typeof candidate.onclick === 'function' ? candidate : null;
    });
    button.click();
    await waitFor(async () => (await db('events').where({ id: event.id }).first()).status === 'published');
    await waitFor(() => button.hidden);
    assert.match(window.document.getElementById('eventStatusBadge').textContent, /Đã xuất bản/);
  });

  test('g. Quyền: mở ?id=<sự kiện của B> thì trang hiện "Bạn không có quyền xem sự kiện này"', async () => {
    const [eventOfB] = await db('events')
      .insert({ owner_id: organizerB.id, title: 'Sự kiện Bí Mật Của B', venue: 'B Location', status: 'draft' })
      .returning('*');
    createdEventIds.push(eventOfB.id);

    // Organizer A mở sự kiện của B
    const dom = await openPage(`/organizer-events.html?id=${eventOfB.id}`, { cookieJar: jarA });
    const { window } = dom;

    await waitFor(() => {
      const forbidden = window.document.getElementById('forbiddenMessage');
      return forbidden && forbidden.style.display === 'block' ? forbidden : null;
    });

    const forbiddenMsg = window.document.getElementById('forbiddenMessage');
    const detailContent = window.document.getElementById('detailContent');

    assert.strictEqual(forbiddenMsg.textContent.trim(), 'Bạn không có quyền xem sự kiện này');
    assert.strictEqual(detailContent.style.display, 'none', 'Nội dung chi tiết sự kiện phải bị ẩn');
  });

  test('h. Chống gửi hai lần: làm chậm POST với độ trễ 300ms, dispatch submit 2 lần. Nút disabled trong lúc chờ, chỉ 1 request POST được gửi, DB có 1 bản ghi', async () => {
    let postCount = 0;
    const delayedTitle = `Chống Double Submit ${Date.now()}`;

    const dom = await openPage('/organizer-events.html', {
      cookieJar: jarA,
      fetch: async (url, opts, _win) => {
        if (typeof url === 'string' && url.includes('/api/organizer/events') && opts.method === 'POST') {
          postCount++;
          // Làm chậm 300ms
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      },
    });
    const { window } = dom;

    const titleInput = window.document.getElementById('createTitle');
    const venueInput = window.document.getElementById('createVenue');
    const form = window.document.getElementById('createEventForm');
    const btn = window.document.getElementById('createEventBtn');

    titleInput.value = delayedTitle;
    venueInput.value = 'Hội trường Chống Đúp';

    // Bấm submit 2 lần liên tiếp
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.strictEqual(btn.disabled, true, 'Nút phải bị vô hiệu hóa ngay khi bắt đầu gửi');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // Đợi hoàn tất phản hồi từ máy chủ
    await waitFor(() => {
      const msg = window.document.getElementById('createEventMsg');
      return msg && msg.textContent.includes('thành công') && btn.disabled === false ? btn : null;
    });

    assert.strictEqual(postCount, 1, 'Chỉ duy nhất 1 request POST được gửi đi');
    assert.strictEqual(btn.disabled, false, 'Sau khi có phản hồi thì nút được bật lại');

    const createdRows = await db('events').where({ title: delayedTitle });
    assert.strictEqual(createdRows.length, 1, 'CSDL chỉ được tạo đúng 1 bản ghi mới');
    createdEventIds.push(createdRows[0].id);
  });

  test('i. Hết phiên: xoá phiên trong Redis rồi thao tác. Trang chuyển location về /login.html?next=...', async () => {
    const dom = await openPage('/organizer-events.html', { cookieJar: jarA });
    const { window } = dom;

    await waitFor(() => {
      const summary = window.document.getElementById('accountSummary');
      return summary && summary.textContent.includes('organizer') ? summary : null;
    });

    // Xoá toàn bộ phiên trong Redis
    await cleanTestKeys(redisClient);

    const titleInput = window.document.getElementById('createTitle');
    const venueInput = window.document.getElementById('createVenue');
    const form = window.document.getElementById('createEventForm');

    titleInput.value = 'Sự kiện khi phiên đã chết';
    venueInput.value = 'Địa điểm Test Phiên';

    // Gửi form khi phiên đã mất -> API trả về 401
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // Đợi trang chuyển hướng location về /login.html?next=...
    await waitFor(() => {
      return window.location.pathname === '/login.html' && window.location.search.includes('next=')
        ? window.location.href
        : null;
    });

    assert.strictEqual(window.location.pathname, '/login.html');
    assert.match(window.location.search, /next=%2Forganizer-events\.html/);
  });
});
