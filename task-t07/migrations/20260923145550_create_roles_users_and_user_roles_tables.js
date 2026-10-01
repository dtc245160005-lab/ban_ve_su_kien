/**
 * Migration tạo ba bảng: roles, users, user_roles
 * Thiết lập hành vi xóa:
 * - user_roles.user_id: onDelete('CASCADE') - Khi user bị xóa, các bản ghi phân quyền của user đó trong user_roles tự động bị xóa.
 * - user_roles.role_id: onDelete('CASCADE') - Khi role bị xóa, các liên kết của role đó trong user_roles tự động bị xóa.
 * Lựa chọn CASCADE vì user_roles là bảng quan hệ nhiều-nhiều (junction table). Một bản ghi user_roles không có ý nghĩa
 * nếu thiếu user hoặc role tương ứng. Việc sử dụng CASCADE giúp duy trì toàn vẹn dữ liệu (referential integrity)
 * và tránh tạo ra các bản ghi mồ côi (orphan records).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Tạo bảng roles
  await knex.schema.createTable('roles', function(table) {
    table.increments('id').primary();
    table.string('name').notNullable().unique();
    table.timestamps(true, true);
  });

  // 2. Tạo bảng users
  await knex.schema.createTable('users', function(table) {
    table.increments('id').primary();
    table.string('email').notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  // 3. Tạo bảng user_roles (bảng liên kết nhiều - nhiều)
  await knex.schema.createTable('user_roles', function(table) {
    table.integer('user_id').unsigned().notNullable();
    table.integer('role_id').unsigned().notNullable();

    // Khóa ngoại tới users.id và roles.id với hành vi xóa CASCADE
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
    table.foreign('role_id').references('id').inTable('roles').onDelete('CASCADE');

    // Khóa chính ghép gồm user_id và role_id (ngăn chặn gán trùng cùng một role cho user)
    table.primary(['user_id', 'role_id']);
  });
};

/**
 * Hàm down: Xóa các bảng theo đúng thứ tự phụ thuộc ngược lại:
 * user_roles -> users -> roles
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('user_roles');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('roles');
};
