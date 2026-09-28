const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { visibleMenus, MENU_ITEMS } = require('../public/menu');

describe('Menu Visibility Logic (public/menu.js)', () => {
  const EVENT_MGMT = MENU_ITEMS.EVENT_MANAGEMENT; // "Quản lý sự kiện"
  const RECONCILIATION = MENU_ITEMS.RECONCILIATION; // "Đối soát"

  test('organizer: có "Quản lý sự kiện", KHÔNG có "Đối soát"', () => {
    const menus = visibleMenus(['organizer']);
    assert.ok(menus.includes(EVENT_MGMT), 'Phải có Quản lý sự kiện');
    assert.ok(!menus.includes(RECONCILIATION), 'KHÔNG được có Đối soát');
  });

  test('accountant: có "Đối soát", KHÔNG có "Quản lý sự kiện"', () => {
    const menus = visibleMenus(['accountant']);
    assert.ok(menus.includes(RECONCILIATION), 'Phải có Đối soát');
    assert.ok(!menus.includes(EVENT_MGMT), 'KHÔNG được có Quản lý sự kiện');
  });

  test('admin: có cả hai', () => {
    const menus = visibleMenus(['admin']);
    assert.ok(menus.includes(EVENT_MGMT), 'Admin phải có Quản lý sự kiện');
    assert.ok(menus.includes(RECONCILIATION), 'Admin phải có Đối soát');
  });

  test('buyer: không có mục nào trong hai mục trên', () => {
    const menus = visibleMenus(['buyer']);
    assert.ok(!menus.includes(EVENT_MGMT), 'Buyer không có Quản lý sự kiện');
    assert.ok(!menus.includes(RECONCILIATION), 'Buyer không có Đối soát');
  });

  test('checker: không có mục nào trong hai mục trên', () => {
    const menus = visibleMenus(['checker']);
    assert.ok(!menus.includes(EVENT_MGMT), 'Checker không có Quản lý sự kiện');
    assert.ok(!menus.includes(RECONCILIATION), 'Checker không có Đối soát');
  });

  test('roles rỗng hoặc undefined: không có mục nào', () => {
    const emptyMenus = visibleMenus([]);
    assert.ok(!emptyMenus.includes(EVENT_MGMT), 'Roles rỗng không có Quản lý sự kiện');
    assert.ok(!emptyMenus.includes(RECONCILIATION), 'Roles rỗng không có Đối soát');
    assert.strictEqual(emptyMenus.length, 0);

    const undefinedMenus = visibleMenus(undefined);
    assert.ok(!undefinedMenus.includes(EVENT_MGMT), 'Undefined không có Quản lý sự kiện');
    assert.ok(!undefinedMenus.includes(RECONCILIATION), 'Undefined không có Đối soát');
    assert.strictEqual(undefinedMenus.length, 0);

    const nullMenus = visibleMenus(null);
    assert.ok(!nullMenus.includes(EVENT_MGMT), 'Null không có Quản lý sự kiện');
    assert.ok(!nullMenus.includes(RECONCILIATION), 'Null không có Đối soát');
    assert.strictEqual(nullMenus.length, 0);
  });

  test('buyer + organizer: có "Quản lý sự kiện"', () => {
    const menus = visibleMenus(['buyer', 'organizer']);
    assert.ok(menus.includes(EVENT_MGMT), 'Buyer + Organizer phải có Quản lý sự kiện');
    assert.ok(!menus.includes(RECONCILIATION), 'Buyer + Organizer KHÔNG được có Đối soát');
  });
});
