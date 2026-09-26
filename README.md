# 🐺 Ma Sói Online

Web app quản trò ảo cho trò chơi Ma Sói (Werewolf), chơi real-time qua Socket.io.
Thiết kế cho khoảng **12–15 người chơi**, tối đa 20 người. Có thể bắt đầu từ 3 người với cấu hình hợp lệ (ít nhất 1 Sói, số Sói ít hơn số Dân); phòng 3–5 người phù hợp chơi thử, chưa được kiểm chứng cân bằng.

- Sau khi chia vai, tất cả người chơi phải xác nhận đã đọc vai và đang kết nối thì đêm đầu mới bắt đầu. Không có đồng hồ trong lúc đọc vai. Chủ phòng có thể hủy chia vai để về sảnh nếu có người không thể tiếp tục.
- Kết quả bỏ phiếu được công bố trong 5 giây trước lượt tiếp theo và lưu để đọc lại trong ván, bao gồm hòa phiếu, phiếu trắng và Hoàng tử được miễn treo. Nếu Chán đời thắng, kết quả xuất hiện ngay ở màn kết thúc.
- Tiên tri có lịch sử soi riêng theo đêm, giữ nguyên kết quả tại thời điểm soi và khôi phục khi kết nối lại. Lịch sử xóa khi về sảnh hoặc bắt đầu ván mới.
- Khi mất kết nối, danh sách đánh dấu người offline và tạm khóa thao tác của người đó cho đến khi kết nối lại; offline không được tính là đồng ý bỏ qua ngày.

## Cách chơi

- **Chat trực tiếp trong phòng**: chat chung mở ở sảnh, khi thảo luận/bỏ phiếu ban ngày và sau khi kết thúc. Người đã chết chỉ được đọc trong lúc ván đang diễn ra.
- **Chat riêng bầy Sói**: chỉ Sói còn sống được xem, gửi vào ban đêm (bao gồm Sói trắng). Kẻ bị nguyền sau khi hóa Sói chỉ nhận tin riêng từ thời điểm gia nhập bầy. Tin riêng không gửi đến client phe khác, kể cả chủ phòng.
- Mỗi kênh giữ tối đa 100 tin, mỗi tin tối đa 500 ký tự; lịch sử xóa khi bắt đầu/chơi lại. Khi mất mạng, cùng tab tự kết nối lại bằng mã phiên riêng và lấy lại lịch sử được phép đọc. Không chia sẻ dữ liệu phiên cho người khác.
- Có thể dùng voice call ngoài web nếu muốn nói chuyện bằng giọng nói.
- Web app đóng vai trò **quản trò ảo**: tự động chia vai trò riêng tư cho từng người, dẫn dắt các lượt đêm (Sói cắn, Tiên tri soi, Phù thủy cứu/độc, Bảo vệ, Sói trắng, Cupid...), đếm ngược tự động chuyển pha, tổng hợp bỏ phiếu ban ngày, và báo thắng thua cuối game.
- Mỗi người chơi tự mở link trên điện thoại/máy tính riêng của mình.
- Khi có người chết, thông báo chỉ hiện tên, không công khai vai. Bảng tổng kết cuối ván vẫn hiển thị toàn bộ vai; các thông tin đã biết trước đó (đồng đội Sói, Hoàng tử đã lộ diện) không thể thu hồi.
- Trong thời gian thảo luận, mỗi người còn sống có nút **Bỏ qua ngày → Đêm tiếp theo**. Khi tất cả người còn sống đồng ý (bao gồm người tạm mất kết nối), ván chuyển thẳng sang đêm và không treo cổ ai. Nếu chưa đủ đồng ý, hết giờ vẫn chuyển sang bỏ phiếu như thường lệ.

## Bộ vai trò hỗ trợ

