# Quy Chuẩn Dành Cho Agent & Nhà Phát Triển (AGENTS.md)

Tài liệu này định nghĩa các nguyên tắc bắt buộc dành cho Codex, AI agents và các nhà phát triển khi làm việc trên repository này.

---

## 1. Cấu Trúc Thư Mục Chuẩn

Hệ thống được tổ chức theo cấu trúc đơn giản, tập trung tại thư mục gốc:

- `routes/`: Định nghĩa API endpoints và định tuyến của Express.
- `services/`: Xử lý nghiệp vụ (business logic) và thao tác cơ sở dữ liệu.
- `middleware/`: Các middleware dùng chung (xác thực, phân quyền, validation, error handler...).
- `migrations/`: Quản lý schema database bằng Knex migrations.
- `seeds/`: Dữ liệu mẫu (roles hệ thống, tài khoản demo).
- `public/`: Tài nguyên tĩnh (static files) phục vụ web nếu có.
- `test/`: Toàn bộ các bài kiểm thử tự động (`*.test.js` chạy qua `node --test`).

> **NGUYÊN TẮC BẮT BUỘC:** KHÔNG tạo ứng dụng con, monorepo lồng nhau, hoặc tạo thêm bất kỳ file `package.json` thứ hai nào. Tất cả dependencies và scripts được quản lý duy nhất tại `package.json` ở thư mục gốc.

---

## 2. Quy Ước Migration

- **Tên bảng:** Phải là danh từ số nhiều, định dạng `snake_case` (ví dụ: `events`, `users`, `roles`, `user_roles`, `tickets`).
- **Hàm `down`:** Bắt buộc phải có và chạy được hoàn chỉnh. Xóa bảng theo đúng thứ tự phụ thuộc ngược (bảng con trước, bảng cha sau) để đảm bảo rollback sạch sẽ.
- **Tính bất biến:** Tuyệt đối **KHÔNG sửa** các migration đã merge vào nhánh chính (`develop-v2`, `main`). Mọi thay đổi cấu trúc schema phải tạo migration mới.

---

## 3. Tiêu Chuẩn Kiểm Tra Mã (Verification Gate)

- Mọi thay đổi mã nguồn trước khi tạo commit hoặc mở PR bắt buộc phải chạy và đạt kết quả:
  ```bash
  npm run verify
  ```
  Kết quả đầu ra cuối cùng phải là `VERIFY: PASS`.
- Lệnh verify sẽ tự động:
  1. Tạo database tạm thời trên PostgreSQL.
  2. Chạy `migrate:latest` -> `migrate:rollback --all` -> `migrate:latest` -> `seed:run`.
  3. Chạy `npm run lint` và `npm test` với database tạm.
  4. Tự động dọn dẹp và xóa database tạm.

---

## 4. Bảo Mật & Thông Tin Nhạy Cảm

- **Logging:** Tuyệt đối không log thông tin nhạy cảm của người dùng bao gồm:
  - Email, số điện thoại
  - Mật khẩu, password hash
  - Token xác thực, session secret
  - Thông tin thẻ, tài khoản ngân hàng, thông tin thanh toán
- **Quản lý bí mật:** Tất cả secrets, credentials, API keys chỉ được lấy từ biến môi trường (`process.env`). Tuyệt đối không hardcode bí mật trong mã nguồn.

---

## 5. Kiểm Thử Đồng Thời (Concurrency Testing)

- Mọi User Story hoặc tính năng liên quan trực tiếp đến:
  - **Ghế ngồi** (giữ chỗ, chọn ghế, giải phóng ghế, đặt vé)
  - **Tiền bạc** (thanh toán, hoàn tiền, số dư, giao dịch)
  bắt buộc phải có kịch bản **test đồng thời (concurrency / race condition test)** trong thư mục `test/` để chứng minh không bị trùng lặp đặt chỗ (double booking) hay sai lệch số liệu.

---

## 6. Tóm Tắt Tiêu Chí Hoàn Thành (Definition of Done - DoD)

Một task/PR chỉ được coi là hoàn thành khi đáp ứng đủ các tiêu chí:
1. **Có review:** Được phê duyệt bởi maintainer/reviewer.
2. **CI xanh:** GitHub Actions vượt qua tất cả các bước (`npm ci`, `npm run verify`, `npm audit`).
3. **Có test:** Đầy đủ test cho các nhánh logic mới, hàm mới hoặc endpoint mới trong `test/`.
4. **Tài liệu:** File mẫu `.env.example` và `README.md` được cập nhật đầy đủ ngay khi có biến môi trường mới hoặc thay đổi cách chạy dự án.
