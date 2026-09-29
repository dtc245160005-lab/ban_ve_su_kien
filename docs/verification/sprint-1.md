# Nghiệm thu Sprint 1

Tài liệu này bổ sung bằng chứng; không thay đổi AC gốc trong `docs/ac/sprint-1.md`.

## T-01 / onboarding

Trên database mới: tạo `.env`, `npm ci`, khởi động DB/Redis, `npm run doctor`,
`npm run setup`, `npm run build`, `npm run verify`, `npm start`. `doctor` phải
báo migration đang chờ khi DB mới; `setup` chạy migration/seed và dừng ngay nếu
schema thuộc nhánh khác. Sau setup `/health` phải trả 200, đăng nhập được bằng
tài khoản demo lấy từ biến môi trường. Docker Compose tự chạy setup trước API.
Không rollback hoặc xóa database thật khi nghiệm thu.

## T-02 / CI

- Build, lint, verify và audit là bốn job; lint và verify không phụ thuộc nhau.
- Build kiểm tra syntax tất cả file JS và build Docker image.
- `ci` là check tổng bắt buộc: một job đỏ/hủy/bỏ qua thì `ci` đỏ.
- Workflow chạy mỗi push và PR tới `develop-v2`.
- Maintainer cấu hình ruleset/protection cho `develop-v2`: check `ci`, một review
  APPROVED, dismiss stale approvals, không bypass đối với merge thông thường.
- Để chứng minh AC lint: dùng nhánh thử riêng chứa lỗi `no-undef`, quan sát job
  lint và check `ci` đỏ, xác nhận GitHub không cho merge. Không đưa commit lỗi
  vào `develop-v2`. Một script lint đỏ cục bộ chưa chứng minh GitHub chặn merge.
- Ghi URL run, SHA, thời gian từ bắt đầu tới hoàn tất; yêu cầu dưới 5 phút.
  Timeout của job không phải bằng chứng thời gian của cả pipeline.

## T-03 / Render staging

Service được người dùng chỉ định: `srv-dat5pkm0tbcc73a0hdt0`.
Trang Settings cần phiên đăng nhập Render; không suy đoán cấu hình từ service ID.

Thông tin do người dùng cung cấp ngày 2026-09-29: URL
`https://ban-ve-su-kien.onrender.com`, Branch `develop-v2`, Auto Deploy **On Commit**,
Health Check Path **chưa đặt**. Branch đúng; hai mục còn lại chưa đáp ứng cấu hình
nghiệm thu. Chưa có quyền đăng nhập để trực tiếp thay đổi Settings.

Cấu hình cần kiểm tra trên service hiện có:

- Repository đúng dự án; Branch `develop-v2`; runtime Docker.
- Auto Deploy **After CI Checks Pass**. Không dùng On Commit cho AC chặn deploy
  khi test thất bại. Render có thể xem check skipped/neutral là đạt, nên check
  tổng `ci` phải chuyển các trường hợp đó thành thất bại.
- Health Check Path `/health`; pre-deploy `npm run migrate:latest`.
- `NODE_ENV=staging`, `MAIL_TRANSPORT=smtp`; DB, Redis, SMTP lấy từ biến môi trường.
  Không ghi secret vào báo cáo. Không seed lại mật khẩu demo mỗi lần deploy.

Quy trình nghiệm thu:

1. Ghi SHA đang chạy và URL công khai; xác nhận health/page 200 trước thay đổi.
2. Merge PR đã được review và CI xanh vào `develop-v2`; ghi giờ merge/deploy live.
3. Trong tối đa 10 phút, chạy:
   `STAGING_URL=<url> STAGING_EXPECTED_REVISION=<sha> npm run staging:check`.
   Trên PowerShell đặt hai biến qua `$env:STAGING_URL` và
   `$env:STAGING_EXPECTED_REVISION`, rồi chạy lệnh npm. Lưu output và deploy ID.
4. Test CI đỏ: chỉ dùng nhánh/service thử biệt lập, chứng minh không deploy.
5. Test image lỗi: dùng service staging thử riêng cùng cấu hình; deploy candidate
   cố ý không qua health. Quan sát revision cũ vẫn trả 200 và candidate failed.
   Không cố ý phá service đang được team sử dụng. Cần quyền Render và một service
   thử để làm bước này; có thể phát sinh phí nên phải xác nhận trước khi tạo.

Nguồn chính thức: [Render deploys](https://render.com/docs/deploys),
[health checks](https://render.com/docs/health-checks).
Health probe chỉ chứng minh phiên bản đang chạy khỏe. Nó không tự chứng minh
đã deploy dưới 10 phút, CI chặn deploy hay image lỗi giữ được bản cũ.

## Review và các bằng chứng bên ngoài

Người thực hiện thay đổi không tự tạo approval của reviewer. PR merged và CI
xanh chưa thay thế review APPROVED. Cần một thành viên khác review diff/test/AC
trên PR nhắm `develop-v2`. Không tự merge hoặc sửa protection để bỏ qua review.

## Bằng chứng thực tế ngày 2026-09-29

- Live probe lúc `2026-09-29T09:45:46.635Z`: `/health` ba lần 200/status ok,
  trang chủ (theo redirect), login/register 200. Ba thời gian health:
  13587.977 / 255.888 / 259.470 ms. Bản hiện tại không trả revision;
  `expectedRevisionVerified=false`. Chỉ chứng minh dịch vụ đang khỏe, chưa
  xác minh đúng commit hay thời gian auto deploy.
- K-01 đã có số đo năm lượt/phương án và quyết định tại
  `docs/decisions/k01-seat-holds.md`; chờ team/mentor review.
- Docker image `ban-ve-sprint1-check:20260929` build thành công local, bao gồm
  dependency native argon2. Không đồng nghĩa đã deploy hoặc CI remote xanh.
- Smoke test image Node 20 trên database mới: setup thành công, health/page
  200 và đăng nhập được cả hai tài khoản demo. Đã dọn container API, network
  và database thử, không đụng các container/database dự án.
- `npm run verify`: 130/130 test pass, tổng thời gian local 17523 ms, migration
  tiến/lùi/tiến và seed sạch. `npm run build`: 56 file JS pass;
  `npm audit --audit-level=high`: 0 lỗ hổng. Không suy ra thời gian GitHub
  pipeline mới từ thời gian verification local.
- Settings Render mới được người dùng cung cấp, chưa được sửa/xác minh qua
  tài khoản đăng nhập. Candidate lỗi, CI chặn merge/deploy, thời gian pipeline
  mới và approval cho bộ thay đổi này vẫn chờ nghiệm thu bên ngoài.
