# Hệ Thống Bán Vé Sự Kiện

Dự án backend bán vé sự kiện xây dựng trên Node.js, Express, Knex, PostgreSQL và Redis.

---

## Chạy dự án

Thực hiện lần lượt các lệnh sau để khởi động và kiểm tra hệ thống:

```bash
# 1. Khởi động các dịch vụ PostgreSQL và Redis
docker compose up -d db redis

# 2. Cài đặt các gói phụ thuộc theo package-lock.json
npm ci

# 3. Chạy kiểm tra tự động toàn diện (tạo DB tạm, migrate, rollback, seed, lint, test, dọn dẹp DB)
npm run verify

# 4. Khởi động ứng dụng
npm start
```

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

**Đặc điểm của Seed T-04:**
- Khởi tạo đúng 5 vai trò hệ thống bắt buộc: `buyer`, `organizer`, `checker`, `accountant`, `admin`.
- Tạo 2 tài khoản demo: Admin (gán role `admin`) và Organizer (gán role `organizer`).
- Mật khẩu được hash an toàn bằng thuật toán **Argon2id** (`argon2.argon2id`), không bao giờ lưu mật khẩu thô trong database.
- Không xóa hay làm ảnh hưởng đến các bản ghi người dùng / vai trò khác ngoài dữ liệu demo (hỗ trợ CSDL đã có sẵn dữ liệu trước đó).

---

## 5. Kiểm Thử Hệ Thống (Testing)

Dự án sử dụng test runner chuẩn của Node.js (`node --test`), bao gồm kiểm tra cấu trúc CSDL và các tính năng nghiệp vụ:
```bash
npm test
```

Tất cả các bài kiểm thử tự động được đặt trong thư mục `test/`:
- `test/t04-schema.test.js`: Xác minh schema 3 bảng `roles`, `users`, `user_roles`, ràng buộc `UNIQUE` email, khóa chính ghép, 5 roles seed và xác thực mật khẩu Argon2id của 2 tài khoản demo.
- Các bài kiểm thử khác: `test/authService.test.js`, `test/rbac.test.js`, `test/startup.test.js`, `test/health.test.js`, `test/logger.test.js`, `test/api-client.test.js`, `test/menu.test.js`.

---

## 6. Chức Năng Đăng Nhập & Quản Lý Phiên (T-05 / S-02)

- **Mật khẩu & Chống timing attack:** Xác thực bằng Argon2id (`argon2.argon2id`) kết hợp dummy hash khi email không tồn tại nhằm đồng đều thời gian phản hồi.
- **Bảo mật phản hồi:** Cùng trả về thông báo lỗi `Email hoặc mật khẩu không đúng.` (HTTP 401) khi email không tồn tại hoặc mật khẩu sai, hoặc tài khoản chưa kích hoạt (`is_active = false`).
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
