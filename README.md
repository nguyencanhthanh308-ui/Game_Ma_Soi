# 🐺 Ma Sói Online

Web app quản trò ảo cho trò chơi Ma Sói (Werewolf), chơi real-time qua Socket.io.
Thiết kế cho khoảng **12–15 người chơi**, cho phép bắt đầu từ **1 đến 20 người**. Phòng 1–2 người dùng để thử thao tác; điều kiện thắng vẫn áp dụng nên ván có thể kết thúc rất nhanh. Phòng 3–5 người mặc định có 1 Sói, 1 Tiên tri và các Dân làng còn lại.

## Cách chơi

- **Chat trực tiếp trong phòng**: chat chung mở ở sảnh, khi thảo luận/bỏ phiếu ban ngày và sau khi kết thúc. Người đã chết chỉ được đọc trong lúc ván đang diễn ra.
- **Chat riêng bầy Sói**: chỉ Sói còn sống được xem, gửi vào ban đêm (bao gồm Sói trắng). Kẻ bị nguyền sau khi hóa Sói chỉ nhận tin riêng từ thời điểm gia nhập bầy. Tin riêng không gửi đến client phe khác, kể cả chủ phòng.
- **Chat riêng Âm phủ 👻**: người đã mất có kênh chat riêng để trò chuyện với nhau bất cứ lúc nào (kể cả ban ngày), người còn sống không đọc được.
- Mỗi kênh giữ tối đa 100 tin, mỗi tin tối đa 500 ký tự; lịch sử xóa khi bắt đầu/chơi lại. Khi mất mạng, cùng tab tự kết nối lại bằng mã phiên riêng và lấy lại lịch sử được phép đọc. Không chia sẻ dữ liệu phiên cho người khác.
- **Voice chat (giọng nói) 🎙️**: bấm "Bật mic" để nói chuyện trực tiếp bằng WebRTC (kết nối trực tiếp giữa các trình duyệt, không qua server lưu trữ âm thanh). Tự động chia 3 kênh theo trạng thái game — 🏘️ Làng (ban ngày, ai còn sống), 🐺 Bầy Sói (riêng tư ban đêm), 👻 Âm phủ (người đã mất) — giống hệt logic chat chữ ở trên. Có chấm sáng báo hiệu ai đang nói.
- **Giọng dẫn chuyện 🔊**: tự động đọc to các mốc quan trọng ("Bầy Sói hãy dậy", "Tiên tri hãy dậy"...) bằng giọng đọc có sẵn của trình duyệt, có thể tắt bằng nút riêng.
- **Nhạc nền 🎵**: đã kèm hai đoạn nhạc tự tổng hợp, đổi theo ngày/đêm; mỗi người tự bật/tắt, mặc định tắt.
- **Gửi voice trong chat**: bấm “Ghi voice”, cho phép micro, rồi “Dừng và gửi voice”; tự dừng sau 20 giây, có nút hủy. Người nhận bấm “Nghe voice”. Ghi âm cần HTTPS (hoặc localhost). Voice tuân thủ quyền chat chung / Sói / Âm phủ; mất kết nối hoặc đổi lượt/kênh sẽ hủy bản ghi đang thu. Voice lưu trong bộ nhớ cùng lịch sử chat và bị xóa khi chơi lại.
- **Bộ vai trong sảnh**: mọi người thấy số lượng từng vai mà chủ phòng đang chọn, cập nhật khi chỉnh; không hiện ai sẽ nhận vai nào.
- Web app đóng vai trò **quản trò ảo**: tự động chia vai trò riêng tư cho từng người, dẫn dắt các lượt đêm (Sói cắn, Tiên tri soi, Phù thủy cứu/độc, Bảo vệ, Sói trắng, Cupid...), đếm ngược tự động chuyển pha, tổng hợp bỏ phiếu ban ngày, và báo thắng thua cuối game.
- Mỗi người chơi tự mở link trên điện thoại/máy tính riêng của mình.
- Tiên tri chọn mục tiêu rồi bấm **Soi người đã chọn**. Kết quả được lưu riêng trong **Kết quả soi của bạn**, hiện cả sau khi kết nối lại và ở màn hình kết thúc; ván mới sẽ xóa lịch sử cũ.
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

