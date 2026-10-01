# Hệ Thống Bán Vé Sự Kiện

Dự án backend bán vé sự kiện xây dựng trên Node.js, Express, Knex, PostgreSQL và Redis.

---

## Chạy dự án

Yêu cầu Node.js 20.19+ (hoặc 22.13+/24+), PostgreSQL 15+ và Redis 7+.

### Cách 1: Sử dụng Docker Desktop (Nếu máy có Docker)

```bash
# 1. Tạo cấu hình (PowerShell: Copy-Item .env.example .env)
cp .env.example .env

# 2. Khởi động PostgreSQL và Redis
docker compose up -d db redis

# 3. Cài dependency
npm ci

# 4. Kiểm tra cấu hình/kết nối, rồi migrate và seed database ứng dụng
npm run doctor
npm run setup

# 5. Kiểm tra toàn diện trên database TẠM RIÊNG
npm run build
npm run verify

# 6. Khởi động ứng dụng
npm start
```

### Cách 2: Chạy trực tiếp với PostgreSQL & Redis cài trên máy (Local không dùng Docker)

Nếu máy bạn đã cài PostgreSQL và Redis trực tiếp:
1. **Sao chép cấu hình:**
   - Trên PowerShell: `Copy-Item .env.example .env`
   - Trên Linux / macOS / Git Bash: `cp .env.example .env`
2. **Cập nhật thông tin trong `.env`:**
   - Mở file `.env`, cập nhật `DB_CONNECTION_STRING` với mật khẩu PostgreSQL thực tế của máy bạn khi cài đặt (thay thế `your_postgres_password`).
   - Đảm bảo `REDIS_URL` trỏ đúng vào địa chỉ Redis đang chạy (mặc định: `redis://localhost:6379`).
3. **Cài đặt dependencies:**
   ```bash
   npm ci
   ```
4. **Tạo database ứng dụng nếu chưa có (không cần Docker hoặc `psql`):**
   ```bash
   npm run db:create
   ```
   *(Script sẽ tự động kết nối và tạo cơ sở dữ liệu `ban_ve_su_kien` một cách an toàn).*
5. **Kiểm tra môi trường & khởi tạo bảng / dữ liệu demo:**
   ```bash
   npm run doctor
   npm run setup
   ```
   *(Lệnh `setup` cũng sẽ tự động phát hiện và tạo database nếu bạn chưa chạy bước 4).*
6. **Kiểm tra toàn diện trên database TẠM:**
   ```bash
   npm run build
   npm run verify
   ```
7. **Khởi động ứng dụng:**
   ```bash
   npm start
   ```

---

Chạy toàn bộ stack bằng Docker: tạo `.env`, cấu hình cổng không trùng với dịch vụ
đang chạy rồi dùng `docker compose up --build`. Lệnh khởi động trong `docker-compose.yml` (chỉ dùng
trên máy cá nhân) chạy `npm run migrate:latest` (tạo bảng, vá cột và chèn 5 vai trò hệ thống nền tảng),
sau đó chỉ chạy `npm run seed:run` khi biến `DEMO_*` được cấu hình rõ ràng, rồi mở server bằng `npm start`.
`Dockerfile` (dùng cho Render/staging) chỉ chạy `migrate:latest` rồi `npm start`, **không bao giờ seed**:
seed đặt lại mật khẩu tài khoản demo nên không được chạy tự động trên staging/production.
Trên Render, chỉ cần deploy lại để `migrate:latest` tự nạp vai trò hệ thống và vá cột `purpose` cho database hiện tại.
Đây là cấu hình development; email dùng chế độ dev.

`verify` không khởi tạo database ứng dụng: nó tạo database tạm, migrate/rollback,
seed, lint/test rồi dọn database tạm. Không dùng `verify` thay cho `setup`.
Trong database tạm, `verify` luôn dùng `NODE_ENV=test` và `MAIL_TRANSPORT=dev`,
không gửi email qua SMTP thật dù `.env` của máy đang cấu hình SMTP.
`doctor` báo migration thuộc nhánh khác thì dùng database mới hoặc đối chiếu
đúng nhánh. Không xóa volume/database đang có dữ liệu để xử lý lỗi này.
Redis cũ (ví dụ bản Windows 5.x) không hỗ trợ `EXPIRE NX` mà đăng nhập/gửi lại
email đang dùng. `doctor` kiểm tra phiên bản trước khi setup. Nếu cổng 5432/6379
đã có dịch vụ, đổi `POSTGRES_PORT`/`REDIS_PORT` và cập nhật URL tương ứng trong
`.env`; không dừng/xóa dịch vụ hoặc dữ liệu khác để giải phóng cổng.

## Kiểm tra CI và nghiệm thu tuần 1

CI chạy build (syntax và Docker image), lint, verify và audit ở các job độc lập;
lint và test có thể chạy song song. Check tổng `ci` chỉ đạt khi cả bốn job đạt.
PR nhắm vào `develop-v2`. Maintainer cần bật branch protection/ruleset: yêu cầu
check `ci` thành công và ít nhất một review phê duyệt, không cho tự merge khi CI đỏ.
Giới hạn năm phút của từng job không thay cho số đo thời gian cả pipeline.

