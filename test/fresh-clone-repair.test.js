const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const { checkSchema } = require('../services/schemaCheck');
const seedModule = require('../seeds/01_roles_and_demo_users');
const repairMigration = require('../migrations/20260930120000_repair_email_activation_tokens_purpose');

describe('Fresh Clone & Schema Repair Tests', () => {
  before(async () => {
    // Đảm bảo migration đã chạy
    await db.migrate.latest();
  });

  after(async () => {
    await db.destroy();
  });

  test('1. schemaCheck báo OK khi database đầy đủ cột và 5 vai trò', async () => {
    const result = await checkSchema(db);
    assert.equal(result.ok, true, 'checkSchema phải trả về ok = true');
    for (const item of result.items) {
      assert.equal(item.status, 'OK', `Item ${item.id} phải có status OK`);
    }
  });

  test('2. schemaCheck báo LỖI chính xác khi thiếu cột hoặc vai trò', async () => {
    // Mock client để mô phỏng DB thiếu dữ liệu
    const mockClient = {
      raw: async (sql) => {
        if (sql.includes('information_schema.tables')) {
          return {
            rows: [
              { table_name: 'users' },
              { table_name: 'email_activation_tokens' },
              { table_name: 'showtimes' },
              { table_name: 'seats' },
              { table_name: 'seat_categories' },
              { table_name: 'roles' },
            ],
          };
        }
        if (sql.includes('information_schema.columns')) {
          return {
            rows: [
              { table_name: 'users', column_name: 'full_name' },
              // Thiếu is_active ở users
              { table_name: 'email_activation_tokens', column_name: 'token_hash' },
              { table_name: 'email_activation_tokens', column_name: 'used_at' },
              // Thiếu purpose ở email_activation_tokens
              { table_name: 'showtimes', column_name: 'starts_at' },
            ],
          };
        }
        if (sql.includes('SELECT name FROM roles')) {
          return {
            rows: [
              { name: 'organizer' },
              { name: 'admin' },
              // Thiếu buyer, checker, accountant
            ],
          };
        }
        return { rows: [] };
      },
    };

    const result = await checkSchema(mockClient);
    assert.equal(result.ok, false, 'checkSchema phải trả về ok = false khi thiếu dữ liệu');
    const failedItems = result.items.filter((i) => i.status !== 'OK');
    const descriptions = failedItems.map((i) => i.description).join('; ');

    assert.ok(descriptions.includes('is_active'), 'Phải báo thiếu is_active trong users');
    assert.ok(descriptions.includes('purpose'), 'Phải báo thiếu purpose trong email_activation_tokens');
    assert.ok(descriptions.includes('buyer'), 'Phải báo thiếu buyer trong roles');
  });

  test('3. Không có DEMO_* thì seed không ném lỗi và vẫn có đủ 5 vai trò', async () => {
    const originalAdminEmail = process.env.DEMO_ADMIN_EMAIL;
    const originalAdminPassword = process.env.DEMO_ADMIN_PASSWORD;
    const originalOrgEmail = process.env.DEMO_ORGANIZER_EMAIL;
    const originalOrgPassword = process.env.DEMO_ORGANIZER_PASSWORD;

    try {
      delete process.env.DEMO_ADMIN_EMAIL;
      delete process.env.DEMO_ADMIN_PASSWORD;
      delete process.env.DEMO_ORGANIZER_EMAIL;
      delete process.env.DEMO_ORGANIZER_PASSWORD;

      // Chạy seed không có DEMO_*
      await assert.doesNotReject(async () => {
        await seedModule.seed(db);
      }, 'Seed không được ném lỗi khi thiếu biến DEMO_*');

      // Kiểm tra 5 vai trò hệ thống vẫn tồn tại
      const roles = await db('roles').select('name');
      const roleNames = roles.map((r) => r.name);
      for (const expected of ['buyer', 'organizer', 'checker', 'accountant', 'admin']) {
        assert.ok(roleNames.includes(expected), `Vai trò ${expected} phải tồn tại`);
      }
    } finally {
      // Phục hồi lại biến môi trường
      if (originalAdminEmail) process.env.DEMO_ADMIN_EMAIL = originalAdminEmail;
      if (originalAdminPassword) process.env.DEMO_ADMIN_PASSWORD = originalAdminPassword;
      if (originalOrgEmail) process.env.DEMO_ORGANIZER_EMAIL = originalOrgEmail;
      if (originalOrgPassword) process.env.DEMO_ORGANIZER_PASSWORD = originalOrgPassword;
    }
  });

  test('4. Migration sửa lệch: bảng email_activation_tokens giả lập thiếu purpose được vá thành công', async () => {
    // Tạm thời drop column purpose và constraint để mô phỏng DB cũ
    await db.raw('ALTER TABLE email_activation_tokens DROP CONSTRAINT IF EXISTS email_activation_tokens_purpose_check');
    await db.schema.alterTable('email_activation_tokens', (t) => {
      t.dropColumn('purpose');
    });

    const hasPurposeLegacy = await db.schema.hasColumn('email_activation_tokens', 'purpose');
    assert.equal(hasPurposeLegacy, false, 'Đã mô phỏng DB cũ thiếu cột purpose');

    // Chạy migration vá lỗi
    await repairMigration.up(db);

    const hasPurposeRepaired = await db.schema.hasColumn('email_activation_tokens', 'purpose');
    assert.equal(hasPurposeRepaired, true, 'Sau khi chạy repairMigration.up, cột purpose phải xuất hiện');

    // Đăng ký / chèn token phải thành công
    const user = await db('users').first();
    const testUserId = user ? user.id : 1;
    await assert.doesNotReject(async () => {
      await db('email_activation_tokens').insert({
        user_id: testUserId,
        purpose: 'register',
        token_hash: 'testhash_' + Date.now() + '1234567890123456789012345678901234567890',
        expires_at: new Date(Date.now() + 86400000),
      });
    }, 'Phải chèn token thành công với purpose = register');

    // Xoá token test
    await db('email_activation_tokens').where('token_hash', 'like', 'testhash_%').del();
  });
});
