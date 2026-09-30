# S-06 — T-13 và T-14 (Sprint 2)

Nguồn yêu cầu: workbook `Bán vé sự kiện có sơ đồ ghế.xlsx`, sheet `Tasks` (T-13, T-14) và `Backlog` (S-06).

## S-06: Tệp sơ đồ sai bị từ chối toàn bộ và chỉ rõ chỗ sai
- Tệp thiếu trường bắt buộc ở một ghế: từ chối toàn bộ tệp, chỉ rõ ghế nào thiếu trường nào.
- Tệp có hai ghế trùng hàng và số: từ chối, chỉ ra cặp trùng.
- Tệp có nhiều lỗi: thấy đủ danh sách lỗi trong một lần.
- Tệp không phải JSON hợp lệ: báo lỗi định dạng kèm vị trí ký tự, không trả 500.
- Tệp hợp lệ: xem trước lưới ghế đúng số hàng, số ghế, màu theo hạng trước khi bấm xác nhận nạp.
- NFR: kiểm tra chạy TRƯỚC giao dịch ghi; giới hạn tệp 5 MB.

## T-13 — Trình kiểm tra sơ đồ ghế thuần (public/seatMapValidator.js)
- Hàm thuần `validateSeatMapText(text)` -> `{ valid, errors, seats, summary, truncated }`, không đụng cơ sở dữ liệu.
- Dạng UMD dùng chung trên cả trình duyệt và Node.js.
- Không dừng ở lỗi đầu tiên, giới hạn tối đa 200 lỗi (có cờ `truncated=true` nếu vượt).
- Danh sách mã lỗi kiểm tra:
  - `INVALID_JSON`: JSON sai cú pháp, trích xuất vị trí, tự tính dòng và cột.
  - `ROOT_NOT_OBJECT`: Dữ liệu gốc không phải đối tượng JSON.
  - `SEATS_MISSING`: Thiếu mảng seats hoặc không phải mảng.
  - `SEATS_EMPTY`: Mảng seats rỗng.
  - `TOO_MANY_SEATS`: Quá 10.000 ghế.
  - `SEAT_NOT_OBJECT`: Ghế không phải đối tượng.
  - `FIELD_MISSING`: Thiếu `row`, `number` hoặc `category`.
  - `FIELD_TYPE`: Sai kiểu dữ liệu (`row`/`category` không phải chuỗi; `number` không phải số nguyên).
  - `ROW_BLANK` / `CATEGORY_BLANK`: Chuỗi rỗng sau khi trim.
  - `ROW_TOO_LONG`: Tên hàng dài quá 32 ký tự.
  - `CATEGORY_TOO_LONG`: Tên hạng dài quá 100 ký tự.
  - `NUMBER_NOT_POSITIVE`: Số ghế <= 0 hoặc > 2147483647.
  - `DUPLICATE_SEAT`: Trùng cặp (row sau trim, number), chỉ rõ số ghế trùng trước đó.
- Hiệu năng: 2.000 ghế hợp lệ chạy dưới 100ms.

## T-14 — Giao diện tải lên và xem trước sơ đồ ghế (public/seat-map-upload.html, public/seat-map-upload.js, public/seatGridPreview.js)
- Mở bằng URL `?showtimeId=<id>`, dùng lại bố cục form của T-10 và `public/api.js`.
- Chọn tệp: kiểm tra dung lượng tối đa 5 MB, đọc bằng `FileReader`, gọi kiểm tra ngay tại trình duyệt, không gửi request nào tới máy chủ khi kiểm tra.
- Khi có lỗi: hiển thị bảng danh sách lỗi chi tiết (STT, số ghế, trường, dòng/cột, nội dung); nút "Xác nhận nạp" bị vô hiệu hoá.
- Khi hợp lệ: hiển thị tổng số ghế, số hạng ghế, số hàng; vẽ lưới ghế bằng canvas hoặc single-path SVG (không tạo 2.000 nút DOM), màu theo hạng ghế, có chú giải màu sắc đầy đủ; nút "Xác nhận nạp" được bật.
- Bấm "Xác nhận nạp": gửi `multipart/form-data` tới `POST /api/organizer/showtimes/:id/seats/import`. Chống bấm hai lần liên tiếp. Hiển thị thông báo thành công hoặc lỗi từ máy chủ (403, 409, 400).
- Suất diễn của người khác: báo lỗi không có quyền.
- Tích hợp điều hướng: mỗi dòng suất diễn trong `public/organizer-events.js` có liên kết "Sơ đồ ghế" trỏ tới trang tải sơ đồ.
