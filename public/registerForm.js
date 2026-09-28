function validateRegisterForm(input = {}) {
  const errors = {};
  const { email, password, full_name } = input;

  const trimmedFullName = String(full_name ?? '').trim();
  if (
    full_name === undefined ||
    full_name === null ||
    typeof full_name !== 'string' ||
    trimmedFullName.length < 1 ||
    trimmedFullName.length > 100
  ) {
    errors.full_name = 'Họ tên phải từ 1 đến 100 ký tự.';
  }

  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (
    email === undefined ||
    email === null ||
    typeof email !== 'string' ||
    !emailRegex.test(normalizedEmail) ||
    normalizedEmail.length > 255
  ) {
    errors.email = 'Email không đúng định dạng.';
  }

  if (
    password === undefined ||
    password === null ||
    typeof password !== 'string' ||
    password.length < 8 ||
    password.length > 128
  ) {
    errors.password = 'Mật khẩu phải từ 8 đến 128 ký tự.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateRegisterForm };
}
