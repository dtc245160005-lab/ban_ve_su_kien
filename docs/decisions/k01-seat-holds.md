# K-01 — Chọn cơ chế giữ ghế có thời hạn

Ngày: 2026-09-29. Trạng thái: đã chạy spike và ghi quyết định kỹ thuật;
chờ team/người hướng dẫn review. Không khẳng định đã có buổi spike ngồi cùng
mentor hoặc được phê duyệt. Không triển khai mã sản phẩm của S-10/S-13.

## Quyết định

Chọn bảng PostgreSQL `seat_holds` làm nguồn dữ liệu chuẩn cho giữ chỗ, cùng job
dọn các bản ghi hết hạn. Redis tiếp tục dùng cho session/rate limit/cache, không
dùng khoá Redis đơn lẻ làm nguồn dữ liệu chuẩn cho ghế.

Đo thực tế ở [k01-results.json](k01-results.json), bằng
`scripts/spike-seat-holds.js`; test đồng thời ở `test/k01-concurrency.test.js`.
Môi trường Windows, Node 24.21.0, PostgreSQL 15.19 và Redis 7.4.11 chạy local.
Đây không phải số đo staging hay kết quả CI Node 20. Pipeline sẽ đo lại và lưu
artifact `k01-results` mỗi lần chạy.

## Phương pháp và số đo

Hai phương án được warm-up, đổi thứ tự chạy xen kẽ, năm lượt mỗi phương án.
Mỗi lượt gửi ngay 200 promise vào **cùng một ghế** với lease 600000 ms.
Redis: `SET key owner NX PX 600000`. PostgreSQL: khoá chính ghép
`(showtime_id, seat_id)` và `INSERT ... ON CONFLICT DO UPDATE ... WHERE expired`.
Client PostgreSQL dùng pool 20; độ trễ tính cả thời gian chờ pool. Không có
HTTP, không có giao diện hay transaction đặt vé/thanh toán trong phép đo.

| Lượt | Redis thắng/từ chối/lỗi | Redis p95 (ms) | PostgreSQL thắng/từ chối/lỗi | PostgreSQL p95 (ms) |
| --- | --- | ---: | --- | ---: |
| 1 | 1 / 199 / 0 | 3.933 | 1 / 199 / 0 | 246.900 |
| 2 | 1 / 199 / 0 | 2.744 | 1 / 199 / 0 | 223.819 |
| 3 | 1 / 199 / 0 | 3.455 | 1 / 199 / 0 | 224.782 |
| 4 | 1 / 199 / 0 | 2.480 | 1 / 199 / 0 | 216.385 |
| 5 | 1 / 199 / 0 | 2.270 | 1 / 199 / 0 | 203.542 |

Median của năm p95: Redis **2.744 ms**, PostgreSQL **223.819 ms**; đây không
phải p95 gộp của 1000 request. Cả hai có tổng 5 lần giữ thành công/995 xung đột,
không có double winner hay lỗi. PostgreSQL chậm hơn đáng kể trong phép đo.
Không dùng số này để kết luận API S-10 đạt p95 dưới 300 ms: còn chi phí HTTP,
auth, validation và tải thực tế; phải benchmark endpoint sau khi xây dựng.

## Phục hồi và hết hạn

- Đóng rồi kết nối lại client/app: cả hai vẫn giữ được lease, không cấp lại ghế.
- Redis ép TTL còn 1 ms và đợi hết hạn: cấp lại được. PostgreSQL backdate một
  lease: atomic upsert cấp lại được dù chưa có worker dọn.
- Job PostgreSQL dọn expired chạy hai lần: lần đầu xoá 1, lần sau xoá 0.
- Xoá đúng một key thử Redis mô phỏng mất dữ liệu khoá: owner mới giữ được ghế
  dù lease cũ theo nghiệp vụ chưa hết hạn. Không dùng FLUSHDB, không xoá key
  dự án. Đây là mô phỏng mất key, **không phải** test restart/failover Redis.
- Chưa test restart database/server, crash recovery, replication, failover,
  network partition hoặc durability sau sự cố nguồn điện. Kết nối lại client
  không chứng minh các tính chất đó. Database thử và key thử đã được dọn.

## Vì sao không chọn Redis lock đơn lẻ

Redis thắng về độ trễ, nhưng mất/evict key có thể mở lại ghế khi chủ cũ vẫn nghĩ
mình đang giữ. Cần thêm persistence, fencing và kiểm tra DB lúc đặt vé để xử
lý an toàn; đó là độ phức tạp bổ sung, không được chứng minh bởi `SET NX`.
PostgreSQL cho phép kiểm tra giữ chỗ và ghi nhận đặt vé trong cùng transaction,
giảm nhu cầu phối hợp hai nguồn dữ liệu chuẩn. Đây là lý do kiến trúc chọn PG,
không phải kết luận rằng mọi PostgreSQL deployment đều bền hơn mọi Redis.

## Ràng buộc cho S-10 / S-13 (chưa triển khai)

- Mọi acquire/release/confirm phải kiểm tra owner và deadline, dùng thời gian
  máy chủ; thời hạn đọc từ biến môi trường, không copy hằng số của spike.
- Nhiều ghế cùng lượt chọn dùng chung deadline từ ghế đầu tiên. Cần test đồng
  thời cho multi-seat, hết hạn, confirm/release và giao dịch đặt vé.
- Availability phải bỏ qua hold đã hết hạn; worker dọn không quyết định tính
  đúng đắn. Worker dùng batch nhỏ, có index `expires_at`, chạy lại an toàn.
- Khoá chính/unique hiện tại của spike cho phép một dòng hiện thời/ghế; raw
  INSERT trùng luôn bị chặn kể cả dòng cũ hết hạn. Vì vậy nó **chưa chứng minh**
  toàn bộ AC raw SQL của T-29. Thiết kế sản phẩm cần đối chiếu riêng việc
  xoá/reclaim expired trong transaction và lưu lịch sử ngoài dòng giữ chỗ.
  Không dùng index điều kiện theo `now()` để giả định unique tự hết hạn.
- Khi xác nhận vé, ràng buộc chống double-booking ở DB vẫn bắt buộc; khoá giữ
  chỗ không thay thế unique của vé đã bán. Đo lại p95 ở API hoàn chỉnh.

## Nguồn kỹ thuật

[Redis SET](https://redis.io/docs/latest/commands/set/),
[Redis distributed locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/),
[PostgreSQL INSERT / ON CONFLICT](https://www.postgresql.org/docs/15/sql-insert.html).
[PostgreSQL index predicates yêu cầu immutable](https://www.postgresql.org/docs/15/sql-createindex.html).
AC K-01 đối chiếu workbook kế hoạch, sheet Backlog, dòng K-01.