Sói trắng tham gia săn cùng bầy, có thêm một lần giết Sói khác và chỉ thắng khi sống sót cuối cùng. Phe Sói thường cần loại Sói trắng trước khi thắng theo số lượng. Sói con chết vì bất kỳ nguyên nhân nào sẽ kích hoạt **hai lượt chọn nạn nhân khác nhau** vào đêm tiếp theo. Phù thủy quyết định cứu trước rồi chọn dùng độc hoặc bỏ qua, có thể dùng cả hai trong một đêm; mỗi bình chỉ dùng một lần trong ván. Chỉ khi còn bình cứu mới thấy nạn nhân bị cắn trong đêm hiện tại; không hồi sinh người chết hôm trước. Thuốc cứu chỉ cứu nạn nhân lần cắn đầu tiên. Cặp tình nhân thắng riêng nếu là hai người sống cuối cùng.

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

## Cấu trúc code

```
masoi-online/
  server/
    index.js    -> Express + Socket.io, xử lý các sự kiện kết nối/phòng/voice signaling
    Game.js      -> Toàn bộ máy trạng thái game: pha đêm/ngày, hành động, thắng thua
    roles.js     -> Định nghĩa vai trò + công thức chia vai trò mặc định
    Chat.js      -> Logic chat 3 kênh (chung / bầy Sói / Âm phủ), quyền đọc-gửi theo pha & tổ đội
    voice.js     -> Tính kênh voice chat (village/wolves/dead) cho từng người theo trạng thái game
  public/
    index.html   -> Giao diện các màn hình (sảnh, lộ vai, trong game, kết thúc)
    style.css    -> Bao gồm theme sáng (ngày) / tối (đêm) tự chuyển theo pha
    app.js       -> Logic client chính, giao tiếp Socket.io, chuyển theme ngày/đêm
    chat.js      -> Giao diện chat 3 kênh
    voice.js     -> WebRTC mesh: kết nối trực tiếp giữa các trình duyệt, mic bật/tắt
    audio.js     -> Giọng dẫn chuyện (Text-to-Speech) + nhạc nền ngày/đêm, có bật/tắt
    sounds/      -> Nhạc WAV ngày/đêm, tổng hợp bằng scripts/generate-music.cjs
```

## Giới hạn hiện tại / hướng mở rộng thêm

- **Voice chat dùng WebRTC mesh (kết nối trực tiếp p2p)**: hoạt động tốt với vài người trong 1 kênh (ví dụ 2-4 Sói, hoặc vài người ở Âm phủ). Với kênh Làng đông người (10+ người cùng lúc), mỗi trình duyệt phải mở nhiều kết nối cùng lúc nên có thể hơi nặng máy/mạng yếu — cân nhắc vẫn dùng thêm Discord/Zoom ngoài nếu phòng đông và mạng không ổn định.
- **WebRTC cần STUN/TURN để xuyên NAT**: code đang dùng STUN công cộng miễn phí của Google, đủ dùng cho phần lớn mạng nhà/mạng di động thông thường. Nếu một số người không nghe được nhau (mạng công ty, mạng chặn UDP...), cần tự thêm TURN server riêng (ví dụ dịch vụ metered.ca) vào `RTC_CONFIG` trong `public/voice.js`.
- **Giọng dẫn chuyện** phụ thuộc vào giọng đọc tiếng Việt có sẵn trên trình duyệt/thiết bị của từng người — chất lượng có thể khác nhau, một số máy có thể không có giọng tiếng Việt và sẽ đọc bằng giọng mặc định khác.
- Nhạc cần thao tác bấm của người dùng để trình duyệt cho phép phát. Giọng dẫn chuyện tiếng Việt phụ thuộc giọng đọc có sẵn trên thiết bị.
- Vai trò được lưu trong bộ nhớ server (không dùng database) — nếu server restart giữa ván, các phòng đang chơi sẽ mất. Phù hợp cho các buổi chơi ngắn vài giờ.
- Chưa có xác thực người dùng — bất kỳ ai có link + mã phòng đều vào được, phù hợp chơi với bạn bè.
- Vì trạng thái vai trò gửi qua socket riêng cho từng người, một người chơi cố tình mở DevTools vẫn có thể xem được dữ liệu gửi tới đúng socket của họ (nhưng không thấy được vai trò người khác trừ khi cùng phe Sói).
