/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function(knex) {
  await knex.raw(`
    ALTER TABLE showtimes 
    DROP CONSTRAINT IF EXISTS showtimes_status_check;
    
    ALTER TABLE showtimes 
    ADD CONSTRAINT showtimes_status_check 
    CHECK (status IN ('draft', 'on_sale', 'closed'));
  `);

  await knex.schema.alterTable('showtimes', (table) => {
    table.index(['status', 'starts_at'], 'idx_showtimes_status_starts_at');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('showtimes', (table) => {
    table.dropIndex(['status', 'starts_at'], 'idx_showtimes_status_starts_at');
  });

  await knex.raw(`
    ALTER TABLE showtimes 
    DROP CONSTRAINT IF EXISTS showtimes_status_check;
  `);
};