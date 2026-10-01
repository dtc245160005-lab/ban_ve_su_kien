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
  // 1. Kiểm tra 4 biến môi trường bắt buộc
  const requiredEnvVars = [
    'DEMO_ADMIN_EMAIL',
    'DEMO_ADMIN_PASSWORD',
    'DEMO_ORGANIZER_EMAIL',
    'DEMO_ORGANIZER_PASSWORD',
  ];
  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  // 2. Định nghĩa danh sách 5 roles chuẩn
  const roleNames = ['buyer', 'organizer', 'checker', 'accountant', 'admin'];

  // Seed roles: Chèn các role chưa tồn tại, không xóa role khác
  for (const name of roleNames) {
    await knex('roles')
      .insert({ name })
      .onConflict('name')
      .ignore();
  }

  // Lấy map roleName -> roleId
  const allRoles = await knex('roles').select('id', 'name');
  const roleMap = new Map(allRoles.map((r) => [r.name, r.id]));

  // 3. Hash mật khẩu bằng argon2id (tuyệt đối không log hoặc lưu mật khẩu thô)
  const adminPasswordHash = await argon2.hash(process.env.DEMO_ADMIN_PASSWORD, {
    type: argon2.argon2id,
  });
  const organizerPasswordHash = await argon2.hash(process.env.DEMO_ORGANIZER_PASSWORD, {
    type: argon2.argon2id,
  });

  // 4. Seed hoặc cập nhật tài khoản demo Admin
  const adminEmail = process.env.DEMO_ADMIN_EMAIL;
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

  // 5. Seed hoặc cập nhật tài khoản demo Organizer
  const organizerEmail = process.env.DEMO_ORGANIZER_EMAIL;
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

  // 6. Gán role cho demo users (admin -> admin, organizer -> organizer)
  const adminRoleId = roleMap.get('admin');
  const organizerRoleId = roleMap.get('organizer');

  if (adminRoleId && adminUser) {
    await knex('user_roles')
      .insert({
        user_id: adminUser.id,
        role_id: adminRoleId,
      })
      .onConflict(['user_id', 'role_id'])
      .ignore();
  }

  if (organizerRoleId && organizerUser) {
    await knex('user_roles')
      .insert({
        user_id: organizerUser.id,
        role_id: organizerRoleId,
      })
      .onConflict(['user_id', 'role_id'])
      .ignore();
  }
};
