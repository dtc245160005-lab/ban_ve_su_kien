/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'showtime_status') THEN
        CREATE TYPE showtime_status AS ENUM ('draft', 'on_sale', 'closed');
      END IF;
    END$$;
  `);

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
exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('showtimes', 'status');
  if (hasColumn) {
    await knex.schema.alterTable('showtimes', (table) => {
      table.dropColumn('status');
    });
  }
  await knex.raw('DROP TYPE IF EXISTS showtime_status CASCADE;');
};