`npm run spike:holds` chạy spike K-01 với PostgreSQL/Redis localhost: mỗi phương án
nhận 200 yêu cầu vào cùng một ghế, năm lần; thất bại nếu có hơn một người thắng.
Script chỉ dùng database tạm và key Redis mang prefix riêng, không phải API giữ
ghế sản phẩm. Kết quả và quyết định nằm trong `docs/decisions/`.

Nghiệm thu Render dùng `npm run staging:check`, với `STAGING_URL` và
`STAGING_EXPECTED_REVISION` (SHA 40 ký tự). `/health` kiểm tra DB, Redis và trả
revision từ `RENDER_GIT_COMMIT` hoặc `APP_REVISION`. Xem quy trình, giới hạn và
các bằng chứng còn cần trong `docs/verification/sprint-1.md`.

---

## 1. Yêu Cầu & Biến Môi Trường

Hệ thống sử dụng các biến môi trường để cấu hình kết nối cơ sở dữ liệu PostgreSQL, Redis và tài khoản demo ban đầu.

### Tạo file cấu hình `.env` từ file mẫu:

- **Trên Windows PowerShell:**
  ```powershell
  Copy-Item .env.example .env
  ```

- **Trên macOS / Linux / Git Bash:**
  ```bash
  cp .env.example .env
  ```

Sau khi tạo, mở file `.env` và điền các thông tin thực tế.

### Danh sách các biến môi trường cần thiết:

| Tên biến | Mô tả | Ví dụ |
| :--- | :--- | :--- |
| `PORT` | Cổng chạy của Express server | `8090` |
| `TRUST_PROXY` | Cấu hình trust proxy cho Express (`false`, `true`, hoặc số hop) | `false` |
| `DB_CONNECTION_STRING` | Chuỗi kết nối PostgreSQL | `postgresql://postgres:password@localhost:5432/ban_ve_su_kien` |
| `POSTGRES_USER` | Tên người dùng CSDL | `postgres` |
| `POSTGRES_PASSWORD` | Mật khẩu người dùng CSDL | `secret` |
| `POSTGRES_DB` | Tên cơ sở dữ liệu | `ban_ve_su_kien` |
| `REDIS_URL` | URL kết nối Redis | `redis://localhost:6379` |
| `REDIS_KEY_PREFIX` | Tiền tố cho mọi key lưu trong Redis | `bvsk:` |
| `LOGIN_MAX_FAILED_ATTEMPTS` | Số lần đăng nhập sai tối đa theo email trước khi khoá | `5` |
| `LOGIN_MAX_IP_FAILED_ATTEMPTS` | Số lần đăng nhập sai tối đa theo IP trước khi khoá | `20` |
| `LOGIN_LOCK_SECONDS` | Thời gian khoá đăng nhập (giây) | `900` |
| `SESSION_COOKIE_NAME` | Tên cookie lưu session token | `session_token` |
| `SESSION_TTL_SECONDS` | Thời gian sống của phiên đăng nhập trong Redis (giây) | `28800` |
| `DEMO_ADMIN_EMAIL` | Email tài khoản demo Admin | `admin@example.com` |
| `DEMO_ADMIN_PASSWORD` | Mật khẩu tài khoản demo Admin | `Admin@123456` |
| `DEMO_ORGANIZER_EMAIL` | Email tài khoản demo Organizer | `organizer@example.com` |
| `DEMO_ORGANIZER_PASSWORD` | Mật khẩu tài khoản demo Organizer | `Organizer@123456` |
| `APP_BASE_URL` | Địa chỉ gốc của ứng dụng web | `http://localhost:8090` |
| `ACTIVATION_CODE_TTL_SECONDS` | Thời gian hiệu lực của mã xác nhận 6 số | `600` |
| `ACTIVATION_CODE_MAX_ATTEMPTS` | Số lần nhập sai tối đa trước khi phải yêu cầu mã mới | `5` |
| `MAIL_TRANSPORT` | Phương thức gửi email (`dev`, `smtp` hoặc `brevo`) | `dev` |
| `BREVO_API_KEY` | API key gửi email HTTPS của Brevo (khi dùng `brevo`) | `xkeysib-...` |
| `MAIL_TIMEOUT_MS` | Thời gian tối đa chờ nhà cung cấp email | `10000` |
| `SMTP_HOST` | Địa chỉ máy chủ SMTP (khi dùng `smtp`) | `smtp.example.com` |
| `SMTP_PORT` | Cổng SMTP | `587` |
| `SMTP_USER` | Tên người dùng SMTP | `user@example.com` |
| `SMTP_PASS` | Mật khẩu SMTP | `secret` |
| `SMTP_SECURE` | Cấu hình SSL/TLS cho SMTP (`true`/`false`) | `false` |
| `MAIL_FROM` | Địa chỉ người gửi hiển thị | `"Ban Ve" <no-reply@example.com>` |

Trên Render Free, các cổng SMTP 25/465/587 bị chặn. Hãy dùng `MAIL_TRANSPORT=brevo`, tạo API key Brevo và xác minh địa chỉ gửi trong `MAIL_FROM`; ứng dụng gửi qua HTTPS nên không phụ thuộc cổng SMTP.

