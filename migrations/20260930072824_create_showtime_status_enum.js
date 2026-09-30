/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // 1. Tạo kiểu ENUM showtime_status trong PostgreSQL
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE showtime_status AS ENUM ('draft', 'on_sale', 'closed');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  // 2. Thêm cột status vào bảng showtimes và đánh index composite
  await knex.schema.alterTable('showtimes', (table) => {
    table.specificType('status', 'showtime_status').notNullable().defaultTo('draft');
    table.index(['status', 'starts_at'], 'idx_showtimes_status_starts_at');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('showtimes', (table) => {
    table.dropIndex(['status', 'starts_at'], 'idx_showtimes_status_starts_at');
    table.dropColumn('status');
  });

  await knex.raw('DROP TYPE IF EXISTS showtime_status CASCADE;');
};