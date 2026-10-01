require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { Client } = require("pg");
const { sendEmail } = require("./services/emailService");
const { createActivationEmail } = require("./templates/activationEmail");

const app = express();
const PORT = Number(process.env.PORT) || 2006;
const users = [];
let pgClient = null;

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Quá nhiều yêu cầu đăng ký từ IP này. Vui lòng thử lại sau 15 phút.",
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Quá nhiều yêu cầu đăng nhập từ IP này. Vui lòng thử lại sau 15 phút.",
  },
});

function resetUsers(data = []) {
  users.length = 0;
  data.forEach((user) => users.push({ ...user }));
}

function normalizeEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

function hashActivationToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? ""));
}

function createErrorResponse(res, statusCode, message, details = {}) {
  return res.status(statusCode).json({
    success: false,
    message,
    ...details,
  });
}

function createSuccessResponse(res, statusCode, message, payload = {}) {
  return res.status(statusCode).json({
    success: true,
    message,
    ...payload,
  });
}

function buildUserResponse(user) {
  const accountActive = user.is_active ?? user.isActive ?? false;
  const accountVerified = user.email_verified ?? user.emailVerified ?? false;
  const fullName = user.full_name ?? user.fullName ?? "";
  const email = user.email ?? "";

  return {
    id: user.id,
    fullName,
    email,
    role: user.role ?? "buyer",
    is_active: accountActive,
    is_verified: accountVerified,
    isActive: accountActive,
    emailVerified: accountVerified,
  };
}

async function initializePostgres() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  try {
    if (!pgClient) {
      pgClient = new Client({
        connectionString: process.env.DATABASE_URL,
      });
      await pgClient.connect();
    }

    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT false,
        email_verified BOOLEAN NOT NULL DEFAULT false,
        verification_token VARCHAR(255),
        activation_token_hash CHAR(64),
        activation_expires_at TIMESTAMPTZ,
        activation_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pgClient.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS activation_token_hash CHAR(64),
        ADD COLUMN IF NOT EXISTS activation_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS activation_used_at TIMESTAMPTZ;
    `);

    await pgClient.query(
      `CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);`,
    );
    await pgClient.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_activation_token_hash
      ON users (activation_token_hash)
      WHERE activation_token_hash IS NOT NULL;
    `);

    return pgClient;
  } catch (error) {
    console.warn("PostgreSQL unavailable, using fallback in-memory store.");
    pgClient = null;
    return null;
  }
}

async function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);

  if (pgClient) {
    const result = await pgClient.query(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1)",
      [normalizedEmail],
    );
    return result.rows[0] || null;
  }

  return (
    users.find((user) => normalizeEmail(user.email) === normalizedEmail) || null
  );
}

async function createUserRecord({
  fullName,
  email,
  passwordHash,
  activationTokenHash,
  activationExpiresAt,
}) {
  const normalizedEmail = normalizeEmail(email);
  const safeFullName = String(fullName).trim();

  if (pgClient) {
    const result = await pgClient.query(
      `
        INSERT INTO users (
          full_name,
          email,
          password_hash,
          is_active,
          email_verified,
          activation_token_hash,
          activation_expires_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, false, false, $4, $5, NOW(), NOW())
        RETURNING *;
      `,
      [
        safeFullName,
        normalizedEmail,
        passwordHash,
        activationTokenHash,
        activationExpiresAt,
      ],
    );

    return result.rows[0];
  }

  const newUser = {
    id: users.length
      ? Math.max(...users.map((user) => Number(user.id) || 0)) + 1
      : 1,
    fullName: safeFullName,
    email: normalizedEmail,
    passwordHash,
    role: "buyer",
    is_active: false,
    email_verified: false,
    isActive: false,
    emailVerified: false,
    activationTokenHash,
    activationExpiresAt,
    activationUsedAt: null,
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  return newUser;
}

async function validateRegistrationInput(payload) {
  const errors = {};
  const { fullName, email, password, confirmPassword } = payload || {};

  const trimmedFullName = String(fullName ?? "").trim();

  if (
    typeof fullName !== "string" ||
    trimmedFullName.length < 2 ||
    trimmedFullName.length > 50
  ) {
    errors.fullName = "Họ tên phải là chuỗi từ 2 đến 50 ký tự.";
  }

  const normalizedEmail = normalizeEmail(email);

  if (
    typeof email !== "string" ||
    !isValidEmail(normalizedEmail) ||
    normalizedEmail.length < 5 ||
    normalizedEmail.length > 100
  ) {
    errors.email = "Email không hợp lệ. Từ 5 đến 100 ký tự.";
  }

  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 64
  ) {
    errors.password = "Mật khẩu phải có từ 8 đến 64 ký tự.";
  }

  if (typeof confirmPassword !== "string" || password !== confirmPassword) {
    errors.confirmPassword = "Xác nhận mật khẩu không khớp.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: {
      fullName: trimmedFullName,
      email: normalizedEmail,
      password: typeof password === "string" ? password : "",
      confirmPassword:
        typeof confirmPassword === "string" ? confirmPassword : "",
    },
  };
}

