/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('showtimes', 'status');
  if (!hasColumn) {
    await knex.schema.alterTable('showtimes', (table) => {
      table
        .string('status', 32)
        .notNullable()
        .defaultTo('draft');
    });

    await knex.raw(`
      ALTER TABLE showtimes
      DROP CONSTRAINT IF EXISTS showtimes_status_check;
      ALTER TABLE showtimes
      ADD CONSTRAINT showtimes_status_check
      CHECK (status IN ('draft', 'published', 'on_sale', 'sold_out', 'closed', 'cancelled'));
    `);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('showtimes', 'status');
  if (hasColumn) {
    await knex.schema.alterTable('showtimes', (table) => {
      table.dropColumn('status');
    });
  }
};