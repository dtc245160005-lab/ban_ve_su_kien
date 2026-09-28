# AC Sprint 1

Nguồn: file kế hoạch dự án (sheet Backlog và Tasks). Không sửa nội dung nếu Product Owner chưa đồng ý.

## S-01 Khung ứng dụng chạy được trên staging
- Giả sử máy chủ staging đã sẵn sàng, Khi merge vào nhánh chính, Thì pipeline build, chạy test và triển khai tự động, và trang chủ trả về HTTP 200.
- Giả sử một bài test thất bại, Khi pipeline chạy, Thì dừng lại và không triển khai.
- Giả sử thành viên mới lấy mã nguồn về, Khi chạy lệnh khởi động đã ghi trong README, Thì ứng dụng, PostgreSQL và Redis chạy được trên máy cá nhân.
- Giả sử lần triển khai mới thất bại giữa chừng, Khi kiểm tra staging, Thì phiên bản cũ vẫn đang chạy.
- NFR: bí mật nạp từ biến môi trường; log không in chuỗi kết nối cơ sở dữ liệu.
### T-01 Dựng khung dự án và kết nối cơ sở dữ liệu
- AC: Chạy docker compose up rồi khởi động ứng dụng thì kết nối được cơ sở dữ liệu, migration chạy sạch cả tiến lẫn lùi.
- NFR: chuỗi kết nối đọc từ biến môi trường, không ghi thẳng trong mã.
### T-02 Pipeline CI chạy build, lint, test
- AC: Push một commit cố ý sai lint thì pipeline đỏ và chặn merge.
- NFR: pipeline chạy xong dưới 5 phút.
### T-03 Triển khai tự động lên staging bằng Docker
- AC: Merge vào nhánh chính thì staging chạy phiên bản mới trong vòng 10 phút, không cần thao tác tay; image lỗi thì container cũ vẫn chạy.
- NFR: triển khai thất bại thì giữ nguyên phiên bản cũ.

## S-02 Đăng nhập và phân quyền theo vai trò
- Giả sử tài khoản có vai trò ban tổ chức, Khi đăng nhập, Thì thấy mục quản lý sự kiện và không thấy mục đối soát kế toán.
- Giả sử tài khoản có vai trò người mua vé, Khi gọi thẳng API tạo sự kiện bằng công cụ dòng lệnh, Thì máy chủ trả về 403 và ghi nhật ký lần thử đó.
- Giả sử nhập sai mật khẩu 5 lần liên tiếp, Khi thử lần thứ 6, Thì khoá đăng nhập 15 phút và thông báo thời gian còn lại.
- Giả sử phiên đăng nhập đã hết hạn, Khi gọi API bất kỳ, Thì trả về 401 và chuyển về trang đăng nhập.
- Giả sử một route mới chưa khai báo quyền, Khi có người gọi tới, Thì bị từ chối — mặc định là đóng.
- NFR: mật khẩu hash bằng argon2id; chống dò mật khẩu theo cả IP và theo tài khoản.
### T-04 Bảng users và roles kèm migration
- AC: Migration chạy tiến và lùi được; users.email có ràng buộc unique; seed sẵn năm vai trò và hai tài khoản demo.
- NFR: cột mật khẩu đủ dài cho hash argon2id.
### T-05 Đăng nhập bằng email và mật khẩu
- Mô tả: bộ đếm số lần sai lưu ở Redis với thời hạn tự hết, không lưu trong bộ nhớ tiến trình.
- AC: Đăng nhập đúng thì vào được trang chính; sai 5 lần thì lần thứ 6 bị khoá 15 phút; khởi động lại ứng dụng thì khoá vẫn còn.
- NFR: thông báo lỗi không tiết lộ email có tồn tại hay không.
### T-06 Chặn truy cập theo vai trò ở tầng middleware
- AC: Gọi API không đúng vai trò bằng curl thì nhận 403, kể cả khi giao diện đã ẩn nút; route chưa khai báo quyền trả về 403.
- NFR: mặc định là từ chối.

## S-03 Người mua tự đăng ký tài khoản bằng email
- Giả sử email chưa có trong hệ thống, Khi gửi form đăng ký hợp lệ, Thì tài khoản được tạo ở trạng thái chờ xác nhận và một email chứa liên kết kích hoạt được gửi đi.
- Giả sử email đã tồn tại, Khi gửi form, Thì thông báo chung "nếu email hợp lệ, bạn sẽ nhận được hướng dẫn" — không tiết lộ email đã có tài khoản.
- Giả sử mật khẩu dưới 8 ký tự, Khi gửi form, Thì bị chặn ở cả trình duyệt lẫn máy chủ.
- Giả sử liên kết kích hoạt đã quá 24 giờ, Khi bấm vào, Thì báo hết hạn và cho gửi lại liên kết mới.
- Giả sử tài khoản chưa kích hoạt, Khi đăng nhập, Thì bị từ chối kèm hướng dẫn kích hoạt.
- NFR: mã kích hoạt sinh ngẫu nhiên đủ dài và chỉ dùng được một lần; giới hạn 5 lần gửi lại mỗi giờ cho một email.
### T-07 API và form đăng ký kèm kiểm tra dữ liệu
- AC: Đăng ký hợp lệ thì có bản ghi mới với vai trò người mua; email trùng hoặc mật khẩu ngắn thì bị chặn với thông báo đúng.
- NFR: thông báo lỗi không phân biệt email đã tồn tại hay chưa.
### T-08 Gửi email xác nhận và kích hoạt tài khoản
- AC: Đăng ký xong thì trong log dev thấy email kèm liên kết; bấm liên kết thì tài khoản chuyển sang đã kích hoạt; bấm lần hai thì báo đã dùng.
- NFR: không log mã kích hoạt ở môi trường staging trở lên.

## S-04 Tạo sự kiện và suất diễn
- Giả sử đã đăng nhập bằng vai trò ban tổ chức, Khi tạo sự kiện với tên, mô tả và địa điểm hợp lệ, Thì sự kiện được lưu ở trạng thái nháp và chưa hiện với người mua.
- Giả sử sự kiện đã tồn tại, Khi thêm một suất diễn có thời điểm bắt đầu trong tương lai, Thì suất diễn được lưu và gắn với sự kiện.
- Giả sử nhập thời điểm bắt đầu ở quá khứ, Khi lưu suất diễn, Thì bị chặn kèm thông báo rõ lý do.
- Giả sử hai suất diễn cùng sự kiện trùng hoàn toàn thời gian, Khi lưu suất thứ hai, Thì cảnh báo nhưng vẫn cho lưu.
- Giả sử tài khoản ban tổ chức khác, Khi mở sự kiện không phải của mình, Thì bị từ chối.
- NFR: thời gian lưu ở UTC, hiển thị theo múi giờ Việt Nam.
### T-09 Bảng events và showtimes kèm migration
- AC: Migration chạy tiến và lùi được; xoá sự kiện thì suất diễn con bị chặn hoặc xoá theo, có chủ đích rõ ràng.
- NFR: cột thời gian dùng kiểu có múi giờ.
### T-10 Màn hình tạo và sửa sự kiện
- AC: Tạo, sửa, xem danh sách sự kiện đều chạy; lỗi nhập liệu hiện ngay tại ô sai; mở sự kiện của người khác bằng đường dẫn thì bị 403.
- NFR: form gửi đi phải chặn bấm hai lần liên tiếp.