> **Lưu ý bảo mật:** Tuyệt đối không commit file `.env` chứa mật khẩu thật vào Git repository.

---

## 2. Cài Đặt Dependency

Cài đặt tất cả các gói phụ thuộc (bao gồm `argon2`, `knex`, `pg`, `express`, `dotenv`):
```bash
npm install
```

---

## 3. Quản Lý Migration

Hệ thống sử dụng Knex Migrations để quản lý cấu trúc bảng trong CSDL.

### Chạy Migration tiến (up to latest):
```bash
npm run migrate:latest
```
Lệnh này sẽ áp dụng các migration chưa chạy:
- Bảng `roles`: `id` (PK), `name` (unique), timestamps `created_at`, `updated_at`.
- Bảng `users`: `id` (PK), `email` (unique), `password_hash` (Argon2id, >= 255 ký tự), `is_active`, timestamps `created_at`, `updated_at`.
- Bảng `user_roles`: `user_id`, `role_id` (khóa chính ghép `(user_id, role_id)`, khóa ngoại liên kết tới `users` và `roles` với hành vi `ON DELETE CASCADE`).

### Rollback Migration (down) & Lưu ý an toàn:
```bash
npm run migrate:rollback
```

> **CẢNH BÁO QUAN TRỌNG VỀ BATCH ROLLBACK TRONG KNEX:**
> - Knex **không rollback theo từng file đơn lẻ** mà sẽ rollback **toàn bộ batch mới nhất (maximum batch)** trong bảng `knex_migrations`.
> - Do đó, **không được khẳng định** `npm run migrate:rollback` luôn chỉ rollback riêng T-04.
> - **Trước khi rollback**, bắt buộc phải kiểm tra trạng thái bằng:
>   ```bash
>   npx knex migrate:status
>   ```
>   đồng thời truy vấn bảng `knex_migrations` để xem số thứ tự batch của từng migration.
> - **Nguyên tắc an toàn:**
>   - Chỉ thực hiện rollback T-04 khi migration T-04 nằm riêng lẻ ở batch cao nhất và các migration của task khác (như `events` của T-01–T-03) nằm ở batch thấp hơn.
>   - **Không rollback** nếu batch mới nhất chứa migration của task khác hoặc chứa nhiều migration gộp chung ngoài T-04, để tránh làm mất bảng hoặc dữ liệu của các chức năng khác.

Khi rollback T-04 an toàn:
- Hệ thống sẽ xóa các bảng theo đúng thứ tự phụ thuộc ngược: `user_roles` -> `users` -> `roles`.
- Bảo toàn nguyên vẹn bảng `events` thuộc các task trước.

---

## 4. Quản Lý Seed Dữ Liệu

Seed dùng để khởi tạo dữ liệu mẫu cho hệ thống và có tính **Idempotent** (có thể chạy nhiều lần mà không sinh dữ liệu trùng lặp):

### Chạy Seed:
```bash
npm run seed:run
```

**Đặc điểm của Seed:**
- 5 vai trò hệ thống (`buyer`, `organizer`, `checker`, `accountant`, `admin`) được khởi tạo tự động qua migration (dữ liệu nền hệ thống).
- Seed chỉ phụ trách tạo 2 tài khoản demo: Admin (gán role `admin`) và Organizer (gán role `organizer`).
- Nếu thiếu các biến môi trường `DEMO_*`, seed sẽ in cảnh báo `[SEED WARN]` và bỏ qua tạo tài khoản demo mà không ném lỗi (ở production chỉ tạo tài khoản demo khi `DEMO_*` được đặt rõ ràng).
- Mật khẩu được hash an toàn bằng thuật toán **Argon2id** (`argon2.argon2id`), không bao giờ lưu mật khẩu thô trong database.
- Không xóa hay làm ảnh hưởng đến các bản ghi người dùng / vai trò khác ngoài dữ liệu demo (hỗ trợ CSDL đã có sẵn dữ liệu trước đó).

---

## 5. Kiểm Thử Hệ Thống (Testing)

### Kiểm thử Unit & Integration:
```bash
npm test
```

### Kiểm thử End-to-End Sprint 1 (E2E):

Bộ kiểm thử E2E kiểm tra toàn bộ 24 tiêu chí nghiệp vụ Sprint 1 (H1-H2, R1-R4, L1-L2, A1-A4, L3, S1, P1-P3, E1-E5, O1, K1) qua giao thức HTTP thuần:

#### 1. Chạy cơ bản (mặc định kiểm tra `http://localhost:8090`):
- **Trên mọi hệ điều hành (PowerShell, Bash, CMD):**
  ```bash
  npm run e2e:sprint1
  ```

#### 2. Chạy kèm kiểm tra khoá đăng nhập (K1 - sai 5 lần nhận HTTP 429):
- **Khuyên dùng (chạy đa nền tảng, không phụ thuộc shell):**
  ```bash
  npm run e2e:sprint1:lockout
  ```
- **Hoặc qua tham số dòng lệnh CLI:**
  ```bash
  node scripts/e2e-sprint1.js --lockout
  ```
- **Trên Windows PowerShell:**
  ```powershell
  $env:E2E_LOCKOUT="1"; npm run e2e:sprint1
  ```