Game hỗ trợ **16 vai** theo bộ phổ biến mở rộng, với luật riêng ghi trực tiếp trên thẻ. Khi nhận bài, người chơi thấy **phe, năng lực, cách chơi và điều kiện thắng** bằng tiếng Việt; có thể đọc lại bằng nút **Xem vai trò của tôi**. Chủ phòng bấm tên vai trong cấu hình để đọc năng lực trước khi chọn số lượng. Các vai mở rộng mặc định có số lượng 0.

| Vai mở rộng | Luật trong game |
|---|---|
| Người hóa sói | Thuộc Làng nhưng Tiên tri soi ra Sói |
| Kẻ bị nguyền | Bị cắn mà không được cứu/bảo vệ sẽ sống và đổi thành Sói thường; thẻ vai tự cập nhật |
| Già làng | Chịu được một lần cắn; độc, treo cổ và súng vẫn giết ngay; không tước năng lực làng khi chết |
| Người cứng cỏi | Sau khi bị cắn, sống qua một ngày và chết vào sáng hôm sau |
| Hoàng tử | Miễn lần treo cổ đầu tiên, đồng thời công khai danh tính |
| Chán đời | Thắng riêng ngay khi bị bỏ phiếu treo cổ |
| Hội Tam điểm | Biết các thành viên khác cùng hội; cho phép nhiều người có vai này |

Sói trắng tham gia săn cùng bầy, có thêm một lần giết Sói khác và chỉ thắng khi sống sót cuối cùng. Phe Sói thường cần loại Sói trắng trước khi thắng theo số lượng. Sói con chết vì bất kỳ nguyên nhân nào sẽ kích hoạt **hai lượt chọn nạn nhân khác nhau** vào đêm tiếp theo. Phù thủy chọn một loại thuốc mỗi lượt; thuốc cứu chỉ cứu nạn nhân lần cắn đầu tiên. Cặp tình nhân thắng riêng nếu là hai người sống cuối cùng.

Chạy `npm test` để kiểm tra năng lực, chia bài riêng tư và chơi lại, bao gồm kết nối 16 người chơi tới server thật.

| Vai trò | Phe | Mô tả ngắn |
|---|---|---|
| Dân làng | Làng | Không có năng lực |
| Sói thường | Sói | Cùng đồng bọn chọn 1 người để cắn mỗi đêm |
| Sói con | Sói | Nếu chết, đêm sau bầy Sói được cắn 2 người |
| Sói trắng | Độc lập | Săn cùng bầy; 1 lần trong game được giết 1 Sói đồng bọn; thắng riêng nếu là người sống sót cuối cùng |
| Tiên tri | Làng | Mỗi đêm soi 1 người để biết có phải Sói không |
| Bảo vệ | Làng | Mỗi đêm bảo vệ 1 người khỏi bị Sói cắn (không được trùng người 2 đêm liên tiếp) |
| Phù thủy | Làng | 1 bình thuốc giải (cứu nạn nhân bị cắn) + 1 bình thuốc độc (giết ai đó), mỗi loại dùng 1 lần |
| Thợ săn | Làng | Khi chết, được bắn hạ ngay 1 người khác |
| Cupid | Làng | Đêm đầu tiên chọn 2 người làm cặp đôi; 1 người chết thì người kia cũng chết theo |

Chủ phòng có thể **tùy chỉnh số lượng từng vai trò** trong sảnh chờ trước khi bắt đầu (web tự đề xuất số lượng hợp lý theo số người chơi).

## Chạy thử ở máy local

