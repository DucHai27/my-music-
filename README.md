# Sonora — phiên bản dành cho Vercel + Blob

Đây là bản chỉnh sửa của Sonora để chạy trên **Vercel Hobby**, không phải bản dành cho VPS.
Website, API và đăng nhập chạy bằng Express Functions; file MP3 được **upload thẳng từ trình duyệt vào Vercel Blob**; thông tin thư viện được lưu thành các file JSON riêng trong Blob. Không cần cơ sở dữ liệu cho bản cá nhân nhỏ này.

## Điều kiện / lưu ý quan trọng

- Dùng **Vercel Blob Public store**, không phải Private store. *Ai có URL Blob trực tiếp đều có thể truy cập file*, kể cả khi không đăng nhập vào Sonora. Mật khẩu Sonora chỉ bảo vệ giao diện, danh sách thư viện và thao tác quản lý. Không dùng phiên bản này cho file nhạc cần giữ kín tuyệt đối hoặc không được phép chia sẻ.
- Vercel Hobby dành cho sử dụng cá nhân/phi thương mại, có hạn mức lưu trữ/truyền dữ liệu. Không bảo đảm hoạt động nếu vượt hạn mức.
- Không upload file nhạc lên GitHub. Không đưa `.env` hoặc token Blob lên GitHub.
- Metadata lưu bằng JSON Blobs để giảm cấu hình; phù hợp một người quản lý, ít bài hát. Với thư viện hàng trăm/hàng nghìn bài hoặc nhiều người cùng thao tác, nên chuyển metadata sang Postgres/SQL.
- Nếu file upload thành công nhưng thao tác đăng ký metadata lỗi, file vẫn tồn tại trong Blob store nhưng không hiện trong thư viện. Có thể xóa Blob bị lẻ bằng giao diện Vercel Storage.
- Không có tài khoản/phân quyền cho nhiều người. Nếu bạn đưa mật khẩu cho người khác, họ có thể sửa/xóa/upload nhạc.

## Cách triển khai bằng GitHub và Vercel (khuyến nghị)

1. Tạo tài khoản miễn phí tại https://github.com và https://vercel.com.
2. Giải nén thư mục `sonora-vercel/`. Trong GitHub chọn **New repository** (ví dụ `sonora-music`), chọn **Private** nếu muốn giữ mã nguồn kín. Upload **nội dung bên trong thư mục**, không upload file ZIP nguyên vẹn. Có thể dùng Git hoặc giao diện GitHub **Add file → Upload files**.
3. Vào https://vercel.com/new, kết nối GitHub và import repository vừa tạo.
4. Trong **Settings → Environment Variables**, thêm:
   - `APP_PASSWORD`: mật khẩu đăng nhập, tối thiểu 12 ký tự.
   - `SESSION_SECRET`: một chuỗi ngẫu nhiên dài tối thiểu 32 ký tự, khác mật khẩu (có thể dùng `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
   - `MAX_UPLOAD_MB`: tùy chọn, ví dụ `150`.
5. Chọn **Deploy**. Vercel nhận diện Express/Node từ `server.js`. File `vercel.json` buộc chạy `npm run build` để bundle trình phát. Chọn Framework Preset **Express** nếu có (nếu không thì để mặc định), không chọn React/Next. Giữ **Root Directory** là thư mục có `package.json` và `server.js`.
6. Trong Vercel project → **Storage** → **Create Database** → **Blob**, chọn **Public** → tạo store → kết nối với project (Production, Preview nếu cần). Việc kết nối tự tạo `BLOB_READ_WRITE_TOKEN`; xác nhận biến có trong Environment Variables và **Redeploy** sau khi tạo store.
7. Mở domain `https://<tên-project>.vercel.app`, đăng nhập bằng `APP_PASSWORD`, chọn MP3 và tải lên, nghe thử từ điện thoại qua 4G.

> Nếu project vừa Deploy mà báo lỗi API khi chưa có Blob, hãy tạo/connect Blob store và Redeploy. Cần đảm bảo Vercel đang dùng môi trường có đủ 3 biến `APP_PASSWORD`, `SESSION_SECRET`, `BLOB_READ_WRITE_TOKEN`.

## Cách chạy thử trên máy cá nhân (nâng cao)

```bash
npm install
npm run setup
# Điền BLOB_READ_WRITE_TOKEN trong .env do Vercel cấp
npm run build
npm start
```

Ở môi trường local, Vercel Blob upload callback có thể không liên hệ được `localhost` (điều này không ảnh hưởng production), nên hãy ưu tiên kiểm tra luồng upload trên domain đã triển khai. `npm run setup` tạo mật khẩu để chạy local; đặt mật khẩu giống biến trong Vercel nếu bạn muốn.

## Cấu trúc

```
public/            # giao diện HTML, CSS và app.bundle.js (sinh ra khi build)
src/app.js         # nguồn trình phát và upload thẳng lên Blob
server.js          # Express API serverless cho Vercel
scripts/setup.js   # tạo cấu hình local
package.json
```

## Kiểm tra tĩnh

```bash
npm run check
```

Nếu gặp lỗi sau khi deploy: **Vercel → Project → Logs → Functions** và xem nguyên nhân, đồng thời xác nhận Blob store Public và biến `BLOB_READ_WRITE_TOKEN` hiện diện.
