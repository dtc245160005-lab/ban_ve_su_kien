const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const argon2 = require('argon2');
const { JSDOM, CookieJar } = require('jsdom');

const testPrefix = `seatmap-ui-test:${process.pid}:`;
process.env.REDIS_KEY_PREFIX = testPrefix;

const start = require('../index');
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

function getBufferFromJsdomBlob(blob) {
  if (!blob) return Buffer.from('');
  const symbols = Object.getOwnPropertySymbols(blob);
  const implSym = symbols.find((s) => s.toString().includes('impl'));
  if (implSym && blob[implSym] && blob[implSym]._buffer) {
    return blob[implSym]._buffer;
  }
  return Buffer.from('');
}

describe('T-14 Seat Map Upload & Preview UI Tests (JSDOM)', () => {
  const defaultPassword = 'Password123!@#';
  const organizerAEmail = `org_seat_ui_a_${process.pid}_${Date.now()}@example.test`;
  const organizerBEmail = `org_seat_ui_b_${process.pid}_${Date.now()}@example.test`;

  let server;
  let baseUrl;
  let organizerA;
  let organizerB;
  let jarA;
  let jarB;
  let eventA;
  let showtimeA;
  let openWindows = [];

  before(async () => {
    await db.raw('SELECT 1');
    await getRedis();
    await cleanTestKeys(redisClient);

    for (const name of ['organizer', 'admin', 'buyer']) {
      await db('roles').insert({ name }).onConflict('name').ignore();
    }
    const rolesFromDb = await db('roles').select('id', 'name');
    const roleMap = new Map(rolesFromDb.map((r) => [r.name, r.id]));

    const passwordHash = await argon2.hash(defaultPassword, { type: argon2.argon2id });

    [organizerA] = await db('users')
      .insert({ email: organizerAEmail, password_hash: passwordHash, is_active: true })
      .returning('*');
    await db('user_roles').insert({ user_id: organizerA.id, role_id: roleMap.get('organizer') });

    [organizerB] = await db('users')
      .insert({ email: organizerBEmail, password_hash: passwordHash, is_active: true })
      .returning('*');
    await db('user_roles').insert({ user_id: organizerB.id, role_id: roleMap.get('organizer') });

    [eventA] = await db('events').insert({
      owner_id: organizerA.id,
      title: 'Sự kiện kiểm tra tải sơ đồ ghế',
      venue: 'Hội trường Nhà hát',
      status: 'draft',
    }).returning('*');

    [showtimeA] = await db('showtimes').insert({
      event_id: eventA.id,
      starts_at: new Date('2028-06-01T19:00:00Z'),
    }).returning('*');

    server = await start({ port: 0 });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const resA = await loginAndGetCookie(baseUrl, organizerAEmail, defaultPassword);
    jarA = new CookieJar();
    jarA.setCookieSync(resA.cookie, baseUrl);

    const resB = await loginAndGetCookie(baseUrl, organizerBEmail, defaultPassword);
    jarB = new CookieJar();
    jarB.setCookieSync(resB.cookie, baseUrl);
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
    if (server) await new Promise((resolve) => server.close(resolve));
    await cleanTestKeys(redisClient);
    await closeRedis();

    if (showtimeA) {
      await db('seats').where({ showtime_id: showtimeA.id }).del();
      await db('seat_categories').where({ showtime_id: showtimeA.id }).del();
      await db('showtimes').where({ id: showtimeA.id }).del();
    }
    if (eventA) {
      await db('events').where({ id: eventA.id }).del();
    }
    const userIds = [organizerA?.id, organizerB?.id].filter(Boolean);
    if (userIds.length > 0) {
      await db('user_roles').whereIn('user_id', userIds).del();
      await db('users').whereIn('id', userIds).del();
    }
    await db.destroy();
  });

  async function openPage(urlPath, options = {}) {
    const cookieJar = options.cookieJar || jarA;
    const { VirtualConsole } = require('jsdom');
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (err) => {
      if (err.message && err.message.includes('HTMLCanvasElement.prototype.getContext')) {
        return; // JSDOM canvas fallback to SVG is expected
      }
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

          let bodyToSend = fetchOpts.body;
          if (fetchOpts.body && fetchOpts.body instanceof window.FormData) {
            const nodeFd = new globalThis.FormData();
            for (const [key, val] of fetchOpts.body.entries()) {
              if (val && typeof val === 'object' && val.name) {
                const buf = getBufferFromJsdomBlob(val);
                nodeFd.append(key, new Blob([buf], { type: val.type }), val.name);
              } else {
                nodeFd.append(key, val);
              }
            }
            bodyToSend = nodeFd;
          }

          const res = await nodeFetch(fullUrl, {
            ...fetchOpts,
            headers,
            body: bodyToSend,
          });
          const setCookie = res.headers.get('set-cookie');
          if (setCookie && cookieJar) {
            cookieJar.setCookieSync(setCookie, fullUrl);
          }
          return res;
        };
      },
    });

    await waitFor(() => {
      const doc = dom.window.document;
      const form = doc.getElementById('uploadSeatMapForm');
      return typeof dom.window.validateSeatMapText === 'function' &&
        form &&
        typeof form.onsubmit === 'function'
        ? dom
        : null;
    });

    openWindows.push(dom.window);
    return dom;
  }

  test('1. Chọn tệp lỗi -> bảng lỗi hiện ra, nút xác nhận disabled, KHÔNG có request nào tới máy chủ', async () => {
    let postSent = false;
    const dom = await openPage(`/seat-map-upload.html?showtimeId=${showtimeA.id}`, {
      cookieJar: jarA,
      fetch: async (url, opts) => {
        if (typeof url === 'string' && url.includes('/seats/import') && opts.method === 'POST') {
          postSent = true;
        }
      },
    });
    const { window } = dom;

    const fixturePath = path.join(__dirname, 'fixtures/seatmaps/multi-error.json');
    const content = fs.readFileSync(fixturePath, 'utf8');

    const fileInput = window.document.getElementById('seatMapFile');
    const uploadBtn = window.document.getElementById('uploadBtn');
    const errorSection = window.document.getElementById('errorSection');
    const previewSection = window.document.getElementById('previewSection');

    // Giả lập chọn tệp multi-error
    const file = new window.File([content], 'multi-error.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));

    // Đợi bảng lỗi hiện ra
    await waitFor(() => {
      return errorSection.style.display !== 'none' ? errorSection : null;
    });

    // Kiểm tra UI
    assert.strictEqual(errorSection.style.display, 'block');
    assert.strictEqual(previewSection.style.display, 'none');
    assert.strictEqual(uploadBtn.disabled, true, 'Nút xác nhận nạp phải bị disabled');

    const rows = window.document.querySelectorAll('#errorTableBody tr');
    assert.ok(rows.length >= 8, `Bảng lỗi phải chứa ít nhất 8 lỗi, nhận được ${rows.length}`);

    // Đảm bảo không có bất kỳ request POST nào được gửi đến máy chủ
    assert.strictEqual(postSent, false, 'Client validation không được gửi request nào tới máy chủ');
  });

  test('2. Chọn tệp đúng -> canvas/svg được vẽ, chú giải có đủ số hạng, nút bật', async () => {
    const dom = await openPage(`/seat-map-upload.html?showtimeId=${showtimeA.id}`, { cookieJar: jarA });
    const { window } = dom;

    const fixturePath = path.join(__dirname, 'fixtures/seatmaps/valid-small.json');
    const content = fs.readFileSync(fixturePath, 'utf8');

    const fileInput = window.document.getElementById('seatMapFile');
    const uploadBtn = window.document.getElementById('uploadBtn');
    const errorSection = window.document.getElementById('errorSection');
    const previewSection = window.document.getElementById('previewSection');

    // Giả lập chọn tệp hợp lệ
    const file = new window.File([content], 'valid-small.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));

    // Đợi phần xem trước xuất hiện
    await waitFor(() => {
      return previewSection.style.display !== 'none' ? previewSection : null;
    });

    assert.strictEqual(errorSection.style.display, 'none');
    assert.strictEqual(previewSection.style.display, 'block');
    assert.strictEqual(uploadBtn.disabled, false, 'Nút xác nhận nạp phải được kích hoạt');

    // Chú giải có đủ số hạng
    const legendItems = window.document.querySelectorAll('#legendContainer .legend-item');
    assert.strictEqual(legendItems.length, 2, 'Chú giải phải có đủ 2 hạng ghế (VIP và Thường)');
    const legendText = window.document.getElementById('legendContainer').textContent;
    assert.ok(legendText.includes('VIP'));
    assert.ok(legendText.includes('Thường'));

    // Canvas hoặc SVG được vẽ
    const hasSvgOrCanvas = window.document.querySelector('#seatGridContainer svg') ||
      window.document.querySelector('#seatGridContainer canvas[data-rendered="true"]');
    assert.ok(hasSvgOrCanvas, 'Phải có phần tử SVG hoặc Canvas được render trong #seatGridContainer');

    // Tổng số ghế và số hàng hiển thị đúng
    assert.strictEqual(window.document.getElementById('summarySeatCount').textContent, '10');
    assert.strictEqual(window.document.getElementById('summaryCategoryCount').textContent, '2');
    assert.strictEqual(window.document.getElementById('summaryRowCount').textContent, '3');
  });

  test('3. Bấm xác nhận -> đúng 1 request, DB có đúng số ghế', async () => {
    let postRequestCount = 0;
    const dom = await openPage(`/seat-map-upload.html?showtimeId=${showtimeA.id}`, {
      cookieJar: jarA,
      fetch: async (url, opts) => {
        if (typeof url === 'string' && url.includes('/seats/import') && opts.method === 'POST') {
          postRequestCount++;
        }
      },
    });
    const { window } = dom;

    const fixturePath = path.join(__dirname, 'fixtures/seatmaps/valid-small.json');
    const content = fs.readFileSync(fixturePath, 'utf8');

    const fileInput = window.document.getElementById('seatMapFile');
    const uploadBtn = window.document.getElementById('uploadBtn');
    const form = window.document.getElementById('uploadSeatMapForm');

    // Chọn tệp hợp lệ
    const file = new window.File([content], 'valid-small.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));

    await waitFor(() => (!uploadBtn.disabled ? uploadBtn : null));

    // Bấm xác nhận nạp
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // Đợi thông báo thành công
    await waitFor(() => {
      const msg = window.document.getElementById('uploadMsg');
      return msg && msg.textContent.includes('thành công') ? msg : null;
    });

    // Kiểm tra đúng 1 request được gửi
    assert.strictEqual(postRequestCount, 1, 'Chỉ duy nhất 1 request POST được gửi tới máy chủ');

    // Kiểm tra CSDL có đúng 10 ghế
    const [{ count }] = await db('seats').where({ showtime_id: showtimeA.id }).count('* as count');
    assert.equal(Number(count), 10, 'CSDL phải lưu đúng 10 ghế');
  });

  test('4. Chọn tệp vượt quá 5 MB -> báo lỗi ngay tại client, nút xác nhận disabled', async () => {
    const dom = await openPage(`/seat-map-upload.html?showtimeId=${showtimeA.id}`, { cookieJar: jarA });
    const { window } = dom;

    const fileInput = window.document.getElementById('seatMapFile');
    const uploadBtn = window.document.getElementById('uploadBtn');
    const fileError = window.document.getElementById('seatMapFileError');

    const bigFile = new window.File(['dummy'], 'large_seatmap.json', { type: 'application/json' });
    Object.defineProperty(bigFile, 'size', { value: 6 * 1024 * 1024, configurable: true });
    Object.defineProperty(fileInput, 'files', { value: [bigFile], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));

    await waitFor(() => (fileError.textContent.trim().length > 0 ? fileError : null));

    assert.match(fileError.textContent, /5 MB/);
    assert.strictEqual(uploadBtn.disabled, true);
    assert.strictEqual(window.document.getElementById('errorSection').style.display, 'none');
  });

  test('5. Organizer B mở suất diễn của Organizer A -> bấm nạp nhận thông báo không có quyền', async () => {
    const dom = await openPage(`/seat-map-upload.html?showtimeId=${showtimeA.id}`, { cookieJar: jarB });
    const { window } = dom;

    const fixturePath = path.join(__dirname, 'fixtures/seatmaps/valid-small.json');
    const content = fs.readFileSync(fixturePath, 'utf8');

    const fileInput = window.document.getElementById('seatMapFile');
    const uploadBtn = window.document.getElementById('uploadBtn');
    const form = window.document.getElementById('uploadSeatMapForm');

    // Chọn tệp hợp lệ
    const file = new window.File([content], 'valid-small.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));

    await waitFor(() => (!uploadBtn.disabled ? uploadBtn : null));

    // Bấm nạp
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // Đợi thông báo lỗi quyền
    await waitFor(() => {
      const msg = window.document.getElementById('uploadMsg');
      return msg && msg.textContent.includes('Bạn không có quyền') ? msg : null;
    });

    const msg = window.document.getElementById('uploadMsg');
    assert.strictEqual(msg.textContent.trim(), 'Bạn không có quyền với suất diễn này');
  });
});
