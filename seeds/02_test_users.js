/**
 * Seed 200 test users cho kịch bản kiểm thử T-31
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function(knex) {
  const users = [];
  for (let i = 1; i <= 200; i++) {
    users.push({
      email: `testuser${i}@example.com`,
      password_hash: 'dummyhash',
      is_active: true
    });
  }

  // Insert ignore / on conflict ignore
  for (const user of users) {
    await knex('users')
      .insert(user)
      .onConflict('email')
      .ignore();
  }
};