- **Trên Linux / macOS / Git Bash:**
  ```bash
  E2E_LOCKOUT=1 npm run e2e:sprint1
  ```

#### 3. Chạy với log kích hoạt email (`DEV_MAIL_FILE`):
Khi chạy máy chủ ở chế độ dev (`MAIL_TRANSPORT=dev`), email chứa mã xác nhận 6 số được ghi ra console/file. Để runner E2E tự động đọc mã OTP kích hoạt tài khoản:
- **Khởi động server có ghi file log dev mail:**
  - PowerShell: `$env:DEV_MAIL_FILE=".\dev_mail.log"; npm start`
  - Bash: `DEV_MAIL_FILE=./dev_mail.log npm start`
- **Chạy E2E với file log:**
  - Qua tham số CLI (mọi shell):
    ```bash
    node scripts/e2e-sprint1.js --mail-file=./dev_mail.log --lockout
    ```
  - PowerShell:
    ```powershell
    $env:DEV_MAIL_FILE=".\dev_mail.log"; npm run e2e:sprint1:lockout
    ```
  - Bash:
    ```bash
    DEV_MAIL_FILE=./dev_mail.log npm run e2e:sprint1:lockout
    ```
*(Ghi chú: Nếu chạy local mà không truyền tham số, runner sẽ tự động kiểm tra nếu có file `.dev_mail_local.log` hoặc `.dev_mail.log` trong thư mục gốc).*

#### 4. Kiểm thử máy chủ staging (Render):
- **PowerShell:**
  ```powershell
  $env:BASE_URL="https://ban-ve-su-kien.onrender.com"; npm run e2e:sprint1
  ```
- **Bash / Linux / macOS:**
  ```bash
  BASE_URL=https://ban-ve-su-kien.onrender.com npm run e2e:sprint1
  ```

Tất cả các bài kiểm thử tự động được đặt trong thư mục `test/`:
- `test/fresh-clone-repair.test.js`: Kiểm thử kiểm tra schema, seed không có DEMO_* và vá schema lệch cho DB cũ.
- `test/events.test.js`: Kiểm thử API sự kiện, phân quyền truy cập, kiểm tra dữ liệu, lọc sự kiện nháp/công khai và migration gán owner_id cho admin.
- `test/showtimes.test.js`: Kiểm thử API suất diễn, xác thực múi giờ, kiểm tra thời điểm tương lai/quá khứ, cảnh báo trùng giờ và lưu trữ chuẩn UTC.
- `test/eventForm.test.js`: Kiểm thử các hàm thuần validateEventForm, validateShowtimeForm, toIsoVietnam và formatVietnamDateTime.
- `test/register.test.js`: Kiểm thử luồng đăng ký người mua, kiểm tra dữ liệu, chống timing attack, concurrency race condition và bảo mật log.
- `test/activation.test.js`: Kiểm thử kích hoạt tài khoản atomic, token hết hạn (410), đã dùng (409), rate limit gửi lại qua Redis, và đăng nhập với tài khoản chưa kích hoạt (403 ACCOUNT_NOT_ACTIVE).
- `test/t04-schema.test.js`: Xác minh schema 3 bảng `roles`, `users`, `user_roles`, ràng buộc `UNIQUE` email, khóa chính ghép, 5 roles và xác thực mật khẩu Argon2id của 2 tài khoản demo.
- Các bài kiểm thử khác: `test/authService.test.js`, `test/rbac.test.js`, `test/startup.test.js`, `test/health.test.js`, `test/logger.test.js`, `test/api-client.test.js`, `test/menu.test.js`.

---

## 6. Chức Năng Đăng Nhập & Quản Lý Phiên (T-05 / S-02)

- **Mật khẩu & Chống timing attack:** Xác thực bằng Argon2id (`argon2.argon2id`) kết hợp dummy hash khi email không tồn tại nhằm đồng đều thời gian phản hồi.
- **Bảo mật phản hồi:** Trả về thông báo lỗi `Email hoặc mật khẩu không đúng.` (HTTP 401) khi email không tồn tại hoặc mật khẩu sai. Khi mật khẩu đúng nhưng tài khoản chưa kích hoạt (`is_active = false`), trả về HTTP 403 `ACCOUNT_NOT_ACTIVE` kèm hướng dẫn kích hoạt (không tăng bộ đếm khoá sai mật khẩu).
- **Khoá tạm thời chống dò mật khẩu:**
  - Khoá theo email: sau 5 lần đăng nhập sai trong vòng 15 phút.
  - Khoá theo IP: sau 20 lần đăng nhập sai từ cùng một IP trong vòng 15 phút.
  - Khi bị khoá, trả về HTTP 429 cùng header `Retry-After` và trường `retryAfterSeconds` trong body.
  - Trạng thái khoá và số lần thử sai được lưu trữ an toàn trong Redis, đảm bảo persistence khi service khởi động lại.
- **Quản lý phiên (Session Management):**
  - Lưu phiên đăng nhập trong Redis với TTL mặc định 8 giờ.
  - Gửi cookie phiên với cờ `HttpOnly`, `SameSite=Lax` (và `Secure` khi chạy production).
  - Khi phiên hết hạn hoặc không hợp lệ, trả về HTTP 401.
