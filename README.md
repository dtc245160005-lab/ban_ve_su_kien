# Hệ Thống Bán Vé Sự Kiện

Dự án backend bán vé sự kiện xây dựng trên Node.js, Express, Knex, PostgreSQL và Redis.

---

## Chạy dự án

Yêu cầu Node.js 20.19+ (hoặc 22.13+/24+), PostgreSQL 15+ và Redis 7+. Tạo `.env` từ `.env.example`
và điền cấu hình trước khi chạy. Với Docker Desktop đang chạy:

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

Nếu PostgreSQL/Redis đã được cài trực tiếp và đang chạy, bỏ qua bước Docker,
đặt `DB_CONNECTION_STRING` và `REDIS_URL` theo các dịch vụ đó. Database ứng dụng
phải được tạo trước; `setup` không tạo hay xóa database.

Chạy toàn bộ stack bằng Docker: tạo `.env`, cấu hình cổng không trùng với dịch vụ
đang chạy rồi dùng `docker compose up --build`. Container API tự chạy `setup`
trước khi mở server. Đây là cấu hình development; email dùng chế độ dev.

`verify` không khởi tạo database ứng dụng: nó tạo database tạm, migrate/rollback,
seed, lint/test rồi dọn database tạm. Không dùng `verify` thay cho `setup`.
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
| `MAIL_TRANSPORT` | Phương thức gửi email (`dev` hoặc `smtp`) | `dev` |
| `SMTP_HOST` | Địa chỉ máy chủ SMTP (khi dùng `smtp`) | `smtp.example.com` |
| `SMTP_PORT` | Cổng SMTP | `587` |
| `SMTP_USER` | Tên người dùng SMTP | `user@example.com` |
| `SMTP_PASS` | Mật khẩu SMTP | `secret` |
| `SMTP_SECURE` | Cấu hình SSL/TLS cho SMTP (`true`/`false`) | `false` |
| `MAIL_FROM` | Địa chỉ người gửi hiển thị | `"Ban Ve" <no-reply@example.com>` |

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
- `test/events.test.js`: Kiểm thử API sự kiện, phân quyền truy cập, kiểm tra dữ liệu, lọc sự kiện nháp/công khai và migration gán owner_id cho admin.
- `test/showtimes.test.js`: Kiểm thử API suất diễn, xác thực múi giờ, kiểm tra thời điểm tương lai/quá khứ, cảnh báo trùng giờ và lưu trữ chuẩn UTC.
- `test/eventForm.test.js`: Kiểm thử các hàm thuần validateEventForm, validateShowtimeForm, toIsoVietnam và formatVietnamDateTime.
- `test/register.test.js`: Kiểm thử luồng đăng ký người mua, kiểm tra dữ liệu, chống timing attack, concurrency race condition và bảo mật log.
- `test/activation.test.js`: Kiểm thử kích hoạt tài khoản atomic, token hết hạn (410), đã dùng (409), rate limit gửi lại qua Redis, và đăng nhập với tài khoản chưa kích hoạt (403 ACCOUNT_NOT_ACTIVE).
- `test/t04-schema.test.js`: Xác minh schema 3 bảng `roles`, `users`, `user_roles`, ràng buộc `UNIQUE` email, khóa chính ghép, 5 roles seed và xác thực mật khẩu Argon2id của 2 tài khoản demo.
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
  - Sinh mã kích hoạt ngẫu nhiên 32 bytes (base64url), lưu hash SHA-256 vào bảng `email_activation_tokens` với thời hạn 24 giờ.
  - **Chống lộ thông tin:** Luôn trả về HTTP 202 cùng thông báo chung `"Nếu email hợp lệ, bạn sẽ nhận được hướng dẫn trong hộp thư."` bất kể email mới hay đã tồn tại (đồng thời chạy dummy hash để cân bằng thời gian phản hồi).
  - **Xử lý đồng thời:** Xử lý race condition an toàn qua ràng buộc unique, trả về 202 và không gây lỗi 500 khi có nhiều request đăng ký cùng lúc.
