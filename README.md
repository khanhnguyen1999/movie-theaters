# 🎬 Rạp Phim Đôi

Phòng chiếu 3D để hai người xem phim YouTube cùng nhau theo thời gian thực.

## Chạy

```bash
npm install
npm start
```

Mở http://localhost:3000 → nhập tên → **Mở phòng chiếu mới** (tên phòng, link phim YouTube nếu muốn — có xem trước, mật khẩu, số ghế) → trong rạp bấm **Sao chép link mời** rồi gửi link kèm mật khẩu cho người ấy. Ở sảnh có danh sách tất cả phòng (số người đang xem, phim đang chiếu), bấm vào phòng để nhập mật khẩu và vào.

Biến môi trường: `PORT` (mặc định 3000), `DB_PATH` (mặc định `data/cinema.db`), `MAX_ROOMS` (mặc định 500).

## Dữ liệu (SQLite)

Lưu ở `data/cinema.db`, còn nguyên khi khởi động lại server:

- `rooms` – phòng: tên, người tạo, mật khẩu (băm scrypt), số người tối đa, phim đang chiếu và vị trí đang xem
- `playlist` – danh sách chờ của từng phòng
- `messages` – lịch sử chat (giữ 500 tin gần nhất mỗi phòng, khi vào phòng hiện 50 tin)

## API

| Method | Đường dẫn | Mô tả |
| --- | --- | --- |
| GET | `/api/rooms?q=` | Danh sách phòng (tìm theo tên, không phân biệt dấu) |
| GET | `/api/rooms/:id` | Thông tin một phòng |
| POST | `/api/rooms` | Tạo phòng `{ name, owner, password, maxPeople, video? }` (`video`: link YouTube, bỏ trống thì chiếu phim mẫu) |
| GET | `/api/video?url=` | Kiểm tra link YouTube, trả về mã và tên phim |
| DELETE | `/api/rooms/:id` | Xoá phòng `{ password }` — người đang xem sẽ được đưa về sảnh |

Vào phòng, đồng bộ phim, chat… đi qua Socket.IO (`join`, `control`, `playlist-*`, `chat`, `react`, `seat`, `look`). Sai mật khẩu quá 8 lần/phút mỗi IP sẽ bị chặn tạm thời.

## Tính năng

- Phòng riêng có mật khẩu (băm scrypt), giới hạn số người
- Rạp 3D (Three.js): sàn bậc thang, ghế, ghế đôi màu hồng, rèm, trần sao, tia máy chiếu, đèn tự dịu khi phim chạy
- Màn chiếu là iframe YouTube đặt trong không gian 3D (CSS3DRenderer + kỹ thuật "khoét lỗ" trên canvas WebGL)
- Bảng điều khiển 3D trước ghế (nhìn xuống): phát/dừng, tua ±10s, thanh tiến trình bấm để tua, âm lượng, đèn, đổi link, toàn màn hình, thả cảm xúc
- Đồng bộ phát/dừng/tua/đổi phim giữa hai người, tự sửa lệch thời gian; người vào sau bắt kịp đúng đoạn đang chiếu
- Avatar người kia ngồi ở ghế, đầu xoay theo hướng nhìn thật; bong bóng chat trên đầu
- Nhấp ghế trống để đổi chỗ
- **Xem toàn màn hình** (phím `F`, nút ⛶ trên bảng 3D hoặc trong Quản lý phim): camera bay tới trước màn chiếu, video phủ kín màn hình nhưng vẫn giữ khung chat và thanh điều khiển (phát/tạm dừng, tua, âm lượng, thả cảm xúc, danh sách phim); nhấp vào video để tạm dừng, `Esc`/nhấp đúp/nút 🏛️ để về rạp
- **Bảng quản lý phim** (nút 🎞️ góc phải hoặc phím `M`): dán link YouTube để chiếu ngay hoặc thêm vào danh sách chờ; phát/tạm dừng, tua ±10s, kéo thanh thời gian, chiếu lại từ đầu, phim kế, âm lượng; danh sách chờ đồng bộ giữa hai người (chiếu, xếp lên/xuống, xoá), hết phim tự chuyển phim kế

Xoá toàn bộ dữ liệu: tắt server rồi xoá thư mục `data/`.

## Phím tắt

`Space` phát/dừng · `←/→` tua 10s · `↑/↓` âm lượng · `M` mở/đóng quản lý phim · `Esc` đóng · `F` xem toàn màn hình · `R` hoặc nhấp đúp: nhìn lại màn chiếu · `Enter` chat

## Cấu trúc

- `server.js` – Express REST API + Socket.IO: phòng, mật khẩu, đồng bộ phát
- `db.js` – SQLite (better-sqlite3): bảng và truy vấn
- `public/lobby.js` – sảnh: danh sách phòng, tạo / vào / xoá phòng
- `public/cinema.js` – dựng phòng chiếu và màn chiếu
- `public/ui3d.js` – nút bấm / thanh tiến trình / chữ 3D
- `public/app.js` – sảnh chờ, đồng bộ YouTube, avatar, điều khiển

Lưu ý: một số video YouTube chặn nhúng (lỗi 101/150) sẽ không phát được.

## Deploy lên Fly.io

Đã có sẵn `Dockerfile`, `fly.toml`, `.dockerignore`. Fly tự build image trên máy chủ của họ, máy bạn không cần Docker.

```bash
brew install flyctl          # cài công cụ dòng lệnh của Fly
fly auth login               # đăng nhập (mở trình duyệt)
fly apps create rap-phim-doi # tên phải duy nhất; nếu trùng, đổi tên và sửa dòng `app = ...` trong fly.toml
fly volumes create cinema_data --region sin --size 1   # ổ đĩa 1GB giữ cơ sở dữ liệu
fly deploy                   # build và chạy
fly open                     # mở https://<tên-app>.fly.dev
```

- Chỉ chạy **1 máy** (SQLite và Socket.IO đều nằm trên một máy). Nếu Fly tự tạo 2 máy: `fly scale count 1`.
- Không có ai dùng thì máy tự ngủ, người đầu tiên vào sẽ chờ vài giây. Muốn luôn bật: đặt `min_machines_running = 1` trong `fly.toml`.
- Xem log: `fly logs` · Sao lưu dữ liệu: `fly ssh sftp get /data/cinema.db`
# movie-theaters
