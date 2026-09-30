const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ quiet: true });

// Hỗ trợ cả biến môi trường LẪN tham số dòng lệnh CLI (phù hợp cho PowerShell & Bash)
// Ví dụ: node scripts/e2e-sprint1.js --lockout --mail-file=./dev_mail.log
const args = process.argv.slice(2);
let cliLockout = false;
let cliMailFile = null;
let cliBaseUrl = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--lockout' || arg === '--lockout=1' || arg === '--lockout=true') {
    cliLockout = true;
  } else if (arg.startsWith('--mail-file=')) {
    cliMailFile = arg.split('=').slice(1).join('=');
  } else if (arg === '--mail-file' && i + 1 < args.length) {
    cliMailFile = args[++i];
  } else if (arg.startsWith('--base-url=')) {
    cliBaseUrl = arg.split('=').slice(1).join('=');
  } else if (arg === '--base-url' && i + 1 < args.length) {
    cliBaseUrl = args[++i];
  }
}

const BASE_URL = (cliBaseUrl || process.env.BASE_URL || 'http://localhost:8090').replace(/\/+$/, '');
let DEV_MAIL_FILE = cliMailFile || process.env.DEV_MAIL_FILE || null;

// Tự động tìm dev mail log nếu chạy local mà chưa cấu hình biến môi trường
if (!DEV_MAIL_FILE && (BASE_URL.includes('localhost') || BASE_URL.includes('127.0.0.1'))) {
  for (const candidate of ['.dev_mail_local.log', '.dev_mail.log']) {
    const p = path.resolve(__dirname, '..', candidate);
    if (fs.existsSync(p)) {
      DEV_MAIL_FILE = p;
      break;
    }
  }
}

const IS_LOCKOUT = cliLockout || process.env.E2E_LOCKOUT === '1' || process.env.E2E_LOCKOUT === 'true';

const ORGANIZER_EMAIL =
  process.env.E2E_ORGANIZER_EMAIL ||
  process.env.DEMO_ORGANIZER_EMAIL ||
  'organizer@example.test';
const ORGANIZER_PASSWORD =
  process.env.E2E_ORGANIZER_PASSWORD ||
  process.env.DEMO_ORGANIZER_PASSWORD ||
  'DemoOrgLocal@2026_SecureSecretP@ss99!';

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function reportPass(code, desc, actualStatus, expectedStatus) {
  passCount++;
  console.log(`[PASS] ${code} ${desc} (HTTP ${actualStatus}, mong đợi ${expectedStatus})`);
}

function reportFail(code, desc, actualStatus, expectedStatus, extra = '') {
  failCount++;
  const extraMsg = extra ? ` - ${extra}` : '';
  console.error(`[FAIL] ${code} ${desc} (HTTP ${actualStatus}, mong đợi ${expectedStatus})${extraMsg}`);
}

function reportSkip(code, desc, reason) {
  skipCount++;
  console.log(`[SKIP] ${code} ${desc} (${reason})`);
}

function getCookieFromHeaders(headers) {
  const setCookie = headers.get('set-cookie');
  if (!setCookie) return null;
  // Lấy giá trị cookie đầu tiên hoặc session_token
  const match = setCookie.match(/([^=;\s]+=[^;]+)/);
  return match ? match[1] : null;
}

function extractActivationToken(email) {
  if (!DEV_MAIL_FILE || !fs.existsSync(DEV_MAIL_FILE)) return null;
  try {
    const content = fs.readFileSync(DEV_MAIL_FILE, 'utf8');
    const blocks = content.split('==================== [DEV MAIL] ====================');
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i];
      if (block.includes(`To: ${email}`)) {
        const tokenMatch =
          block.match(/[?&]token=([a-zA-Z0-9_-]+)/) ||
          block.match(/#token=([a-zA-Z0-9_-]+)/);
        if (tokenMatch) return tokenMatch[1];
      }
    }
  } catch (err) {
    console.error('Lỗi khi đọc DEV_MAIL_FILE:', err.message);
  }
  return null;
}