- **Bảo vệ dữ liệu cá nhân:** Tuyệt đối không log thông tin email thô, mật khẩu hoặc session token vào server logs.
- **Endpoints:**
  - `POST /api/auth/login`: Nhận `{ email, password }`, trả về 200 kèm cookie phiên khi đúng.
  - `GET /api/auth/session`: Đọc cookie phiên, trả về thông tin phiên người dùng hoặc 401 khi hết hạn.
  - `POST /api/auth/logout`: Xoá session trong Redis và xoá cookie ở trình duyệt.

---

## 7. Sao Lưu Cơ Sở Dữ Liệu (Backup)

Dự án cung cấp script sao lưu tự động chạy đa nền tảng (Windows, macOS, Linux):
```bash
npm run backup
```

- Sử dụng tiện ích `pg_dump` dựa trên cấu hình `DB_CONNECTION_STRING`.
- File sao lưu được lưu tự động vào thư mục `backups/` theo định dạng `backup_YYYYMMDD_HHMMSS.sql`.
- Đảm bảo an toàn thông tin: không in chuỗi kết nối chứa mật khẩu ra log.

---

## 8. Đăng Ký & Kích Hoạt Tài Khoản (T-07, T-08 / S-03)

- **Đăng ký an toàn (`POST /api/auth/register`):**
  - Nhận `email`, `password`, `full_name`. Kiểm tra định dạng dữ liệu đầu vào.
  - Tạo tài khoản với vai trò mặc định `buyer` và trạng thái `is_active = false`.
  - Sinh mã xác nhận 6 số ngẫu nhiên (`crypto.randomInt`), chỉ lưu hash SHA-256 vào bảng `email_activation_tokens`, hiệu lực `ACTIVATION_CODE_TTL_SECONDS` (mặc định 600 giây).
  - **Chống lộ thông tin:** Luôn trả về HTTP 202 cùng thông báo chung `"Nếu email hợp lệ, mã xác nhận sẽ được gửi đến hộp thư."` bất kể email mới hay đã tồn tại (đồng thời chạy dummy hash để cân bằng thời gian phản hồi).
  - **Xử lý đồng thời:** Xử lý race condition an toàn qua ràng buộc unique, trả về 202 và không gây lỗi 500 khi có nhiều request đăng ký cùng lúc.
- **Kích hoạt tài khoản (`POST /api/auth/activate`):**
  - Trang `public/activate.html` cho người dùng nhập email và mã 6 số, gọi `POST /api/auth/activate` với `{ email, code }`.
  - Sử dụng một câu lệnh SQL atomic duy nhất (`UPDATE ... RETURNING`) để ngăn chặn tuyệt đối tình trạng kích hoạt trùng lặp.
  - Trả về HTTP 200 khi thành công; 400 `CODE_INVALID` khi mã sai; 429 `CODE_LOCKED` khi sai quá `ACTIVATION_CODE_MAX_ATTEMPTS` lần (mặc định 5, phải yêu cầu mã mới); 409 khi mã đã dùng hoặc tài khoản đã kích hoạt; 410 `CODE_EXPIRED` khi mã hết hạn.
  - Liên kết kích hoạt dạng token cũ (`{ token }`) vẫn được chấp nhận để tương thích ngược: 409 khi token đã dùng, 410 khi hết hạn, 400 khi không hợp lệ.
- **Gửi lại email kích hoạt (`POST /api/auth/resend-activation`):**
  - Giới hạn tối đa 5 lần gửi lại mỗi giờ cho một email (quản lý qua Redis).
  - Vô hiệu hoá các mã cũ còn hạn của người dùng trước khi sinh mã mới.
  - Luôn trả về HTTP 202 với thông báo chung.
- **Dịch vụ Email (`services/emailService.js`):**
  - Môi trường dev/test: In nội dung email kèm mã xác nhận 6 số ra console dạng khối `[DEV MAIL]`.
  - Môi trường production: Gửi email thực qua giao thức SMTP sử dụng `nodemailer`. Kiểm tra cấu hình bắt buộc khi ứng dụng khởi động.

---

## 9. Quản Lý Sự Kiện & Suất Diễn (T-09, T-10 / S-04)

### Giao diện Sprint 1

- `/home.html`: trang công khai; tải các sự kiện đã xuất bản qua `GET /api/events`.
- `/login.html`: đăng nhập qua `POST /api/auth/login`, chuyển đến khu vực phù hợp với vai trò; hỗ trợ hiện/ẩn mật khẩu và báo thời gian khóa tạm thời. Giao diện dùng biểu tượng vé và nền SVG nhẹ; không hiện đăng nhập Google, ghi nhớ đăng nhập hay quên mật khẩu vì backend chưa hỗ trợ các chức năng này.
- `/register.html`: đăng ký người mua qua `POST /api/auth/register`, kiểm tra họ tên/email/mật khẩu/xác nhận mật khẩu ở trình duyệt; sau phản hồi chung `202`, hiển thị hướng dẫn kiểm tra email và liên kết tới bước nhập mã tại `/activate.html` (`POST /api/auth/activate`, `POST /api/auth/resend-activation`).
- `/organizer-events.html`: dashboard tính từ `GET /api/organizer/events`, tạo/sửa sự kiện và thêm suất diễn qua các API organizer hiện có. Dữ liệu dashboard không phải số liệu giả.
- `/buyer.html`: xem sự kiện đã xuất bản qua `GET /api/workspaces/buyer` và xem sơ đồ ghế đã lưu qua `GET /api/workspaces/buyer/events/:id/seat-maps`. Chưa có chức năng chọn ghế, mua vé hoặc thanh toán.