Yêu cầu: [Node.js](https://nodejs.org/) >= 16.

```bash
npm install
npm start
```

Mở trình duyệt tại `http://localhost:3000`. Để test với nhiều người chơi trên cùng máy, mở nhiều tab/trình duyệt khác nhau.

Muốn bạn bè trong cùng mạng LAN vào thử: tìm địa chỉ IP nội bộ của máy bạn (`ipconfig` / `ifconfig`), rồi truy cập `http://<IP-của-bạn>:3000`.

## Deploy để mọi người join từ xa

Web này là 1 server Node.js thông thường (Express + Socket.io), có thể deploy lên bất kỳ nền tảng nào hỗ trợ Node.js server chạy liên tục (**cần hỗ trợ WebSocket**, nên KHÔNG dùng các nền tảng chỉ chạy serverless function như Vercel free tier cho phần server này).

### Cách 1: Railway (khuyên dùng, dễ nhất)

1. Đẩy code này lên 1 GitHub repository.
2. Vào [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → chọn repo vừa tạo.
3. Railway tự nhận diện Node.js, tự chạy `npm install` và `npm start`.
4. Sau khi deploy xong, Railway cho bạn 1 domain dạng `xxxx.up.railway.app`. Gửi link này cho mọi người.

### Cách 2: Render

1. Đẩy code lên GitHub.
2. Vào [render.com](https://render.com) → **New** → **Web Service** → kết nối repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Chọn gói Free hoặc trả phí (Free có thể "ngủ" sau vài phút không dùng, lần vào lại sẽ hơi chậm khởi động).

### Cách 3: Fly.io / VPS riêng (DigitalOcean, EC2...)

- Cài Node.js trên server, clone code, `npm install`, rồi chạy bằng [pm2](https://pm2.keymetrics.io/) để giữ server sống:
  ```bash
  npm install -g pm2
  pm2 start server/index.js --name masoi
  ```
- Nên đặt Nginx/Caddy làm reverse proxy phía trước để có HTTPS (bắt buộc nếu muốn dùng domain riêng và để trình duyệt không chặn).

### Biến môi trường

- `PORT`: cổng server lắng nghe (mặc định `3000`). Hầu hết các nền tảng (Railway, Render...) tự set biến này, không cần chỉnh gì thêm.

### Giới hạn thao tác và phòng bỏ trống

- Mỗi kết nối có tối đa 30 thao tác tích lũy, phục hồi 10 thao tác/giây. Thao tác sai hoặc lặp lại không làm đổi trạng thái sẽ không phát lại dữ liệu cả phòng.
- Tạo/vào phòng được giới hạn thêm theo địa chỉ kết nối: tối đa 60 lượt tích lũy, phục hồi 2 lượt/giây. Khi dùng reverse proxy, giới hạn này có thể được dùng chung cho các kết nối qua proxy; cần tính đến điều này khi triển khai cho nhiều nhóm.
- Phòng đang chơi mà không còn ai kết nối được giữ tối đa 5 phút. Có người vào lại trước thời hạn thì hủy lịch xóa. Hết thời hạn, phòng và bộ đếm giờ bị dọn; người chơi cần tạo phòng mới. Sảnh chờ rỗng vẫn được xóa ngay.

## Cấu trúc code

```
masoi-online/
  server/
    index.js    -> Express + Socket.io, xử lý các sự kiện kết nối/phòng
    Game.js      -> Toàn bộ máy trạng thái game: pha đêm/ngày, hành động, thắng thua
    roles.js     -> Định nghĩa vai trò + công thức chia vai trò mặc định
  public/
    index.html   -> Giao diện các màn hình (sảnh, lộ vai, trong game, kết thúc)
    style.css
    app.js       -> Logic client, giao tiếp Socket.io
```

## Giới hạn hiện tại / hướng mở rộng thêm

- Chat chữ đã có trong game; chưa hỗ trợ gọi thoại trực tiếp.
- Vai trò được lưu trong bộ nhớ server (không dùng database) — nếu server restart giữa ván, các phòng đang chơi sẽ mất. Phù hợp cho các buổi chơi ngắn vài giờ.
- Chưa có xác thực người dùng — bất kỳ ai có link + mã phòng đều vào được, phù hợp chơi với bạn bè.
- Vì trạng thái vai trò gửi qua socket riêng cho từng người, một người chơi cố tình mở DevTools vẫn có thể xem được dữ liệu gửi tới đúng socket của họ (nhưng không thấy được vai trò người khác trừ khi cùng phe Sói).
