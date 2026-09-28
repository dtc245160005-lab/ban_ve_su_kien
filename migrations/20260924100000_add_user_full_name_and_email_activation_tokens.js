/**
 * Migration thêm cột full_name cho users và tạo bảng email_activation_tokens
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Thêm cột full_name vào bảng users (cho phép null để tương thích dữ liệu cũ)
  await knex.schema.alterTable('users', function(table) {
    table.string('full_name', 100).nullable();
  });

  // 2. Tạo bảng email_activation_tokens
  await knex.schema.createTable('email_activation_tokens', function(table) {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable();
    table.specificType('token_hash', 'char(64)').notNullable().unique();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('used_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Khóa ngoại tới users.id với hành vi xóa CASCADE
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');

    // Index trên user_id để tối ưu tìm kiếm token của người dùng
    table.index('user_id');
  });
};

/**
 * Hàm down: Rollback an toàn theo thứ tự phụ thuộc ngược
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('email_activation_tokens');
  await knex.schema.alterTable('users', function(table) {
    table.dropColumn('full_name');
  });
};
