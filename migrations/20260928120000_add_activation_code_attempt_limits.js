/** @param { import("knex").Knex } knex */
exports.up = async function(knex) {
  await knex.schema.alterTable('email_activation_tokens', function(table) {
    table.integer('failed_attempts').notNullable().defaultTo(0);
    table.timestamp('locked_until', { useTz: true }).nullable();
  });
};

/** @param { import("knex").Knex } knex */
exports.down = async function(knex) {
  await knex.schema.alterTable('email_activation_tokens', function(table) {
    table.dropColumn('locked_until');
    table.dropColumn('failed_attempts');
  });
};
