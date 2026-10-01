/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Tạo kiểu ENUM nếu chưa có trong PostgreSQL
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'showtime_status') THEN
        CREATE TYPE showtime_status AS ENUM ('draft', 'published', 'on_sale', 'sold_out', 'closed', 'cancelled');
      END IF;
    END $$;
  `);

  // 2. Thêm cột status vào bảng showtimes dùng kiểu enum vừa tạo
  const hasColumn = await knex.schema.hasColumn('showtimes', 'status');
  if (!hasColumn) {
    await knex.schema.alterTable('showtimes', (table) => {
      table.specificType('status', 'showtime_status').notNullable().defaultTo('draft');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // 1. Xóa cột status trước
  const hasColumn = await knex.schema.hasColumn('showtimes', 'status');
  if (hasColumn) {
    await knex.schema.alterTable('showtimes', (table) => {
      table.dropColumn('status');
    });
  }

  // 2. Xóa kiểu ENUM sau khi đã bỏ cột
  await knex.raw(`DROP TYPE IF EXISTS showtime_status;`);
};