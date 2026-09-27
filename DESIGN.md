# Trăng Khuyết · Pixel Edition

## Mục tiêu
Một ngôi làng để nhóm bạn bước vào chơi Ma Sói ngay trên trình duyệt. Tranh pixel là điểm nhấn; thông tin lượt, nút hành động và chat phải đọc rõ, không lộ vai bí mật qua hình nhân vật công khai.

## Tham khảo
- [Wolvesville: Web update](https://blog.wolvesville.com/2021/09/22/update-web/): bố cục riêng cho desktop, thẻ nhận vai, thay đổi cảnh ngày/đêm.
- [Wolvesville](https://www.wolvesville.com/en/): tham khảo cách giới thiệu trò chơi và phòng chơi.
- [Town of Salem 2 trên App Store](https://apps.apple.com/us/app/town-of-salem-2-online-game/id6471449885): tham khảo bối cảnh game suy luận với các vai bí mật.

Không sao chép hình ảnh, nhân vật hoặc logo của các game tham khảo. Làng, nhà, cây, lửa trại và nhân vật được vẽ riêng bằng Canvas trong village.js.

### Phiên bản hiện tại
Theo yêu cầu người dùng, khôi phục bản làng pixel đầu tiên: nhân vật toàn thân đơn giản, chân dung tĩnh 160px, không có các hiệu ứng nhận vai và hình Sói chi tiết bổ sung sau đó. Giữ cảnh làng và chuyển động lửa/khói/đom đóm. Các sửa lỗi gameplay, kết nối và bảo mật vẫn được giữ.

## Định hướng
Chọn 2D pixel với các lớp rừng, đồi, nhà và cây tiền cảnh tạo chiều sâu. Không dùng WebGL/3D thực. Chuyển động chỉ ở lửa, khói và đom đóm; dừng chuyển động nếu thiết bị yêu cầu reduced motion. Không tải ảnh hoặc font từ mạng.

Bảng màu: đêm #0b1417, mặt thẻ #132124, rừng #2b3d3d, vàng trăng #e4bc7c, cam lửa #ce6838, chữ #ece8d9. Georgia cho tiêu đề, Segoe UI cho nội dung tiếng Việt, Courier New cho nhãn nhỏ và đồng hồ.

Desktop:
```
Tên làng                 Ma Sói Online                  Pixel Edition
Lời mời vào làng         |  Tạo phòng / Tham gia
Tranh làng pixel        |  Tên, mã phòng, hành động
Thông tin số vai/người  |  Cách chơi ngắn
```
Trong ván: trạng thái lượt → khung cảnh làng → hướng dẫn và mục tiêu → lịch sử thu gọn → người chơi. Chat bên phải desktop, bên dưới trên điện thoại. Thẻ vai nằm riêng để đọc và xác nhận trước khi bắt đầu.

## Kiểm chứng
Script scripts/visual-check.cjs chụp các màn hình và kiểm tra tràn ngang ở 320/390/1366 px, bắt lỗi JavaScript và chạy ván ba người thật. Unit/integration tests kiểm tra hành động có xác nhận, reconnect, quyền chủ phòng, chat và dữ liệu riêng.
