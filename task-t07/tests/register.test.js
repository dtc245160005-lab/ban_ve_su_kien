const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.PORT = "0";
process.env.NODE_ENV = "development";
process.env.APP_BASE_URL = "http://localhost:2006";

const { app, users, resetUsers } = require("../server.js");
const { sendEmail } = require("../services/emailService.js");

const originalUsers = users.slice();

function restoreUsers() {
  resetUsers(originalUsers);
}

async function registerUser(port, { fullName, email }) {
  let preview = "";
  const originalLog = console.log;
  console.log = (...args) => {
    preview += `${args.join(" ")}\n`;
  };

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName,
        email,
        password: "Abcdef12",
        confirmPassword: "Abcdef12",
      }),
    });
    return { response, preview };
  } finally {
    console.log = originalLog;
  }
}

function getActivationUrl(preview) {
  const match = preview.match(
    /http:\/\/localhost:2006\/api\/auth\/activate\?token=[a-f0-9]+/,
  );
  assert.ok(
    match,
    "development email preview should contain the activation URL",
  );
  return match[0];
}

test("register API should create an inactive buyer and log the activation email in development", async () => {
  restoreUsers();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const { response, preview } = await registerUser(port, {
      fullName: "Test Buyer",
      email: "buyer@example.com",
    });

    const data = await response.json();

    assert.equal(response.status, 201);
    assert.equal(data.success, true);
    assert.equal(data.user.role, "buyer");
    assert.equal(data.user.is_active, false);
    assert.equal(data.user.is_verified, false);
    assert.match(preview, /EMAIL PREVIEW - DEVELOPMENT/);
    assert.match(getActivationUrl(preview), /token=[a-f0-9]{64}$/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreUsers();
  }
});

test("register API should reject duplicate email addresses", async () => {
  restoreUsers();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    await registerUser(port, {
      fullName: "Test Buyer",
      email: "duplicate@example.com",
    });

    const { response: duplicateResponse } = await registerUser(port, {
      fullName: "Another Buyer",
      email: "duplicate@example.com",
    });

    const data = await duplicateResponse.json();
    assert.equal(duplicateResponse.status, 409);
    assert.equal(data.success, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreUsers();
  }
});

test("register API should reject invalid input data", async () => {
  restoreUsers();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "A",
        email: "bad-email",
        password: "short",
        confirmPassword: "different",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 400);
    assert.equal(data.success, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreUsers();
  }
});

test("activation succeeds once, activates account, and blocks login until activated", async () => {
  restoreUsers();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const { response: registration, preview } = await registerUser(port, {
      fullName: "Login User",
      email: "login@example.com",
    });
    assert.equal(registration.status, 201);

    const loginBeforeActivation = await fetch(
      `http://127.0.0.1:${port}/api/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "login@example.com",
          password: "Abcdef12",
        }),
      },
    );
    assert.equal(loginBeforeActivation.status, 403);

    const activationUrl = new URL(getActivationUrl(preview));
    activationUrl.host = `127.0.0.1:${port}`;
    const firstActivation = await fetch(activationUrl);
    const firstActivationData = await firstActivation.json();
    assert.equal(firstActivation.status, 200);
    assert.equal(firstActivationData.success, true);

    const activatedUser = users.find(
      (user) => user.email === "login@example.com",
    );
    assert.equal(activatedUser.is_active, true);
    assert.equal(activatedUser.email_verified, true);

    const secondActivation = await fetch(activationUrl);
    const secondActivationData = await secondActivation.json();
    assert.equal(secondActivation.status, 409);
    assert.equal(secondActivationData.message, "Mã kích hoạt đã được sử dụng.");

    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "login@example.com",
        password: "Abcdef12",
      }),
    });

    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.success, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreUsers();
  }
});

test("activation rejects expired and unknown tokens", async () => {
  restoreUsers();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const { preview } = await registerUser(port, {
      fullName: "Expired User",
      email: "expired@example.com",
    });
    const activationUrl = new URL(getActivationUrl(preview));
    activationUrl.host = `127.0.0.1:${port}`;
    const token = new URL(activationUrl).searchParams.get("token");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = users.find(
      (candidate) => candidate.activationTokenHash === tokenHash,
    );
    user.activationExpiresAt = new Date(Date.now() - 1000).toISOString();

    const expiredResponse = await fetch(activationUrl);
    const expiredData = await expiredResponse.json();
    assert.equal(expiredResponse.status, 410);
    assert.equal(expiredData.message, "Mã kích hoạt đã hết hạn.");

    const unknownResponse = await fetch(
      `http://127.0.0.1:${port}/api/auth/activate?token=${"a".repeat(64)}`,
    );
    assert.equal(unknownResponse.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreUsers();
  }
});

test("staging email failures do not log email contents or activation tokens", async () => {
  const envKeys = [
    "NODE_ENV",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
  ];
  const previousEnv = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));
  process.env.NODE_ENV = "staging";
  for (const key of envKeys.slice(1)) {
    delete process.env[key];
  }

  try {
    await assert.rejects(
      sendEmail({
        to: "staging@example.com",
        subject: "Activation",
        text: "secret-token-value",
        html: '<a href="https://example.test/?token=secret-token-value">Activate</a>',
      }),
      /SMTP configuration is incomplete/,
    );
    assert.deepEqual(logs, []);
  } finally {
    console.log = originalLog;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
