const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');
const db = require('../db');

describe('T-04 Database Schema & Seed Verification', () => {
  after(async () => {
    await db.destroy();
  });

  test('CSDL phải tồn tại đủ 3 bảng: roles, users, user_roles', async () => {
    const hasRoles = await db.schema.hasTable('roles');
    const hasUsers = await db.schema.hasTable('users');
    const hasUserRoles = await db.schema.hasTable('user_roles');

    assert.equal(hasRoles, true, 'Bảng roles phải tồn tại');
    assert.equal(hasUsers, true, 'Bảng users phải tồn tại');
    assert.equal(hasUserRoles, true, 'Bảng user_roles phải tồn tại');
  });

  test('Phải có đủ 5 vai trò bắt buộc trong bảng roles', async () => {
    const roles = await db('roles').select('name');
    const roleNames = new Set(roles.map((r) => r.name));
    const requiredRoles = ['buyer', 'organizer', 'checker', 'accountant', 'admin'];

    for (const role of requiredRoles) {
      assert.ok(roleNames.has(role), `Thiếu role bắt buộc: ${role}`);
    }
  });

  test('Tài khoản demo Admin và Organizer phải tồn tại và được gán đúng vai trò', async () => {
    const adminEmail = process.env.DEMO_ADMIN_EMAIL || 'admin@example.com';
    const organizerEmail = process.env.DEMO_ORGANIZER_EMAIL || 'organizer@example.com';

    const adminUser = await db('users').where({ email: adminEmail }).first();
    const organizerUser = await db('users').where({ email: organizerEmail }).first();

    assert.ok(adminUser, `Tài khoản demo admin (${adminEmail}) phải tồn tại`);
    assert.ok(organizerUser, `Tài khoản demo organizer (${organizerEmail}) phải tồn tại`);

    const adminRole = await db('roles').where({ name: 'admin' }).first();
    const organizerRole = await db('roles').where({ name: 'organizer' }).first();
    assert.ok(adminRole, 'Role admin phải tồn tại');
    assert.ok(organizerRole, 'Role organizer phải tồn tại');

    const adminAssignment = await db('user_roles')
      .where({ user_id: adminUser.id, role_id: adminRole.id })
      .first();
    const organizerAssignment = await db('user_roles')
      .where({ user_id: organizerUser.id, role_id: organizerRole.id })
      .first();

    assert.ok(adminAssignment, 'Tài khoản admin phải được gán role admin');
    assert.ok(organizerAssignment, 'Tài khoản organizer phải được gán role organizer');
  });

  test('Mật khẩu demo phải được hash bằng Argon2id và kiểm tra verify thành công', async () => {
    const adminEmail = process.env.DEMO_ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.DEMO_ADMIN_PASSWORD || 'DemoAdmin@123456';
    const organizerEmail = process.env.DEMO_ORGANIZER_EMAIL || 'organizer@example.com';
    const organizerPassword = process.env.DEMO_ORGANIZER_PASSWORD || 'DemoOrganizer@123456';

    const adminUser = await db('users').where({ email: adminEmail }).first();
    const organizerUser = await db('users').where({ email: organizerEmail }).first();

    assert.ok(adminUser.password_hash.startsWith('$argon2id$'), 'Admin password_hash phải bắt đầu bằng $argon2id$');
    assert.ok(organizerUser.password_hash.startsWith('$argon2id$'), 'Organizer password_hash phải bắt đầu bằng $argon2id$');
    assert.notEqual(adminUser.password_hash, adminPassword, 'Password hash không được trùng với mật khẩu thô');
    assert.notEqual(organizerUser.password_hash, organizerPassword, 'Password hash không được trùng với mật khẩu thô');

    const adminVerified = await argon2.verify(adminUser.password_hash, adminPassword);
    const organizerVerified = await argon2.verify(organizerUser.password_hash, organizerPassword);

    assert.equal(adminVerified, true, 'Xác thực mật khẩu admin bằng argon2.verify phải thành công');
    assert.equal(organizerVerified, true, 'Xác thực mật khẩu organizer bằng argon2.verify phải thành công');
  });

  test('Ràng buộc UNIQUE email của users phải ngăn chặn email trùng lặp', async () => {
    const adminEmail = process.env.DEMO_ADMIN_EMAIL || 'admin@example.com';
    let duplicateErrorCaught = false;

    const trx = await db.transaction();
    try {
      await trx('users').insert({
        email: adminEmail,
        password_hash: '$argon2id$dummyhashforemailtest',
        is_active: true,
      });
    } catch (err) {
      if (err.code === '23505' || err.message.includes('unique') || err.message.includes('duplicate')) {
        duplicateErrorCaught = true;
      }
    } finally {
      await trx.rollback();
    }

    assert.equal(duplicateErrorCaught, true, 'Chèn email trùng lặp phải sinh lỗi vi phạm UNIQUE constraint');
  });

  test('Khóa chính ghép của user_roles phải ngăn chặn gán trùng role cho cùng một user', async () => {
    const adminEmail = process.env.DEMO_ADMIN_EMAIL || 'admin@example.com';
    const adminUser = await db('users').where({ email: adminEmail }).first();
    const adminRole = await db('roles').where({ name: 'admin' }).first();

    let duplicatePkCaught = false;
    const trx = await db.transaction();
    try {
      await trx('user_roles').insert({
        user_id: adminUser.id,
        role_id: adminRole.id,
      });
    } catch (err) {
      if (err.code === '23505' || err.message.includes('unique') || err.message.includes('duplicate') || err.message.includes('primary')) {
        duplicatePkCaught = true;
      }
    } finally {
      await trx.rollback();
    }

    assert.equal(duplicatePkCaught, true, 'Gán trùng (user_id, role_id) phải sinh lỗi vi phạm khóa chính');
  });
});