Menu được thay đổi theo phiên/role ở frontend để dễ sử dụng; phân quyền thật vẫn nằm ở middleware backend. Nếu màn hình nhỏ, menu chuyển sang nút mở/đóng; form vẫn cuộn dọc bình thường.

Luồng mở bán: tạo sự kiện (bản nháp) → thêm suất diễn trong tương lai → vào **Sơ đồ ghế**, chọn tệp JSON và bấm **Xác nhận nạp** → quay về chi tiết sự kiện, bấm **Xuất bản**. Sự kiện chỉ hiện ở `/buyer.html` sau khi xuất bản. Trang nạp sơ đồ ghế có tệp mẫu để tải và hiển thị số ghế đã lưu khi mở lại.

Để thử luồng này trên máy với database tạm (cần PostgreSQL và Redis đang chạy), dùng `npm run demo:event-flow`. Script mở `http://localhost:8091/login.html`, in ra hai tài khoản demo và mật khẩu dùng một lần trong terminal. Nhấn `Ctrl+C` để dừng server và xóa database demo; không sửa `.env` hoặc database đang dùng.

- **Mô hình dữ liệu:**
  - Bảng `events`: Bổ sung `owner_id` (FK tới `users.id` với `ON DELETE RESTRICT`), `venue`, `status` (`draft`, `published`, `archived`), bỏ các cột giá và tổng số vé cũ.
  - Bảng `showtimes`: Lưu các suất diễn gắn với sự kiện (`event_id` với `ON DELETE RESTRICT`), thời điểm bắt đầu `starts_at` (`timestamptz`), tên phòng `room_name`.
- **Phân quyền truy cập:**
  - Ban tổ chức (`organizer`) chỉ xem, sửa, xoá các sự kiện và suất diễn của chính mình.
  - Quản trị viên (`admin`) có quyền quản lý toàn bộ sự kiện và suất diễn trên hệ thống.
  - Khách truy cập và người mua vé chỉ xem được danh sách sự kiện công khai đã ở trạng thái `published` qua `GET /api/events`. Sự kiện ở trạng thái `draft` không bao giờ hiện với người mua.
- **Quy tắc suất diễn & thời gian:**
  - Thời gian luôn lưu trữ chuẩn UTC trong PostgreSQL và hiển thị theo múi giờ Việt Nam (`Asia/Ho_Chi_Minh`, `+07:00`) trên giao diện người dùng.
  - Chặn thêm hoặc cập nhật suất diễn ở quá khứ (HTTP 400 kèm thông báo rõ ràng).
  - Bắt buộc chuỗi thời gian phải có múi giờ hợp lệ (ví dụ `+07:00` hoặc `Z`).
  - Khi hai suất diễn cùng sự kiện trùng hoàn toàn thời gian: hệ thống vẫn cho phép lưu và trả về HTTP 201 kèm danh sách cảnh báo `warnings` màu vàng trên giao diện.
- **Ràng buộc toàn vẹn khi xoá:**
  - Không thể xoá sự kiện khi vẫn còn suất diễn con gắn kèm (HTTP 409). Phải xoá toàn bộ suất diễn trước khi xoá sự kiện.
- **Giao diện quản lý (`public/organizer-events.html`):**
  - Giao diện danh sách sự kiện, form tạo sự kiện mới, trang chi tiết sự kiện và quản lý suất diễn.
  - Chống bấm gửi trùng lặp (vô hiệu hoá nút submit trong lúc đang gửi yêu cầu).
  - Hiển thị lỗi kiểm tra dữ liệu trực tiếp dưới từng ô nhập liệu.

---

## 10. Sơ đồ ghế (T-11 – T-14 / S-05, S-06)

- **Mô hình dữ liệu & API nạp sơ đồ:**
  - Migration tạo bảng `seat_categories` và `seats` theo từng suất diễn (`showtimes`). Một suất diễn không thể có hai ghế cùng hàng và số (`UNIQUE(showtime_id, row, number)`); hạng ghế phải thuộc chính suất diễn đó. Có index theo `showtime_id`, kiểm tra số ghế dương (`number > 0`) và migration rollback theo đúng thứ tự phụ thuộc ngược (`seats` trước, `seat_categories` sau).
  - API `POST /api/organizer/showtimes/:id/seats/import` dành cho `admin` hoặc chủ sự kiện có vai trò `organizer`. Gửi `multipart/form-data` với đúng một tệp JSON ở trường `file` (tối đa 5 MB). Phản hồi thành công: `200` và `{ "success": true, "data": { "showtime_id": 1, "seats_count": 2000, "categories_count": 2 } }`.

### Không gian làm việc theo vai trò

