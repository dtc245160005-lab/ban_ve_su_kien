const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');
const db = require('../db');
const { start } = require('../index');
const { closeRedis } = require('../lib/redis');

describe('Five-role workspaces and admin staff management', () => {
  let server;
  let baseUrl;
  const password = 'RoleTest@123';
  const stamp = `${Date.now()}_${process.pid}`;
  const emails = {};

  async function createRoleUser(role) {
    const email = `${role}_${stamp}@example.test`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const [user] = await db('users').insert({ email, full_name: `${role} test`, password_hash: passwordHash, is_active: true }).returning('*');
    const roleRow = await db('roles').where({ name: role }).first('id');
    await db('user_roles').insert({ user_id: user.id, role_id: roleRow.id });
    emails[role] = email;
  }

  async function login(role) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emails[role], password }),
    });
    assert.strictEqual(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }

  async function api(path, cookie, options = {}) {
    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', cookie, ...options.headers },
    });
  }

  before(async () => {
    for (const role of ['buyer', 'organizer', 'checker', 'accountant', 'admin']) await createRoleUser(role);
    server = await start({ port: 0 });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.destroy();
    await closeRedis();
  });

  test('mỗi workspace từ chối vai trò không phù hợp ở backend', async () => {
    const buyer = await login('buyer');
    const checker = await login('checker');
    const accountant = await login('accountant');
    assert.strictEqual((await api('/api/workspaces/buyer', buyer)).status, 200);
    assert.strictEqual((await api('/api/workspaces/checker', checker)).status, 200);
    assert.strictEqual((await api('/api/workspaces/accountant', accountant)).status, 200);
    assert.strictEqual((await api('/api/workspaces/checker', buyer)).status, 403);
    assert.strictEqual((await api('/api/workspaces/accountant', checker)).status, 403);
    assert.strictEqual((await api('/api/workspaces/buyer', accountant)).status, 403);
  });

  test('chỉ admin được tạo nhân viên và gán vai trò nhân sự', async () => {
    const admin = await login('admin');
    const organizer = await login('organizer');
    const payload = {
      email: `new_checker_${stamp}@example.test`,
      full_name: 'Nhân viên soát vé',
      password,
      roles: ['checker'],
    };
    const forbidden = await api('/api/workspaces/admin/staff', organizer, { method: 'POST', body: JSON.stringify(payload) });
    assert.strictEqual(forbidden.status, 403);
    const created = await api('/api/workspaces/admin/staff', admin, { method: 'POST', body: JSON.stringify(payload) });
    assert.strictEqual(created.status, 201);
    const body = await created.json();
    assert.deepStrictEqual(body.data.roles, ['checker']);
    assert.strictEqual(body.data.password_hash, undefined);
    const saved = await db('users').where({ email: payload.email }).first();
    assert.ok(saved);
    assert.strictEqual(saved.is_active, true);
  });

  test('admin không thể tạo buyer hoặc admin qua API nhân viên', async () => {
    const admin = await login('admin');
    for (const role of ['buyer', 'admin']) {
      const response = await api('/api/workspaces/admin/staff', admin, {
        method: 'POST',
        body: JSON.stringify({ email: `invalid_${role}_${stamp}@example.test`, full_name: 'Invalid', password, roles: [role] }),
      });
      assert.strictEqual(response.status, 400);
    }
  });
});
