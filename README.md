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
| `DB_CONNECTION_STRING` | Chuỗi kết nối PostgreSQL | `postgresql://postgres:password@localhost:5432/ban_ve_su_kien` |
| `POSTGRES_USER` | Tên người dùng CSDL | `postgres` |
| `POSTGRES_PASSWORD` | Mật khẩu người dùng CSDL | `secret` |
| `POSTGRES_DB` | Tên cơ sở dữ liệu | `ban_ve_su_kien` |
| `REDIS_URL` | URL kết nối Redis | `redis://localhost:6379` |
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

## 5. Kiểm Thử Task T-04

Dự án cung cấp bộ kiểm thử tự động toàn diện dành riêng cho T-04:
```bash
npm run test:t04
```

Bộ kiểm thử thực hiện xác minh:
1. Kết nối PostgreSQL an toàn.
2. Trạng thái migration trước khi chạy.
3. Chạy migration T-04 và kiểm tra cấu trúc 3 bảng.
4. Chạy seed lần thứ nhất.
5. Chạy seed lần thứ hai (xác nhận tính idempotent).
6. Tồn tại đủ 5 roles bắt buộc và 2 demo users (admin, organizer) được phân quyền chuẩn (hỗ trợ DB có thêm dữ liệu khác).
7. `password_hash` chuẩn Argon2id, không lưu mật khẩu thô và pass hàm `argon2.verify()`.
8. Ràng buộc `UNIQUE` của `email` trong bảng `users` (dùng transaction rollback an toàn).
9. Khóa chính ghép `(user_id, role_id)` trong bảng `user_roles` (dùng transaction rollback an toàn).
10. Kiểm tra an toàn rollback migration: xác minh batch độc lập trong `knex_migrations` trước khi rollback, chỉ xóa 3 bảng T-04 và bảo toàn bảng `events`, sau đó migrate lại.
11. Chạy seed và kiểm tra lại lần cuối sau khi migrate lại.

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
