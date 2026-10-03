const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, CookieJar, VirtualConsole } = require('jsdom');
const whatwgURL = require('whatwg-url');
const LocationImpl = require('jsdom/lib/jsdom/living/window/Location-impl.js');
const argon2 = require('argon2');

// Intercept JSDOM navigation to track URL updates properly
LocationImpl.implementation.prototype._locationObjectNavigate = function (url, _flags) {
  const serialized = whatwgURL.serializeURL(url);
  this._relevantDocument._URL = url;
  if (this._relevantDocument._defaultView) {
    this._relevantDocument._defaultView._lastNavigatedUrl = serialized;
  }
};

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

async function waitFor(predicate, timeout = 4000, interval = 25) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  const finalResult = await predicate();
  if (finalResult) return finalResult;
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

describe('T-18 Public Catalog UI Tests (JSDOM)', () => {
  const defaultPassword = 'Password123!@#';
  let app;
  let server;
  let baseUrl;
  let organizer;
  let eventPublished;
  let showtimeOnSale;
  let showtimeClosed;
  let mockRedis;
  const openWindows = [];

  before(async () => {
    await db.raw('SELECT 1');

    for (const name of ['organizer', 'admin', 'buyer']) {
      await db('roles').insert({ name }).onConflict('name').ignore();
    }
    const rolesFromDb = await db('roles').select('id', 'name');
    const orgRole = rolesFromDb.find((r) => r.name === 'organizer');

    const passwordHash = await argon2.hash(defaultPassword, { type: argon2.argon2id });
    [organizer] = await db('users')
      .insert({
        email: `pubcat_ui_org_${process.pid}_${Date.now()}@example.test`,
        password_hash: passwordHash,
        is_active: true,
      })
      .returning('*');

    await db('user_roles').insert({ user_id: organizer.id, role_id: orgRole.id });

    [eventPublished] = await db('events')
      .insert({
        owner_id: organizer.id,
        title: `Hòa Nhạc Giao Hưởng Mùa Thu ${Date.now()}`,
        description: 'Đêm diễn âm nhạc thính phòng đặc biệt đỉnh cao.',
        venue: 'Nhà hát Thành phố',
        status: 'published',
      })
      .returning('*');

    [showtimeOnSale] = await db('showtimes')
      .insert({
        event_id: eventPublished.id,
        starts_at: new Date(Date.now() + 15 * 24 * 3600 * 1000),
        room_name: 'Khán phòng chính',
        status: 'on_sale',
      })
      .returning('*');

    [showtimeClosed] = await db('showtimes')
      .insert({
        event_id: eventPublished.id,
        starts_at: new Date(Date.now() + 16 * 24 * 3600 * 1000),
        room_name: 'Khán phòng phụ',
        status: 'closed',
      })
      .returning('*');

    mockRedis = createMockRedis();
    app = createApp({ db, redis: mockRedis });
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
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

    if (eventPublished) {
      await db('seats').whereIn('showtime_id', [showtimeOnSale.id, showtimeClosed.id]).del();
      await db('seat_categories').whereIn('showtime_id', [showtimeOnSale.id, showtimeClosed.id]).del();
      await db('showtimes').whereIn('event_id', [eventPublished.id]).del();
      await db('events').where({ id: eventPublished.id }).del();
    }

    if (organizer) {
      await db('user_roles').where({ user_id: organizer.id }).del();
      await db('users').where({ id: organizer.id }).del();
    }

    await db.destroy();
  });

  async function openPage(urlPath, options = {}) {
    const cookieJar = options.cookieJar || new CookieJar();
    const virtualConsole = new VirtualConsole();
    virtualConsole.sendTo(console);
    virtualConsole.on('jsdomError', (err) => {
      console.error(err);
    });

    const dom = await JSDOM.fromURL(`${baseUrl}${urlPath}`, {
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      cookieJar,
      virtualConsole,
      beforeParse(window) {
        window.alert = options.alert || (() => {});
        window.confirm = options.confirm || (() => true);

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
          return res;
        };
      },
    });

    openWindows.push(dom.window);
    return dom.window;
  }

  it('1. Trang chi tiết onSale=false: hiển thị thông báo "Suất diễn này hiện không mở bán" và ẩn nút "Chọn ghế"', async () => {
    const window = await openPage(`/showtime.html?id=${showtimeClosed.id}`);

    await waitFor(() => {
      const notice = window.document.getElementById('notOnSaleNotice');
      return notice && notice.style.display !== 'none';
    });

    const notice = window.document.getElementById('notOnSaleNotice');
    assert.ok(notice.textContent.includes('Suất diễn này hiện không mở bán'));

    const chooseSeatBtn = window.document.getElementById('chooseSeatBtn');
    assert.strictEqual(chooseSeatBtn.style.display, 'none', 'Nút chọn ghế phải bị ẩn khi onSale=false');

    const titleEl = window.document.getElementById('showtimeTitle');
    assert.strictEqual(titleEl.textContent, eventPublished.title);
  });

  it('2. Chưa đăng nhập: bấm Chọn ghế chuyển tới login.html?next=<encodeURIComponent("/seat-map.html?showtime=<id>")>', async () => {
    const window = await openPage(`/showtime.html?id=${showtimeOnSale.id}`);

    await waitFor(() => {
      const detail = window.document.getElementById('showtimeDetail');
      const chooseSeatBtn = window.document.getElementById('chooseSeatBtn');
      return detail && detail.style.display === 'block' && chooseSeatBtn && chooseSeatBtn.style.display !== 'none';
    });

    const chooseSeatBtn = window.document.getElementById('chooseSeatBtn');
    assert.ok(chooseSeatBtn, 'Nút chọn ghế phải tồn tại');

    // Bấm nút chọn ghế khi chưa đăng nhập (không có cookie phiên -> GET /api/auth/session trả 401)
    chooseSeatBtn.click();

    const expectedSeatMapPath = `/seat-map.html?showtime=${showtimeOnSale.id}`;
    const expectedRedirectQuery = `next=${encodeURIComponent(expectedSeatMapPath)}`;

    await waitFor(() => {
      return (
        window.location.pathname === '/login.html' &&
        window.location.search.includes(expectedRedirectQuery)
      );
    });

    assert.strictEqual(window.location.pathname, '/login.html');
    assert.ok(
      window.location.search.includes(encodeURIComponent(expectedSeatMapPath)),
      `Redirect query phải chứa encodeURIComponent('/seat-map.html?showtime=${showtimeOnSale.id}')`
    );
  });

  it('3. Thẻ chia sẻ mạng xã hội: meta og:title, og:description, title được cập nhật sau khi tải dữ liệu', async () => {
    const window = await openPage(`/showtime.html?id=${showtimeOnSale.id}`);

    await waitFor(() => {
      const ogTitle = window.document.querySelector('meta[property="og:title"]');
      return ogTitle && ogTitle.getAttribute('content') === eventPublished.title;
    });

    const ogTitle = window.document.querySelector('meta[property="og:title"]');
    assert.strictEqual(ogTitle.getAttribute('content'), eventPublished.title);

    const ogDesc = window.document.querySelector('meta[property="og:description"]');
    assert.strictEqual(ogDesc.getAttribute('content'), eventPublished.description);

    const metaDesc = window.document.querySelector('meta[name="description"]');
    assert.strictEqual(metaDesc.getAttribute('content'), eventPublished.description);

    assert.ok(window.document.title.includes(eventPublished.title));
  });

  it('4. Trang chủ home.html: hiển thị danh sách suất diễn đang bán và có liên kết tới trang chi tiết', async () => {
    const window = await openPage('/home.html');

    await waitFor(() => {
      const cards = window.document.querySelectorAll('.showtime-card');
      return Array.from(cards).some((c) => c.textContent.includes(eventPublished.title));
    });

    const cards = window.document.querySelectorAll('.showtime-card');
    assert.ok(cards.length >= 1);

    const myCard = Array.from(cards).find((c) => c.textContent.includes(eventPublished.title));
    assert.ok(myCard, 'Phải tìm thấy thẻ suất diễn của sự kiện đã tạo');
    assert.ok(myCard.textContent.includes('Giá sẽ cập nhật'));

    const detailLink = myCard.querySelector('a');
    assert.ok(detailLink);
    assert.ok(
      detailLink.getAttribute('href').includes(`/showtime.html?id=${showtimeOnSale.id}`),
      'Thẻ suất diễn phải có link tới trang chi tiết /showtime.html?id=...'
    );
  });
});
