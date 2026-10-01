# Task T-07: API và Form đăng ký kèm kiểm tra dữ liệu

## Mục tiêu

Triển khai API đăng ký và form đăng ký theo yêu cầu chức năng:

- email, password, fullName
- validate email hợp lệ
- password tối thiểu 8 ký tự
- email trùng lặp trả về lỗi chung
- mặc định role = buyer
- trạng thái tài khoản chưa kích hoạt

## Cấu trúc file

- `server.js`: API backend
- `public/register.html`: giao diện form đăng ký
- `public/styles.css`: style để giữ UI thống nhất với form login
- `package.json`: dependency và script chạy app

## Chạy ứng dụng

```bash
cd task-t07
npm install
npm start
```

Sau đó mở browser tại:

```text
http://localhost:2006
```

Trong môi trường `development`, email xác nhận được in đầy đủ trong terminal và không gửi qua SMTP. Đặt `NODE_ENV=development` trong `.env` để bật chế độ này.

Các môi trường khác gửi email qua SMTP. Cấu hình `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` và `APP_BASE_URL` trong `.env`. Không bật `development` ở staging/production.

Liên kết kích hoạt có hiệu lực 24 giờ và chỉ dùng được một lần:

```text
GET /api/auth/activate?token=<activation-token>
```

Token được lưu dưới dạng SHA-256 trong cơ sở dữ liệu. Kích hoạt thành công đặt `is_active` và `email_verified` thành `true`; đăng nhập bị từ chối trước khi tài khoản được kích hoạt.

## API dùng thử

### POST /api/auth/register

Request body:

```json
{
  "fullName": "Nguyễn Văn A",
  "email": "example@email.com",
  "password": "Password123"
}
```

Response thành công:

```json
{
  "success": true,
  "message": "Đăng ký tài khoản thành công.",
  "user": {
    "id": 2,
    "fullName": "Nguyễn Văn A",
    "email": "example@email.com",
    "role": "buyer",
    "isActive": false,
    "emailVerified": false
  }
}
```

## Lưu ý

- Khi email đã tồn tại, API trả về lỗi chung để không lộ thông tin chi tiết về dữ liệu đã tồn tại.
- Dự án này là phiên bản demo phù hợp để tích hợp vào project thực tế hiện có.
