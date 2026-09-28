const crypto = require('crypto');
const argon2 = require('argon2');

const GENERIC_LOGIN_ERROR = 'Email hoặc mật khẩu không đúng.';
const LOCKED_LOGIN_ERROR = 'Đăng nhập tạm thời bị khóa. Vui lòng thử lại sau.';

// Hash Argon2id hợp lệ dùng để cân bằng thời gian xử lý khi email không tồn tại.
// Đây không phải mật khẩu của người dùng và không được dùng để đăng nhập.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQxMjM0NTY3OA$Nc3l+3aGX6Rho/eZpArXnZtKZQ/0F1W5EcI+oFQf6vA';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function emailKey(email) {
  return crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

function ipKey(ip) {
  if (!ip) return null;
  return 'ip:' + String(ip).trim();
}

function createAuthService({
  userRepository,
  attemptStore,
  sessionStore,
  verifyPassword = (hash, password) => argon2.verify(hash, password),
  dummyPasswordHash = DUMMY_PASSWORD_HASH,
  maxFailedAttempts,
  maxIpFailedAttempts,
}) {
  if (!userRepository || !attemptStore || !sessionStore || !verifyPassword || !dummyPasswordHash) {
    throw new Error('Thiếu dependency để khởi tạo auth service.');
  }

  const emailMaxAttempts = maxFailedAttempts || attemptStore.maxFailedAttempts || 5;
  const ipMaxAttempts = maxIpFailedAttempts || attemptStore.maxIpFailedAttempts || 20;

  async function login(input = {}) {
    const email = normalizeEmail(input.email);
    const password = typeof input.password === 'string' ? input.password : '';
    const clientIp = input.ip ? String(input.ip).trim() : null;

    if (!email || !password) {
      return {
        status: 400,
        body: { success: false, message: 'Vui lòng nhập email và mật khẩu.' },
      };
    }

    const eKey = emailKey(email);
    const iKey = ipKey(clientIp);

    const emailLockSeconds = await attemptStore.getRemainingLockSeconds(eKey);
    const ipLockSeconds = iKey ? await attemptStore.getRemainingLockSeconds(iKey) : 0;
    const lockSeconds = Math.max(emailLockSeconds, ipLockSeconds);

    if (lockSeconds > 0) {
      return {
        status: 429,
        body: {
          success: false,
          message: LOCKED_LOGIN_ERROR,
          retryAfterSeconds: lockSeconds,
        },
      };
    }

    // Không bọc catch để nếu findByEmail ném lỗi thì ném lên để route trả 500
    // và TUYỆT ĐỐI không ghi nhận lần sai vào attemptStore
    const user = await userRepository.findByEmail(email);

    const passwordHash = user?.passwordHash || dummyPasswordHash;
    let passwordMatches = false;

    try {
      passwordMatches = await verifyPassword(passwordHash, password);
    } catch {
      // Giữ passwordMatches = false nếu có lỗi verify
    }

    if (!user || !passwordMatches) {
      await attemptStore.recordFailure(eKey, emailMaxAttempts);
      if (iKey) {
        await attemptStore.recordFailure(iKey, ipMaxAttempts);
      }
      return {
        status: 401,
        body: { success: false, message: GENERIC_LOGIN_ERROR },
      };
    }

    if (!user.isActive) {
      return {
        status: 403,
        body: {
          success: false,
          code: 'ACCOUNT_NOT_ACTIVE',
          message:
            'Tài khoản chưa được kích hoạt. Vui lòng kiểm tra email hoặc gửi lại liên kết kích hoạt.',
        },
      };
    }

    await attemptStore.clear(eKey);

    const session = await sessionStore.create({
      userId: user.id,
      roles: user.roles || [],
    });

    return {
      status: 200,
      session,
      body: {
        success: true,
        message: 'Đăng nhập thành công.',
        redirectTo: '/app.html',
        user: {
          id: user.id,
          email: user.email,
          roles: user.roles || [],
        },
      },
    };
  }

  return {
    login,
    attemptStore,
    sessionStore,
  };
}

module.exports = {
  GENERIC_LOGIN_ERROR,
  LOCKED_LOGIN_ERROR,
  DUMMY_PASSWORD_HASH,
  createAuthService,
  emailKey,
  ipKey,
  normalizeEmail,
};