- `buyer`: `/buyer.html`, xem các sự kiện đang mở bán.
- `organizer`: `/organizer-events.html`, quản lý sự kiện và suất diễn thuộc quyền sở hữu.
- `checker`: `/checker.html`, khu vực soát vé.
- `accountant`: `/accountant.html`, khu vực đối soát.
- `admin`: `/admin-staff.html`, tạo, khóa/mở khóa và phân vai trò cho nhân viên.
- Người mua chỉ được tạo qua luồng đăng ký công khai. API quản trị nhân viên chỉ chấp nhận `organizer`, `checker`, `accountant` và được bảo vệ bằng vai trò `admin` ở backend.
  - Nạp lại sẽ thay thế toàn bộ ghế và hạng cũ trong **một giao dịch** duy nhất; nếu có bất kỳ lỗi nào, dữ liệu được rollback toàn bộ về trạng thái trước đó. Yêu cầu bị từ chối `409` nếu suất diễn đã có vé bán ra hoặc giữ chỗ còn hiệu lực.

- **Định dạng tệp:** `{ "seats": [ { "row", "number", "category" } ] }`
  ```json
  {
    "seats": [
      { "row": "A", "number": 1, "category": "VIP" },
      { "row": "A", "number": 2, "category": "Thường" }
    ]
  }
  ```
  - `row`: Chuỗi ký tự định danh hàng ghế (tối đa 32 ký tự, không được để trống sau khi trim).
  - `number`: Số thứ tự ghế trong hàng (số nguyên dương từ 1 đến 2.147.483.647).
  - `category`: Tên hạng ghế (tối đa 100 ký tự, không được để trống sau khi trim).
  - Giới hạn: Mỗi suất diễn tối đa 10.000 ghế (`TOO_MANY_SEATS`) và tối đa 50 hạng ghế khác nhau (`TOO_MANY_CATEGORIES`).

- **Giao diện tải lên & xem trước:**
  - **Trang tải lên:** `/seat-map-upload.html?showtimeId=<id>` (tích hợp liên kết "Sơ đồ ghế" từ danh sách suất diễn trong `public/organizer-events.html`).
  - Kiểm tra sơ đồ ghế ngay tại trình duyệt phía client bằng `public/seatMapValidator.js` trước khi gửi request tới máy chủ.
  - Xem trước trực quan lưới ghế bằng canvas hoặc single-path SVG, hiển thị màu sắc theo từng hạng ghế cùng chú giải rõ ràng.
  - Vô hiệu hoá nút xác nhận khi tệp có lỗi hoặc khi suất diễn không được phép nạp lại (lỗi 409 hoặc 403).

- **Danh sách mã lỗi mà validator trả về:**
  | Mã lỗi | Ý nghĩa |
  | :--- | :--- |
  | `INVALID_JSON` | Tệp JSON sai cú pháp (chỉ rõ vị trí ký tự, dòng và cột). |
  | `ROOT_NOT_OBJECT` | Dữ liệu gốc không phải đối tượng JSON `{ ... }`. |
  | `SEATS_MISSING` | Thiếu trường `seats` hoặc `seats` không phải là mảng. |
  | `SEATS_EMPTY` | Mảng danh sách ghế `seats` bị rỗng. |
  | `TOO_MANY_SEATS` | Số lượng ghế vượt quá giới hạn tối đa 10.000 ghế. |
  | `TOO_MANY_CATEGORIES` | Số lượng hạng ghế vượt quá giới hạn tối đa 50 hạng. |
  | `SEAT_NOT_OBJECT` | Ghế tại vị trí chỉ định không phải đối tượng JSON. |
  | `FIELD_MISSING` | Ghế thiếu một trong các trường bắt buộc (`row`, `number`, `category`). |
  | `FIELD_TYPE` | Trường có kiểu dữ liệu sai (`row`/`category` phải là chuỗi, `number` phải là số nguyên). |
  | `ROW_BLANK` | Tên hàng `row` bị để trống (chuỗi rỗng sau khi trim). |
  | `ROW_TOO_LONG` | Tên hàng `row` dài quá 32 ký tự. |
  | `CATEGORY_BLANK` | Tên hạng `category` bị để trống (chuỗi rỗng sau khi trim). |
  | `CATEGORY_TOO_LONG` | Tên hạng `category` dài quá 100 ký tự. |
  | `NUMBER_NOT_POSITIVE` | Số ghế `number` không phải số nguyên dương (phải trong khoảng 1 – 2.147.483.647). |
  | `DUPLICATE_SEAT` | Ghế bị trùng hàng và số `(row, number)` với một ghế đã xuất hiện trước đó trong tệp. |
  - *Lưu ý:* Validator thu thập tối đa 200 lỗi trong một lần kiểm tra; nếu vượt quá sẽ bật cờ `truncated = true`.

- **Tệp mẫu nằm trong `test/fixtures/seatmaps/`:**
  - `valid-small.json`: Sơ đồ ghế hợp lệ mẫu với 2 hạng ghế (VIP, Thường).
  - `multi-error.json`: Tệp chứa nhiều lỗi vi phạm quy chuẩn để kiểm thử hiển thị bảng lỗi.
  - `invalid-json.json`: Tệp JSON sai cú pháp để kiểm thử lỗi cú pháp.
  - `duplicate.json`: Tệp chứa các ghế trùng nhau về hàng và số ghế.

