/**
 * Migration chèn 5 vai trò hệ thống nền tảng vào bảng roles.
 * Các vai trò hệ thống: buyer, organizer, checker, accountant, admin.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const roleNames = ['buyer', 'organizer', 'checker', 'accountant', 'admin'];

  for (const name of roleNames) {
    await knex('roles')
      .insert({ name })
      .onConflict('name')
      .ignore();
  }
};

/**
 * Hàm down: Rollback an toàn, chỉ xoá các vai trò KHÔNG có người dùng nào đang sử dụng.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasRoles = await knex.schema.hasTable('roles');
  if (!hasRoles) return;

  const hasUserRoles = await knex.schema.hasTable('user_roles');
  const roleNames = ['buyer', 'organizer', 'checker', 'accountant', 'admin'];

  for (const name of roleNames) {
    const role = await knex('roles').where({ name }).first('id');
    if (role) {
      let inUse = false;
      if (hasUserRoles) {
        const usage = await knex('user_roles').where({ role_id: role.id }).first('user_id');
        if (usage) inUse = true;
      }
      if (!inUse) {
        await knex('roles').where({ id: role.id }).del();
      }
    }
  }
};
