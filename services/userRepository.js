const defaultDb = require('../db');

function createUserRepository(db = defaultDb) {
  return {
    async findByEmail(email) {
      const rows = await db('users as u')
        .leftJoin('user_roles as ur', 'ur.user_id', 'u.id')
        .leftJoin('roles as r', 'r.id', 'ur.role_id')
        .whereRaw('LOWER(u.email) = ?', [email])
        .select(
          'u.id',
          'u.email',
          'u.password_hash as passwordHash',
          'u.is_active as isActive',
          'r.name as role',
        );

      if (!rows || rows.length === 0) {
        return null;
      }

      const first = rows[0];
      const roles = rows
        .map((r) => r.role)
        .filter((role) => typeof role === 'string' && role.length > 0);

      const uniqueRoles = Array.from(new Set(roles));

      return {
        id: first.id,
        email: first.email,
        passwordHash: first.passwordHash,
        isActive: first.isActive,
        roles: uniqueRoles,
      };
    },
  };
}

module.exports = { createUserRepository };