- Trên Render dùng Docker, container chạy `npm run migrate:latest` trước `npm start`; không seed hay rollback dữ liệu staging. Hãy kiểm tra backup và CI trước khi merge migration. `npm run verify` vẫn chỉ dùng database tạm và rollback database tạm.

---

## Trang công khai (T-17, T-18 / S-08)

Hệ thống cung cấp danh mục công khai các suất diễn đang mở bán và trang chi tiết suất diễn dành cho khách vãng lai và người mua vé:

### 1. API Danh Mục Công Khai
- `GET /api/events/showtimes?cursor=&limit=`:
  - Trả về danh sách suất diễn thỏa mãn đồng thời: `showtimes.status = 'on_sale'`, `events.status = 'published'` và `starts_at > now()`.
  - Sắp xếp tăng dần theo `(starts_at ASC, id ASC)`.
  - Phân trang theo con trỏ (keyset pagination) qua biểu thức so sánh bộ tuple `(starts_at, id) > (:cursorStartsAt, :cursorId)`, không dùng `OFFSET`. `cursor` được mã hóa `base64url` từ chuỗi JSON `{ s: starts_at ISO, i: id }`. Khi con trỏ hỏng hoặc không đúng định dạng, API trả về lỗi `400`.
  - `limit` mặc định là `20`, tối đa `50` (nếu vượt quá 50 sẽ tự động kẹp về 50).
  - Định dạng dữ liệu trả về: `{ success: true, data: { items, nextCursor }, items, nextCursor }`. Mỗi phần tử chỉ gồm các trường công khai: `showtimeId`, `eventId`, `title`, `description`, `venue`, `roomName`, `startsAt` (ISO UTC), `minPrice: null`, `maxPrice: null` (tạm thời để `null` cho tới Sprint 3 / T-34). Tuyệt đối không để lộ `owner_id`, `status` nội bộ hay metadata quản trị.
  - Bộ nhớ đệm Redis: Cache kết quả 30 giây theo khóa `catalog:onsale:v1:<cursor|first>:<limit>`. Nếu Redis gặp sự cố, hệ thống tự động bỏ qua cache và truy vấn trực tiếp cơ sở dữ liệu để trả kết quả `200` (không làm gián đoạn dịch vụ với lỗi `500`).
- `GET /api/events/showtimes/:id`:
  - Trả về thông tin chi tiết của một suất diễn cùng số lượng ghế (`seatCount`) và cờ `onSale` (`true` hoặc `false`).
  - Trả về `404` nếu suất diễn không tồn tại hoặc sự kiện cha chưa `published`.
  - Suất diễn có trạng thái `draft` hoặc `closed` thuộc sự kiện đã `published` vẫn trả về `200` kèm `onSale: false` để giao diện hiển thị thông báo phù hợp.

### 2. Giao Diện Công Khai Phía Client
- **Trang chủ (`public/home.html` + `public/home.js`):**
  - Hiển thị danh sách các suất diễn đang mở bán vé gọi từ `GET /api/events/showtimes`.
  - Mỗi thẻ hiển thị: tên sự kiện, thời gian biểu diễn theo múi giờ Việt Nam (`vi-VN`, `Asia/Ho_Chi_Minh`), địa điểm, phòng, thông tin khoảng giá ("Giá sẽ cập nhật") và liên kết tới trang chi tiết `/showtime.html?id=<showtimeId>`.
  - Hỗ trợ cuộn vô tận tự động tải trang kế tiếp bằng `IntersectionObserver` kèm con trỏ `nextCursor`, cùng nút "Tải thêm" dự phòng.
  - Toàn bộ nội dung dữ liệu người dùng được dựng an toàn qua thuộc tính `textContent`, ngăn ngừa tuyệt đối nguy cơ tấn công XSS.
- **Trang chi tiết suất diễn (`public/showtime.html` + `public/showtime.js`):**
  - Không yêu cầu đăng nhập khi truy cập.
  - Hiển thị đầy đủ tên sự kiện, mô tả, thời gian biểu diễn, địa điểm, phòng, khoảng giá và nút "Chọn ghế".
  - Khi `onSale: false`, hiển thị thông báo "Suất diễn này hiện không mở bán" và ẩn nút "Chọn ghế".
  - Khi người dùng bấm "Chọn ghế": hệ thống điều hướng tới `/seat-map.html?showtime=<id>`. Nếu người dùng chưa đăng nhập (`GET /api/auth/session` trả về `401`), hệ thống tự động chuyển hướng đến `/login.html?next=<encodeURIComponent('/seat-map.html?showtime=<id>')>`.
  - Tích hợp các thẻ meta mạng xã hội OpenGraph (`og:title`, `og:description`, `og:type`, `og:url` và `meta description`) trong `<head>`, tự động cập nhật linh hoạt sau khi tải xong thông tin suất diễn.
  - Tối ưu trải nghiệm: người dùng từ trang chủ tới trang chọn ghế chỉ qua tối đa 2 lần bấm.


