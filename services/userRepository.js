const defaultDb = require('../db');

function createUserRepository(db = defaultDb) {
  return {
    async findByEmail(email) {
      const row = await db('users as u')
        .leftJoin('user_roles as ur', 'ur.user_id', 'u.id')
        .leftJoin('roles as r', 'r.id', 'ur.role_id')
        .whereRaw('LOWER(u.email) = ?', [email])
        .select(
          'u.id',
          'u.email',
          'u.password_hash as passwordHash',
          'u.is_active as isActive',
          'r.name as role',
        )
        .first();

      return row || null;
    },
  };
}

module.exports = { createUserRepository };
