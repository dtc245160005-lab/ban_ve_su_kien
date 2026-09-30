const argon2 = require('argon2');
const defaultDb = require('../db');

const STAFF_ROLES = ['organizer', 'checker', 'accountant'];

function httpError(status, message, errors) {
  const error = new Error(message);
  error.status = status;
  error.errors = errors;
  return error;
}

function normalizeRoles(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((role) => String(role).trim().toLowerCase()))];
}

function validateStaffInput(input, requirePassword = true) {
  const errors = {};
  const email = String(input?.email || '').trim().toLowerCase();
  const fullName = String(input?.full_name || '').trim();
  const password = typeof input?.password === 'string' ? input.password : '';
  const roles = normalizeRoles(input?.roles);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Email không hợp lệ.';
  if (!fullName || fullName.length > 100) errors.full_name = 'Họ tên phải có từ 1 đến 100 ký tự.';
  if (requirePassword && (password.length < 8 || password.length > 128)) {
    errors.password = 'Mật khẩu phải có từ 8 đến 128 ký tự.';
  }
  if (roles.length === 0 || roles.some((role) => !STAFF_ROLES.includes(role))) {
    errors.roles = 'Vai trò nhân viên không hợp lệ.';
  }
  return { valid: Object.keys(errors).length === 0, errors, email, fullName, password, roles };
}

function createStaffService(db = defaultDb) {
  async function listStaff() {
    const rows = await db('users as u')
      .join('user_roles as ur', 'ur.user_id', 'u.id')
      .join('roles as r', 'r.id', 'ur.role_id')
      .whereIn('r.name', STAFF_ROLES)
      .select('u.id', 'u.email', 'u.full_name', 'u.is_active', 'u.created_at', 'r.name as role')
      .orderBy('u.id', 'desc');
    const users = new Map();
    for (const row of rows) {
      if (!users.has(row.id)) {
        users.set(row.id, {
          id: row.id,
          email: row.email,
          full_name: row.full_name,
          is_active: row.is_active,
          created_at: row.created_at,
          roles: [],
        });
      }
      users.get(row.id).roles.push(row.role);
    }
    return [...users.values()];
  }

  async function createStaff(input) {
    const validation = validateStaffInput(input, true);
    if (!validation.valid) throw httpError(400, 'Dữ liệu nhân viên không hợp lệ.', validation.errors);
    const existing = await db('users').where({ email: validation.email }).first('id');
    if (existing) throw httpError(409, 'Email đã được sử dụng.');
    const passwordHash = await argon2.hash(validation.password, { type: argon2.argon2id });

    return db.transaction(async (trx) => {
      const [user] = await trx('users').insert({
        email: validation.email,
        full_name: validation.fullName,
        password_hash: passwordHash,
        is_active: true,
      }).returning(['id', 'email', 'full_name', 'is_active', 'created_at']);
      const roleRows = await trx('roles').whereIn('name', validation.roles).select('id', 'name');
      if (roleRows.length !== validation.roles.length) throw httpError(500, 'Vai trò hệ thống chưa được khởi tạo.');
      await trx('user_roles').insert(roleRows.map((role) => ({ user_id: user.id, role_id: role.id })));
      return { ...user, roles: roleRows.map((role) => role.name) };
    });
  }

  async function updateRoles(userId, roles) {
    const normalized = normalizeRoles(roles);
    if (normalized.length === 0 || normalized.some((role) => !STAFF_ROLES.includes(role))) {
      throw httpError(400, 'Vai trò nhân viên không hợp lệ.');
    }
    return db.transaction(async (trx) => {
      const user = await trx('users').where({ id: userId }).forUpdate().first('id', 'email', 'full_name', 'is_active');
      if (!user) throw httpError(404, 'Không tìm thấy nhân viên.');
      const staffRoleRows = await trx('roles').whereIn('name', STAFF_ROLES).select('id');
      await trx('user_roles').where({ user_id: userId }).whereIn('role_id', staffRoleRows.map((role) => role.id)).del();
      const selected = await trx('roles').whereIn('name', normalized).select('id', 'name');
      await trx('user_roles').insert(selected.map((role) => ({ user_id: userId, role_id: role.id })));
      return { ...user, roles: selected.map((role) => role.name) };
    });
  }

  async function setActive(userId, isActive, actorId) {
    if (Number(userId) === Number(actorId) && !isActive) throw httpError(400, 'Bạn không thể tự khóa tài khoản của mình.');
    const updated = await db('users').where({ id: userId }).update({ is_active: Boolean(isActive), updated_at: db.fn.now() });
    if (!updated) throw httpError(404, 'Không tìm thấy nhân viên.');
    return { id: Number(userId), is_active: Boolean(isActive) };
  }

  return { listStaff, createStaff, updateRoles, setActive };
}

module.exports = { STAFF_ROLES, createStaffService, validateStaffInput };
