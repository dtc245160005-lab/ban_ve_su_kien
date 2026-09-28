## Task / Story
<!-- Ghi rõ mã Task / User Story (ví dụ: T-06, S-02...) và mô tả tóm tắt nội dung thay đổi -->
- **Mã Task/Story:** 
- **Mô tả:** 

---

## Tiêu Chí Nghiệp Vụ (Acceptance Criteria - AC)
<!-- Đánh dấu [x] vào các AC đã hoàn thành đối chiếu với docs/ac/ -->
- [ ] AC1: 
- [ ] AC2: 
- [ ] AC3: 

---

## Kết Quả Kiểm Tra Mã Nguồn (Verification Gate)
<!-- Chạy `npm run verify` trên môi trường local và dán kết quả 15-20 dòng cuối -->
- **Lệnh thực thi:** `npm run verify`
- **Kết quả:** `VERIFY: PASS`

```text
<!-- Dán 15-20 dòng cuối output của npm run verify tại đây -->
```

---

## Ảnh Chụp / Minh Chứng (Screenshots / Evidence)
<!-- Nếu có thay đổi giao diện web hoặc kết quả test trực quan, đính kèm ảnh chụp tại đây -->
- [ ] Không có thay đổi giao diện người dùng
- [ ] Đã đính kèm ảnh chụp màn hình giao diện bên dưới:

---

## Checklist Tiêu Chí Hoàn Thành (Definition of Done - DoD)
- [ ] **Nhắm đúng nhánh:** PR nhắm vào nhánh `develop-v2` (tuyệt đối không nhắm vào `main`).
- [ ] **Cấu trúc thư mục:** Không đặt file test/script ở thư mục gốc (test nằm trong `test/`, script nằm trong `scripts/`).
- [ ] **Bảo mật & Logging:** Không in/log thông tin nhạy cảm của người dùng (email, mật khẩu, token, session, tài khoản ngân hàng...).
- [ ] **Quản lý bí mật:** Không hardcode secrets, chỉ lấy từ biến môi trường (`process.env`).
- [ ] **Kiểm thử tự động:** Có đầy đủ test cho logic mới / endpoint mới trong `test/` (có test đồng thời nếu liên quan ghế/tiền).
- [ ] **Tài liệu:** Đã cập nhật `README.md` và `.env.example` nếu có biến môi trường mới hoặc thay đổi cách chạy dự án.
- [ ] **Review:** Sẵn sàng để maintainer / reviewer phê duyệt.
