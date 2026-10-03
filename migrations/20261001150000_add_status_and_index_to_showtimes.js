/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('showtimes', 'status');
  if (!hasColumn) {
    await knex.schema.alterTable('showtimes', (table) => {
      table.string('status', 20).notNullable().defaultTo('draft');
    });
  }

  // 1. Thêm CHECK constraint đảm bảo khớp đúng 3 trạng thái
  await knex.raw(`
    ALTER TABLE showtimes 
    DROP CONSTRAINT IF EXISTS showtimes_status_check;

    ALTER TABLE showtimes 
    ADD CONSTRAINT showtimes_status_check 
    CHECK (status IN ('draft', 'on_sale', 'closed'));
  `);

  // 2. Tạo composite index an toàn, tránh lỗi trùng lặp relation
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_showtimes_status_starts_at 
    ON showtimes (status, starts_at);
  `);
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_showtimes_status_starts_at;
  `);

  await knex.raw(`
    ALTER TABLE showtimes 
    DROP CONSTRAINT IF EXISTS showtimes_status_check;
  `);

  const hasColumn = await knex.schema.hasColumn('showtimes', 'status');
  if (hasColumn) {
    await knex.schema.alterTable('showtimes', (table) => {
      table.dropColumn('status');
    });
  }
};