- **Kích hoạt tài khoản (`POST /api/auth/activate`):**
  - Trang `public/activate.html` đọc token từ URL (`#token=...` hoặc `?token=...`), tự động xóa token khỏi thanh địa chỉ và gọi API `POST /api/auth/activate`.
  - Sử dụng một câu lệnh SQL atomic duy nhất (`UPDATE ... RETURNING`) để ngăn chặn tuyệt đối tình trạng kích hoạt trùng lặp.
  - Trả về HTTP 200 khi thành công, HTTP 409 khi token đã dùng, HTTP 410 khi token hết hạn, HTTP 400 khi token không hợp lệ.
- **Gửi lại email kích hoạt (`POST /api/auth/resend-activation`):**
  - Giới hạn tối đa 5 lần gửi lại mỗi giờ cho một email (quản lý qua Redis).
  - Vô hiệu hoá các token cũ còn hạn của người dùng trước khi sinh token mới.
  - Luôn trả về HTTP 202 với thông báo chung.
- **Dịch vụ Email (`services/emailService.js`):**
  - Môi trường dev/test: In nội dung email kèm liên kết kích hoạt ra console dạng khối `[DEV MAIL]`.
  - Môi trường production: Gửi email thực qua giao thức SMTP sử dụng `nodemailer`. Kiểm tra cấu hình bắt buộc khi ứng dụng khởi động.

---

## 9. Quản Lý Sự Kiện & Suất Diễn (T-09, T-10 / S-04)

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

## 10. Sơ đồ ghế (T-11, T-12 / S-05)

- Migration tạo `seat_categories` và `seats` theo từng suất diễn. Một suất diễn không thể có hai ghế cùng hàng và số; hạng ghế phải thuộc chính suất diễn đó. Có index theo `showtime_id`, kiểm tra số ghế dương và migration rollback theo thứ tự bảng con trước.
- `POST /api/organizer/showtimes/:id/seats/import` dành cho admin hoặc chủ sự kiện có vai trò organizer. Gửi `multipart/form-data` với đúng một tệp JSON ở trường `file` (tối đa 5 MB). Phản hồi thành công: `200` và `{ "success": true, "data": { "showtime_id": 1, "seats_count": 2000, "categories_count": 2 } }`.
- Định dạng JSON hiện tại (chưa có giao diện tải lên T-14):

  ```json
  {
    "seats": [
      { "row": "A", "number": 1, "category": "VIP" },
      { "row": "A", "number": 2, "category": "Thường" }
    ]
  }
  ```

- Tên hạng ghế được tạo tự động theo suất diễn. Nạp lại sẽ thay toàn bộ ghế và hạng cũ trong **một giao dịch**; nếu bất kỳ ghế nào lỗi, trạng thái trước đó giữ nguyên (lần nạp đầu sẽ còn 0 ghế). Yêu cầu bị từ chối `409` nếu có vé hoặc giữ chỗ còn hiệu lực. Khi các bảng nghiệp vụ vé/giữ chỗ được tích hợp ở sprint sau, chúng phải có `showtime_id` hoặc FK `seat_id → seats.id` để bộ chặn xác định đúng suất diễn. Nếu bảng cũ chỉ có mã ghế dạng chuỗi không có FK, hệ thống chặn nạp lại khi có bất kỳ giữ chỗ còn hiệu lực để tránh mất dữ liệu; các thao tác đặt chỗ cũng cần đồng bộ trên hàng `showtimes` để tránh race với nạp lại.
- Trên Render dùng Docker, container chạy `npm run migrate:latest` trước `npm start`; không seed hay rollback dữ liệu staging. Hãy kiểm tra backup và CI trước khi merge migration. `npm run verify` vẫn chỉ dùng database tạm và rollback database tạm.


