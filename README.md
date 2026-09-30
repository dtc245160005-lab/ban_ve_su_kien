# Hệ Thống Bán Vé Sự Kiện - Task T-04: Users, Roles và Seed

Tài liệu hướng dẫn cấu hình môi trường, cài đặt, chạy migration, seed dữ liệu và kiểm thử cho module Users, Roles và Seed (Task T-04).

---

## 1. Yêu Cầu & Biến Môi Trường

Hệ thống sử dụng các biến môi trường để cấu hình kết nối cơ sở dữ liệu PostgreSQL và tài khoản demo ban đầu.

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