async function validateLoginInput(payload) {
  const errors = {};
  const { email, password } = payload || {};
  const normalizedEmail = normalizeEmail(email);

  if (
    typeof email !== "string" ||
    !isValidEmail(normalizedEmail) ||
    normalizedEmail.length < 5 ||
    normalizedEmail.length > 100
  ) {
    errors.email = "Email không hợp lệ.";
  }

  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 64
  ) {
    errors.password = "Mật khẩu phải có từ 8 đến 64 ký tự.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: {
      email: normalizedEmail,
      password: typeof password === "string" ? password : "",
    },
  };
}

function createActivationUrl(token) {
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
  const activationUrl = new URL("/api/auth/activate", baseUrl);
  activationUrl.searchParams.set("token", token);
  return activationUrl.toString();
}

async function activateAccount(token) {
  const tokenHash = hashActivationToken(token);

  if (pgClient) {
    await pgClient.query("BEGIN");
    try {
      const result = await pgClient.query(
        `SELECT id, activation_expires_at, activation_used_at
         FROM users
         WHERE activation_token_hash = $1
         FOR UPDATE`,
        [tokenHash],
      );
      const user = result.rows[0];

      if (!user) {
        await pgClient.query("ROLLBACK");
        return { statusCode: 404, message: "Mã kích hoạt không tồn tại." };
      }
      if (user.activation_used_at) {
        await pgClient.query("ROLLBACK");
        return { statusCode: 409, message: "Mã kích hoạt đã được sử dụng." };
      }
      if (
        !user.activation_expires_at ||
        new Date(user.activation_expires_at) <= new Date()
      ) {
        await pgClient.query("ROLLBACK");
        return { statusCode: 410, message: "Mã kích hoạt đã hết hạn." };
      }

      await pgClient.query(
        `UPDATE users
         SET is_active = true,
             email_verified = true,
             activation_used_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [user.id],
      );
      await pgClient.query("COMMIT");
      return {
        statusCode: 200,
        message: "Tài khoản đã được kích hoạt thành công.",
      };
    } catch (error) {
      await pgClient.query("ROLLBACK").catch(() => {});
      throw error;
    }
  }

  const user = users.find(
    (candidate) => candidate.activationTokenHash === tokenHash,
  );
  if (!user) {
    return { statusCode: 404, message: "Mã kích hoạt không tồn tại." };
  }
  if (user.activationUsedAt) {
    return { statusCode: 409, message: "Mã kích hoạt đã được sử dụng." };
  }
  if (
    !user.activationExpiresAt ||
    new Date(user.activationExpiresAt) <= new Date()
  ) {
    return { statusCode: 410, message: "Mã kích hoạt đã hết hạn." };
  }

  user.is_active = true;
  user.email_verified = true;
  user.isActive = true;
  user.emailVerified = true;
  user.activationUsedAt = new Date().toISOString();
  return {
    statusCode: 200,
    message: "Tài khoản đã được kích hoạt thành công.",
  };
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "API is running",
    timestamp: new Date().toISOString(),
  });
});

app.post(
  ["/api/register", "/api/auth/register"],
  registerLimiter,
  async (req, res) => {
    try {
      const validation = await validateRegistrationInput(req.body || {});

      if (!validation.valid) {
        const firstError =
          Object.values(validation.errors)[0] || "Dữ liệu không hợp lệ.";

        return createErrorResponse(res, 400, firstError, {
          fields: validation.errors,
        });
      }

      const { fullName, email, password } = validation.values;

      const existingUser = await findUserByEmail(email);

      if (existingUser) {
        return createErrorResponse(
          res,
          409,
          "Email đã tồn tại trong hệ thống.",
        );
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const activationToken = crypto.randomBytes(32).toString("hex");
      const activationTokenHash = hashActivationToken(activationToken);
      const activationExpiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();

      const newUser = await createUserRecord({
        fullName,
        email,
        passwordHash,
        activationTokenHash,
        activationExpiresAt,
      });

      const activationUrl = createActivationUrl(activationToken);
      await sendEmail({
        to: email,
        ...createActivationEmail({ fullName, activationUrl }),
      });

      return createSuccessResponse(res, 201, "Đăng ký tài khoản thành công.", {
        user: buildUserResponse(newUser),
      });
    } catch (error) {
      console.error("Registration request failed.");

      return createErrorResponse(
        res,
        500,
        "Lỗi hệ thống. Vui lòng thử lại sau.",
      );
    }
  },
);

app.post(["/api/login", "/api/auth/login"], loginLimiter, async (req, res) => {
  try {
    const validation = await validateLoginInput(req.body || {});

    if (!validation.valid) {
      return createErrorResponse(
        res,
        400,
        "Email hoặc mật khẩu không hợp lệ.",
        {
          fields: validation.errors,
        },
      );
    }

    const user = await findUserByEmail(validation.values.email);

    if (!user) {
      return createErrorResponse(
        res,
        401,
        "Email hoặc mật khẩu không chính xác.",
      );
    }

    const passwordHash = user.password_hash ?? user.passwordHash ?? "";

    const isMatch = await bcrypt.compare(
      validation.values.password,
      passwordHash,
    );

    if (!isMatch) {
      return createErrorResponse(
        res,
        401,
        "Email hoặc mật khẩu không chính xác.",
      );
    }

    if (!(user.is_active ?? user.isActive ?? false)) {
      return createErrorResponse(
        res,
        403,
        "Tài khoản chưa được kích hoạt. Vui lòng kiểm tra email xác nhận.",
      );
    }

    return createSuccessResponse(res, 200, "Đăng nhập thành công.", {
      user: buildUserResponse(user),
    });
  } catch (error) {
    console.error("Login error:", error);

    return createErrorResponse(res, 500, "Lỗi hệ thống. Vui lòng thử lại sau.");
  }
});

app.get(["/api/auth/activate", "/api/auth/verify-email"], async (req, res) => {
  const { token } = req.query || {};
  if (typeof token !== "string" || !token) {
    return createErrorResponse(res, 400, "Mã kích hoạt không hợp lệ.");
  }

  try {
    const result = await activateAccount(token);
    return res.status(result.statusCode).json({
      success: result.statusCode === 200,
      message: result.message,
    });
  } catch (error) {
    console.error("Account activation request failed.");
    return createErrorResponse(res, 500, "Lỗi hệ thống. Vui lòng thử lại sau.");
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "register.html"));
});

async function startServer() {
  await initializePostgres();

  if (require.main === module) {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  }
}

if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    resetUsers([
      {
        id: 1,
        fullName: "Demo User",
        email: "demo@example.com",
        passwordHash: bcrypt.hashSync("Demo@1234", 12),
        role: "buyer",
        is_active: false,
        is_verified: false,
        isActive: false,
        emailVerified: false,
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  startServer();
}

module.exports = {
  app,
  users,
  resetUsers,
  initializePostgres,
  findUserByEmail,
  validateRegistrationInput,
  validateLoginInput,
};
