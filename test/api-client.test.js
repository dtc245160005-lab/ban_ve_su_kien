const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  safeNext,
  buildLoginRedirect,
  handleResponse,
} = require('../public/api');

describe('Client-Side API & Security Helpers (public/api.js)', () => {
  describe('safeNext()', () => {
    test('trả về /app.html với các đường dẫn nguy hiểm hoặc giao thức không hợp lệ', () => {
      assert.strictEqual(safeNext('//evil.com'), '/app.html');
      assert.strictEqual(safeNext('https://evil.com'), '/app.html');
      assert.strictEqual(safeNext('/\\evil.com'), '/app.html');
      assert.strictEqual(safeNext('javascript:alert(1)'), '/app.html');
    });

    test('giữ nguyên đường dẫn nội bộ hợp lệ bắt đầu bằng /', () => {
      assert.strictEqual(safeNext('/events?id=1'), '/events?id=1');
      assert.strictEqual(safeNext('/dashboard'), '/dashboard');
      assert.strictEqual(safeNext('/app.html'), '/app.html');
    });

    test('trả về /app.html khi tham số rỗng, null hoặc không phải chuỗi', () => {
      assert.strictEqual(safeNext(''), '/app.html');
      assert.strictEqual(safeNext(null), '/app.html');
      assert.strictEqual(safeNext(undefined), '/app.html');
    });
  });

  describe('buildLoginRedirect()', () => {
    test('tạo đường dẫn /login.html?next=... với giá trị được encode', () => {
      assert.strictEqual(buildLoginRedirect('/events?id=1'), `/login.html?next=${encodeURIComponent('/events?id=1')}`);
      assert.strictEqual(buildLoginRedirect('/app.html'), `/login.html?next=${encodeURIComponent('/app.html')}`);
      assert.strictEqual(buildLoginRedirect(''), `/login.html?next=${encodeURIComponent('/app.html')}`);
    });
  });

  describe('handleResponse()', () => {
    test('khi nhận HTTP 401 thì chuyển về /login.html có tham số next', () => {
      const mockLocation = {
        pathname: '/events',
        search: '?id=1',
        href: '',
      };

      const res = { status: 401 };
      handleResponse(res, mockLocation);

      assert.strictEqual(
        mockLocation.href,
        `/login.html?next=${encodeURIComponent('/events?id=1')}`
      );
    });

    test('hai phản hồi 401 liên tiếp không lồng /login.html vào tham số next', () => {
      let currentUrl = new URL('https://example.test/organizer-events.html');
      const mockLocation = {
        get pathname() { return currentUrl.pathname; },
        get search() { return currentUrl.search; },
        get href() { return currentUrl.href; },
        set href(value) { currentUrl = new URL(value, currentUrl); },
      };
      const res = { status: 401 };

      handleResponse(res, mockLocation);
      const firstRedirect = mockLocation.href;
      handleResponse(res, mockLocation);

      assert.strictEqual(mockLocation.href, firstRedirect);
      assert.strictEqual(mockLocation.search, '?next=%2Forganizer-events.html');
    });

    test('khi nhận HTTP 200 thì KHÔNG chuyển hướng (location.href không đổi)', () => {
      const mockLocation = {
        pathname: '/events',
        search: '?id=1',
        href: '',
      };

      const res = { status: 200 };
      handleResponse(res, mockLocation);

      assert.strictEqual(mockLocation.href, '');
    });
  });
});