async function request(urlPath, options = {}) {
  const url = `${BASE_URL}${urlPath}`;
  const headers = { ...(options.headers || {}) };
  if (options.cookie) {
    headers['Cookie'] = options.cookie;
  }
  if (options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(url, { ...options, headers });
  let data;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    try {
      data = await res.text();
    } catch {
      data = null;
    }
  }
  return {
    status: res.status,
    headers: res.headers,
    cookie: getCookieFromHeaders(res.headers),
    data,
  };
}

async function run() {
  console.log(`\n=== BẮT ĐẦU CHẠY E2E SPRINT 1 (BASE_URL=${BASE_URL}) ===\n`);

  // H1: GET /health -> 200
  try {
    const resH1 = await request('/health');
    if (resH1.status === 200) {
      reportPass('H1', 'GET /health', resH1.status, 200);
    } else {
      reportFail('H1', 'GET /health', resH1.status, 200);
    }
  } catch (err) {
    reportFail('H1', 'GET /health', 'ERR', 200, err.message);
  }

  // H2: GET /, /login.html, /register.html, /activate.html -> 200
  try {
    const pages = ['/', '/login.html', '/register.html', '/activate.html'];
    let allOk = true;
    let lastStatus = 200;
    for (const page of pages) {
      const res = await request(page);
      if (res.status !== 200) {
        allOk = false;
        lastStatus = res.status;
        break;
      }
    }
    if (allOk) {
      reportPass('H2', 'GET các trang giao diện cơ bản (/, login, register, activate)', 200, 200);
    } else {
      reportFail('H2', 'GET các trang giao diện cơ bản', lastStatus, 200);
    }
  } catch (err) {
    reportFail('H2', 'GET các trang giao diện cơ bản', 'ERR', 200, err.message);
  }

  // R1: Đăng ký email mới -> 202, body có message chung
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const testEmail = `e2e.${timestamp}.${randomSuffix}@example.test`;
  const testPassword = 'Password@123456';
  const testFullName = 'E2E Buyer User';
  let r1Body = null;

  try {
    const resR1 = await request('/api/auth/register', {
      method: 'POST',
      body: { email: testEmail, password: testPassword, full_name: testFullName },
    });
    r1Body = resR1.data;
    if (resR1.status === 202 && resR1.data?.message?.includes('hộp thư')) {
      reportPass('R1', 'Đăng ký email mới', resR1.status, 202);
    } else {
      reportFail('R1', 'Đăng ký email mới', resR1.status, 202, JSON.stringify(resR1.data));
    }
  } catch (err) {
    reportFail('R1', 'Đăng ký email mới', 'ERR', 202, err.message);
  }

  // R2: Đăng ký lại cùng email -> 202, body GIỐNG HỆT R1
  try {
    const resR2 = await request('/api/auth/register', {
      method: 'POST',
      body: { email: testEmail, password: testPassword, full_name: testFullName },
    });
    const bodiesMatch = JSON.stringify(resR2.data) === JSON.stringify(r1Body);
    if (resR2.status === 202 && bodiesMatch) {
      reportPass('R2', 'Đăng ký lại cùng email', resR2.status, 202);
    } else {
      reportFail('R2', 'Đăng ký lại cùng email', resR2.status, 202, 'Body không trùng khớp với R1');
    }
  } catch (err) {
    reportFail('R2', 'Đăng ký lại cùng email', 'ERR', 202, err.message);
  }

  // R3: Mật khẩu 7 ký tự -> 400 errors.password
  try {
    const resR3 = await request('/api/auth/register', {
      method: 'POST',
      body: { email: `short_pw_${randomSuffix}@example.test`, password: 'Pass123', full_name: 'Test' },
    });
    if (resR3.status === 400 && resR3.data?.errors?.password) {
      reportPass('R3', 'Mật khẩu 7 ký tự', resR3.status, 400);
    } else {
      reportFail('R3', 'Mật khẩu 7 ký tự', resR3.status, 400, JSON.stringify(resR3.data));
    }
  } catch (err) {
    reportFail('R3', 'Mật khẩu 7 ký tự', 'ERR', 400, err.message);
  }

  // R4: Email sai định dạng -> 400 errors.email
  try {
    const resR4 = await request('/api/auth/register', {
      method: 'POST',
      body: { email: 'not-an-email', password: testPassword, full_name: 'Test' },
    });
    if (resR4.status === 400 && resR4.data?.errors?.email) {
      reportPass('R4', 'Email sai định dạng', resR4.status, 400);
    } else {
      reportFail('R4', 'Email sai định dạng', resR4.status, 400, JSON.stringify(resR4.data));
    }
  } catch (err) {
    reportFail('R4', 'Email sai định dạng', 'ERR', 400, err.message);
  }

  // L1: Đăng nhập trước khi kích hoạt, mật khẩu đúng -> 403 ACCOUNT_NOT_ACTIVE
  try {
    const resL1 = await request('/api/auth/login', {
      method: 'POST',
      body: { email: testEmail, password: testPassword },
    });
    const isNotActive = resL1.data?.error === 'ACCOUNT_NOT_ACTIVE' || String(resL1.data?.message).includes('kích hoạt');
    if (resL1.status === 403 && isNotActive) {
      reportPass('L1', 'Đăng nhập trước khi kích hoạt, mật khẩu đúng', resL1.status, 403);
    } else {
      reportFail('L1', 'Đăng nhập trước khi kích hoạt, mật khẩu đúng', resL1.status, 403, JSON.stringify(resL1.data));
    }
  } catch (err) {
    reportFail('L1', 'Đăng nhập trước khi kích hoạt, mật khẩu đúng', 'ERR', 403, err.message);
  }

  // L2: Đăng nhập trước khi kích hoạt, mật khẩu sai -> 401, thông báo chung
  try {
    const resL2 = await request('/api/auth/login', {
      method: 'POST',
      body: { email: testEmail, password: 'WrongPassword123@' },
    });
    if (resL2.status === 401 && resL2.data?.message?.includes('không đúng')) {
      reportPass('L2', 'Đăng nhập trước khi kích hoạt, mật khẩu sai', resL2.status, 401);
    } else {
      reportFail('L2', 'Đăng nhập trước khi kích hoạt, mật khẩu sai', resL2.status, 401, JSON.stringify(resL2.data));
    }
  } catch (err) {
    reportFail('L2', 'Đăng nhập trước khi kích hoạt, mật khẩu sai', 'ERR', 401, err.message);
  }

  // Trích xuất activation token từ DEV_MAIL_FILE nếu có
  let activationToken = extractActivationToken(testEmail);

  // A1: Kích hoạt bằng token -> 200
  if (activationToken) {
    try {
      const resA1 = await request('/api/auth/activate', {
        method: 'POST',
        body: { token: activationToken },
      });
      if (resA1.status === 200) {
        reportPass('A1', 'Kích hoạt bằng token', resA1.status, 200);
      } else {
        reportFail('A1', 'Kích hoạt bằng token', resA1.status, 200, JSON.stringify(resA1.data));
      }
    } catch (err) {
      reportFail('A1', 'Kích hoạt bằng token', 'ERR', 200, err.message);
    }
  } else {
    reportSkip('A1', 'Kích hoạt bằng token', 'cần hộp thư');
  }

  // A2: Kích hoạt lại cùng token -> 409
  if (activationToken) {
    try {
      const resA2 = await request('/api/auth/activate', {
        method: 'POST',
        body: { token: activationToken },
      });
      if (resA2.status === 409) {
        reportPass('A2', 'Kích hoạt lại cùng token', resA2.status, 409);
      } else {
        reportFail('A2', 'Kích hoạt lại cùng token', resA2.status, 409, JSON.stringify(resA2.data));
      }
    } catch (err) {
      reportFail('A2', 'Kích hoạt lại cùng token', 'ERR', 409, err.message);
    }
  } else {
    reportSkip('A2', 'Kích hoạt lại cùng token', 'cần hộp thư');
  }

  // A3: Token rác -> 400
  try {
    const resA3 = await request('/api/auth/activate', {
      method: 'POST',
      body: { token: 'invalid_garbage_token_12345' },
    });
    if (resA3.status === 400) {
      reportPass('A3', 'Token rác', resA3.status, 400);
    } else {
      reportFail('A3', 'Token rác', resA3.status, 400);
    }
  } catch (err) {
    reportFail('A3', 'Token rác', 'ERR', 400, err.message);
  }

  // A4: Gửi lại liên kết -> 202 (body chung); email không tồn tại -> 202 giống hệt
  try {
    const resA4_1 = await request('/api/auth/resend-activation', {
      method: 'POST',
      body: { email: testEmail },
    });
    const resA4_2 = await request('/api/auth/resend-activation', {
      method: 'POST',
      body: { email: `nonexistent_${Date.now()}@example.test` },
    });
    const bodiesMatch = JSON.stringify(resA4_1.data) === JSON.stringify(resA4_2.data);
    if (resA4_1.status === 202 && resA4_2.status === 202 && bodiesMatch) {
      reportPass('A4', 'Gửi lại liên kết kích hoạt', 202, 202);
    } else {
      reportFail('A4', 'Gửi lại liên kết kích hoạt', resA4_1.status, 202, 'Phản hồi không đồng nhất');
    }
  } catch (err) {
    reportFail('A4', 'Gửi lại liên kết kích hoạt', 'ERR', 202, err.message);
  }

  // L3: Đăng nhập sau khi kích hoạt -> 200, có cookie HttpOnly
  let buyerCookie = null;
  if (activationToken) {
    try {
      const resL3 = await request('/api/auth/login', {
        method: 'POST',
        body: { email: testEmail, password: testPassword },
      });
      buyerCookie = resL3.cookie;
      if (resL3.status === 200 && buyerCookie) {
        reportPass('L3', 'Đăng nhập sau khi kích hoạt', resL3.status, 200);
      } else {
        reportFail('L3', 'Đăng nhập sau khi kích hoạt', resL3.status, 200, 'Thiếu session cookie');
      }
    } catch (err) {
      reportFail('L3', 'Đăng nhập sau khi kích hoạt', 'ERR', 200, err.message);
    }
  } else {
    reportSkip('L3', 'Đăng nhập sau khi kích hoạt', 'cần hộp thư');
  }

  // S1: GET /api/auth/session -> 200, roles chứa buyer
  if (buyerCookie) {
    try {
      const resS1 = await request('/api/auth/session', { cookie: buyerCookie });
      const roles = resS1.data?.user?.roles || [];
      if (resS1.status === 200 && roles.includes('buyer')) {
        reportPass('S1', 'GET /api/auth/session', resS1.status, 200);
      } else {
        reportFail('S1', 'GET /api/auth/session', resS1.status, 200, `Roles: ${JSON.stringify(roles)}`);
      }
    } catch (err) {
      reportFail('S1', 'GET /api/auth/session', 'ERR', 200, err.message);
    }
  } else {
    reportSkip('S1', 'GET /api/auth/session', 'cần đăng nhập buyer');
  }

  // P1: Buyer POST /api/organizer/events -> 403
  if (buyerCookie) {
    try {
      const resP1 = await request('/api/organizer/events', {
        method: 'POST',
        cookie: buyerCookie,
        body: { title: 'Buyer Test Event', venue: 'Ha Noi' },
      });
      if (resP1.status === 403) {
        reportPass('P1', 'Buyer POST /api/organizer/events', resP1.status, 403);
      } else {
        reportFail('P1', 'Buyer POST /api/organizer/events', resP1.status, 403);
      }
    } catch (err) {
      reportFail('P1', 'Buyer POST /api/organizer/events', 'ERR', 403, err.message);
    }
  } else {
    reportSkip('P1', 'Buyer POST /api/organizer/events', 'cần đăng nhập buyer');
  }

  // P2: Không cookie POST /api/organizer/events -> 401
  try {
    const resP2 = await request('/api/organizer/events', {
      method: 'POST',
      body: { title: 'Anonymous Event', venue: 'Ha Noi' },
    });
    if (resP2.status === 401) {
      reportPass('P2', 'Không cookie POST /api/organizer/events', resP2.status, 401);
    } else {
      reportFail('P2', 'Không cookie POST /api/organizer/events', resP2.status, 401);
    }
  } catch (err) {
    reportFail('P2', 'Không cookie POST /api/organizer/events', 'ERR', 401, err.message);
  }

  // P3: GET /api/khong-ton-tai -> 403 (mặc định từ chối route chưa khai báo)
  try {
    const resP3 = await request('/api/khong-ton-tai');
    if (resP3.status === 403) {
      reportPass('P3', 'GET /api/khong-ton-tai', resP3.status, 403);
    } else {
      reportFail('P3', 'GET /api/khong-ton-tai', resP3.status, 403);
    }
  } catch (err) {
    reportFail('P3', 'GET /api/khong-ton-tai', 'ERR', 403, err.message);
  }

  // Đăng nhập bằng tài khoản Organizer để chạy E1 - E5
  let organizerCookie = null;
  try {
    const resOrgLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: ORGANIZER_EMAIL, password: ORGANIZER_PASSWORD },
    });
    if (resOrgLogin.status === 200 && resOrgLogin.cookie) {
      organizerCookie = resOrgLogin.cookie;
    }
  } catch (err) {
    console.error('Lỗi khi đăng nhập Organizer:', err.message);
  }

  let createdEventId = null;

  // E1: Organizer tạo sự kiện -> 201, status draft
  if (organizerCookie) {
    try {
      const resE1 = await request('/api/organizer/events', {
        method: 'POST',
        cookie: organizerCookie,
        body: { title: `E2E Concert ${timestamp}`, venue: 'Ha Noi Stadium' },
      });
      if (resE1.status === 201 && resE1.data?.data?.status === 'draft') {
        createdEventId = resE1.data.data.id;
        reportPass('E1', 'Organizer tạo sự kiện', resE1.status, 201);
      } else {
        reportFail('E1', 'Organizer tạo sự kiện', resE1.status, 201, JSON.stringify(resE1.data));
      }
    } catch (err) {
      reportFail('E1', 'Organizer tạo sự kiện', 'ERR', 201, err.message);
    }
  } else {
    reportFail('E1', 'Organizer tạo sự kiện', 'NO_AUTH', 201, 'Không thể đăng nhập bằng tài khoản Organizer');
  }

  // E2: GET /api/events (public) không chứa sự kiện nháp vừa tạo, không có owner_id
  try {
    const resE2 = await request('/api/events');
    const events = Array.isArray(resE2.data?.data) ? resE2.data.data : [];
    const containsDraft = createdEventId ? events.some((e) => e.id === createdEventId) : false;
    const hasOwnerId = events.some((e) => 'owner_id' in e);
    if (resE2.status === 200 && !containsDraft && !hasOwnerId) {
      reportPass('E2', 'GET /api/events (public)', resE2.status, 200);
    } else {
      reportFail(
        'E2',
        'GET /api/events (public)',
        resE2.status,
        200,
        `containsDraft=${containsDraft}, hasOwnerId=${hasOwnerId}`
      );
    }
  } catch (err) {
    reportFail('E2', 'GET /api/events (public)', 'ERR', 200, err.message);
  }

  // E3: Thêm suất diễn
  let showtimeId1 = null;
  let showtimeId2 = null;
  if (organizerCookie && createdEventId) {
    try {
      // 1. Suất diễn tương lai: 201
      const resFuture = await request(`/api/organizer/events/${createdEventId}/showtimes`, {
        method: 'POST',
        cookie: organizerCookie,
        body: { starts_at: '2028-12-01T19:00:00+07:00', room_name: 'Hall A' },
      });
      showtimeId1 = resFuture.data?.data?.id;

      // 2. Suất trùng giờ: 201 kèm warnings
      const resDup = await request(`/api/organizer/events/${createdEventId}/showtimes`, {
        method: 'POST',
        cookie: organizerCookie,
        body: { starts_at: '2028-12-01T19:00:00+07:00', room_name: 'Hall B' },
      });
      showtimeId2 = resDup.data?.data?.id;
      const hasWarnings = Array.isArray(resDup.data?.warnings) && resDup.data.warnings.length > 0;

      // 3. Suất quá khứ: 400
      const resPast = await request(`/api/organizer/events/${createdEventId}/showtimes`, {
        method: 'POST',
        cookie: organizerCookie,
        body: { starts_at: '2020-01-01T19:00:00+07:00', room_name: 'Hall C' },
      });

      // 4. Thiếu múi giờ: 400
      const resNoTz = await request(`/api/organizer/events/${createdEventId}/showtimes`, {
        method: 'POST',
        cookie: organizerCookie,
        body: { starts_at: '2028-12-01T19:00:00', room_name: 'Hall D' },
      });

      if (
        resFuture.status === 201 &&
        resDup.status === 201 &&
        hasWarnings &&
        resPast.status === 400 &&
        resNoTz.status === 400
      ) {
        reportPass('E3', 'Thêm suất diễn (tương lai, trùng giờ, quá khứ, thiếu múi giờ)', 201, 201);
      } else {
        reportFail(
          'E3',
          'Thêm suất diễn',
          `${resFuture.status},${resDup.status},${resPast.status},${resNoTz.status}`,
          '201,201(warnings),400,400'
        );
      }
    } catch (err) {
      reportFail('E3', 'Thêm suất diễn', 'ERR', 201, err.message);
    }
  } else {
    reportSkip('E3', 'Thêm suất diễn', 'cần tạo sự kiện');
  }

  // E4: Buyer GET /api/organizer/events/:id -> 403
  if (buyerCookie && createdEventId) {
    try {
      const resE4 = await request(`/api/organizer/events/${createdEventId}`, {
        cookie: buyerCookie,
      });
      if (resE4.status === 403) {
        reportPass('E4', 'Buyer GET /api/organizer/events/:id', resE4.status, 403);
      } else {
        reportFail('E4', 'Buyer GET /api/organizer/events/:id', resE4.status, 403);
      }
    } catch (err) {
      reportFail('E4', 'Buyer GET /api/organizer/events/:id', 'ERR', 403, err.message);
    }
  } else {
    reportSkip('E4', 'Buyer GET /api/organizer/events/:id', 'cần đăng nhập buyer và sự kiện');
  }

  // E5: Xoá sự kiện còn suất diễn -> 409; xoá hết suất rồi xoá sự kiện -> 200
  if (organizerCookie && createdEventId) {
    try {
      // Thử xoá sự kiện khi còn suất diễn
      const resDelBlocked = await request(`/api/organizer/events/${createdEventId}`, {
        method: 'DELETE',
        cookie: organizerCookie,
      });

      // Xoá các suất diễn
      if (showtimeId1) {
        await request(`/api/organizer/showtimes/${showtimeId1}`, {
          method: 'DELETE',
          cookie: organizerCookie,
        });
      }
      if (showtimeId2) {
        await request(`/api/organizer/showtimes/${showtimeId2}`, {
          method: 'DELETE',
          cookie: organizerCookie,
        });
      }

      // Xoá lại sự kiện sau khi đã dọn sạch suất diễn
      const resDelClean = await request(`/api/organizer/events/${createdEventId}`, {
        method: 'DELETE',
        cookie: organizerCookie,
      });

      if (resDelBlocked.status === 409 && resDelClean.status === 200) {
        reportPass('E5', 'Xoá sự kiện có ràng buộc suất diễn', 200, 200);
        createdEventId = null; // Đã xoá thành công
      } else {
        reportFail(
          'E5',
          'Xoá sự kiện',
          `blocked:${resDelBlocked.status}, clean:${resDelClean.status}`,
          '409 rồi 200'
        );
      }
    } catch (err) {
      reportFail('E5', 'Xoá sự kiện', 'ERR', 200, err.message);
    }
  } else {
    reportSkip('E5', 'Xoá sự kiện có ràng buộc suất diễn', 'cần sự kiện');
  }

  // O1: Đăng xuất -> 200; gọi session bằng cookie cũ -> 401
  if (organizerCookie) {
    try {
      const resO1 = await request('/api/auth/logout', {
        method: 'POST',
        cookie: organizerCookie,
      });
      const resSessionAfterLogout = await request('/api/auth/session', {
        cookie: organizerCookie,
      });
      if (resO1.status === 200 && resSessionAfterLogout.status === 401) {
        reportPass('O1', 'Đăng xuất và vô hiệu phiên', resO1.status, 200);
      } else {
        reportFail('O1', 'Đăng xuất và vô hiệu phiên', resO1.status, 200);
      }
    } catch (err) {
      reportFail('O1', 'Đăng xuất và vô hiệu phiên', 'ERR', 200, err.message);
    }
  } else {
    reportSkip('O1', 'Đăng xuất', 'cần phiên đăng nhập');
  }

  // K1: Sai mật khẩu 5 lần với một email test riêng -> lần 6 nhận 429 kèm retryAfterSeconds
  // CHỈ chạy khi đặt E2E_LOCKOUT=1 hoặc cờ --lockout
  if (IS_LOCKOUT) {
    const lockoutEmail = `lockout.${Date.now()}.${Math.random().toString(36).substring(2, 6)}@example.test`;
    try {
      let attemptsOk = true;
      for (let i = 1; i <= 5; i++) {
        const attempt = await request('/api/auth/login', {
          method: 'POST',
          body: { email: lockoutEmail, password: 'WrongPassword123' },
        });
        if (attempt.status !== 401) {
          attemptsOk = false;
          break;
        }
      }
      const sixthAttempt = await request('/api/auth/login', {
        method: 'POST',
        body: { email: lockoutEmail, password: 'WrongPassword123' },
      });
      const hasRetryAfter = Boolean(sixthAttempt.data?.retryAfterSeconds);
      if (attemptsOk && sixthAttempt.status === 429 && hasRetryAfter) {
        reportPass('K1', 'Khoá đăng nhập sau 5 lần sai mật khẩu', sixthAttempt.status, 429);
      } else {
        reportFail(
          'K1',
          'Khoá đăng nhập sau 5 lần sai mật khẩu',
          sixthAttempt.status,
          429,
          JSON.stringify(sixthAttempt.data)
        );
      }
    } catch (err) {
      reportFail('K1', 'Khoá đăng nhập sau 5 lần sai mật khẩu', 'ERR', 429, err.message);
    }
  } else {
    reportSkip('K1', 'Khoá đăng nhập sau 5 lần sai mật khẩu', 'CHỈ chạy khi đặt E2E_LOCKOUT=1');
  }

  // Dọn dẹp nếu sự kiện chưa bị xoá
  if (createdEventId && organizerCookie) {
    try {
      await request(`/api/organizer/events/${createdEventId}`, {
        method: 'DELETE',
        cookie: organizerCookie,
      });
    } catch {
      // bỏ qua lỗi dọn dẹp
    }
  }

  console.log('\n=== TỔNG KẾT E2E SPRINT 1 ===');
  console.log(`PASS: ${passCount} | FAIL: ${failCount} | SKIP: ${skipCount}`);

  if (failCount > 0) {
    console.log(`E2E: FAIL ${failCount} bước`);
    process.exit(1);
  } else {
    console.log('E2E: PASS');
    process.exit(0);
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Lỗi ngoại lệ trong quá trình chạy E2E:', err);
    console.log('E2E: FAIL 1 bước');
    process.exit(1);
  });
}

module.exports = { run };
