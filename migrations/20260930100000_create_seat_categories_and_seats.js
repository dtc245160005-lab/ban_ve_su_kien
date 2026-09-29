/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('seat_categories', (table) => {
    table.increments('id').primary();
    table.integer('showtime_id').notNullable()
      .references('id').inTable('showtimes').onDelete('CASCADE');
    table.string('name', 100).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['showtime_id', 'name']);
    table.unique(['showtime_id', 'id']);
    table.index('showtime_id');
  });

  await knex.schema.createTable('seats', (table) => {
    table.increments('id').primary();
    table.integer('showtime_id').notNullable()
      .references('id').inTable('showtimes').onDelete('CASCADE');
    table.integer('category_id').notNullable();
    table.string('row_label', 32).notNullable();
    table.integer('seat_number').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.foreign(['showtime_id', 'category_id'])
      .references(['showtime_id', 'id']).inTable('seat_categories').onDelete('RESTRICT');
    table.unique(['showtime_id', 'row_label', 'seat_number']);
    table.index('showtime_id');
  });

  await knex.raw("ALTER TABLE seat_categories ADD CONSTRAINT seat_categories_name_nonblank CHECK (btrim(name) <> '')");
  await knex.raw("ALTER TABLE seats ADD CONSTRAINT seats_row_label_nonblank CHECK (btrim(row_label) <> '')");
  await knex.raw('ALTER TABLE seats ADD CONSTRAINT seats_seat_number_positive CHECK (seat_number > 0)');
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('seats');
  await knex.schema.dropTableIfExists('seat_categories');
};
