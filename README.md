# Ma Sói Công Sở 🌕

Game Ma sói nhiều người chơi trên điện thoại, dành cho giờ nghỉ trưa ở văn phòng.

- Mỗi người một điện thoại, vào phòng bằng mã 4 số hoặc quét QR.
- Máy chủ giữ kín vai: mỗi điện thoại chỉ nhận đúng thông tin của mình.
- Thiếu người? Chủ phòng chọn số ghế (6–12), hệ thống tự thêm bot.
- 7 vai: Sói, Tiên tri, Bảo vệ, Phù thủy, Thợ săn, Cupid, Dân làng.
- Chat tự do, kênh bí mật của Sói, thả cảm xúc, lời trăng trối, khu khán giả có đặt cược, xem lại ván đấu.
- Người bị loại chỉ công bố phe (Sói/Dân), vai cụ thể giữ kín đến hết ván.

## Chạy thử trên máy

```bash
npm install
npm start
# mở http://localhost:3000
```

## Triển khai lên Railway

1. Đưa toàn bộ thư mục này lên một repository GitHub (không cần thư mục `node_modules`).
2. Vào https://railway.com → **New Project** → **Deploy from GitHub repo** → chọn repository vừa tạo.
3. Railway tự nhận diện Node.js và chạy `npm start`. Không cần cấu hình thêm biến môi trường (Railway tự cấp `PORT`).
4. Khi deploy xong: vào service → **Settings** → **Networking** → **Generate Domain** để lấy link công khai.
5. Gửi link cho mọi người. Mỗi lần bạn đẩy code mới lên GitHub, Railway tự deploy lại.

## Lưu ý

- Phòng chơi lưu trong bộ nhớ máy chủ: khi Railway deploy lại hoặc khởi động lại, các phòng đang chơi sẽ mất. Hãy deploy khi không có ai đang chơi.
- Chạy 1 instance (mặc định của Railway). Nếu tăng số replica, người chơi cùng phòng có thể bị chia sang máy khác nhau.
- Hồ sơ cá nhân (điểm, huy hiệu, lịch sử) lưu trên từng điện thoại. Muốn đồng bộ theo tài khoản cần thêm cơ sở dữ liệu (ví dụ Railway PostgreSQL).

## Cấu trúc

- `server.js` — máy chủ Express + Socket.IO, toàn bộ luật chơi, bot và bộ đếm giờ.
- `public/index.html` — giao diện điện thoại (một file duy nhất).
