const argon2 = require('argon2');

/**
 * Seed roles và demo users (admin, organizer)
 * Tuân thủ:
 * - Không xóa dữ liệu khác trong database
 * - Idempotent (có thể chạy lại nhiều lần an toàn)
 * - Hash password bằng argon2id
 * - Không log hoặc in mật khẩu
 * - Kiểm tra đủ 4 biến môi trường cần thiết
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function(knex) {
  // 1. Đảm bảo 5 roles chuẩn luôn tồn tại (dữ liệu nền hệ thống)
  const roleNames = ['buyer', 'organizer', 'checker', 'accountant', 'admin'];
  for (const name of roleNames) {
    await knex('roles')
      .insert({ name })
      .onConflict('name')
      .ignore();
  }

  // Lấy map roleName -> roleId
  const allRoles = await knex('roles').select('id', 'name');
  const roleMap = new Map(allRoles.map((r) => [r.name, r.id]));

  // 2. Tạo tài khoản demo Admin nếu có cấu hình DEMO_ADMIN_*
  const adminEmail = process.env.DEMO_ADMIN_EMAIL;
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    const adminPasswordHash = await argon2.hash(adminPassword, {
      type: argon2.argon2id,
    });

    let adminUser = await knex('users').where({ email: adminEmail }).first();
    if (!adminUser) {
      const [inserted] = await knex('users')
        .insert({
          email: adminEmail,
          password_hash: adminPasswordHash,
          is_active: true,
        })
        .returning('*');
      adminUser = inserted;
    } else {
      await knex('users').where({ id: adminUser.id }).update({
        password_hash: adminPasswordHash,
        is_active: true,
        updated_at: knex.fn.now(),
      });
    }

    const adminRoleId = roleMap.get('admin');
    if (adminRoleId && adminUser) {
      await knex('user_roles')
        .insert({
          user_id: adminUser.id,
          role_id: adminRoleId,
        })
        .onConflict(['user_id', 'role_id'])
        .ignore();
    }
  } else {
    console.warn('[SEED WARN] Bỏ qua tạo tài khoản demo Admin do thiếu DEMO_ADMIN_EMAIL hoặc DEMO_ADMIN_PASSWORD.');
  }

  // 3. Tạo tài khoản demo Organizer nếu có cấu hình DEMO_ORGANIZER_*
  const organizerEmail = process.env.DEMO_ORGANIZER_EMAIL;
  const organizerPassword = process.env.DEMO_ORGANIZER_PASSWORD;

  if (organizerEmail && organizerPassword) {
    const organizerPasswordHash = await argon2.hash(organizerPassword, {
      type: argon2.argon2id,
    });

    let organizerUser = await knex('users').where({ email: organizerEmail }).first();
    if (!organizerUser) {
      const [inserted] = await knex('users')
        .insert({
          email: organizerEmail,
          password_hash: organizerPasswordHash,
          is_active: true,
        })
        .returning('*');
      organizerUser = inserted;
    } else {
      await knex('users').where({ id: organizerUser.id }).update({
        password_hash: organizerPasswordHash,
        is_active: true,
        updated_at: knex.fn.now(),
      });
    }

    const organizerRoleId = roleMap.get('organizer');
    if (organizerRoleId && organizerUser) {
      await knex('user_roles')
        .insert({
          user_id: organizerUser.id,
          role_id: organizerRoleId,
        })
        .onConflict(['user_id', 'role_id'])
        .ignore();
    }
  } else {
    console.warn('[SEED WARN] Bỏ qua tạo tài khoản demo Organizer do thiếu DEMO_ORGANIZER_EMAIL hoặc DEMO_ORGANIZER_PASSWORD.');
  }
};
