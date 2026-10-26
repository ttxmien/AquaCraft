> ***This app is based on `your_aquarium` created by NCMV***

# Bể cá của bạn — Website mô phỏng bể cá 3D

Một MVP chạy trực tiếp trên trình duyệt cho dự án **Bể cá của bạn**. Người dùng có thể sắp xếp san hô, đá và cây thủy sinh, điều chỉnh mực nước, thêm cá, thả thức ăn và quan sát hành vi bơi trong không gian 3D.

## 1. Chạy project trên máy cá nhân

Cần chạy website qua HTTP server. Không mở trực tiếp `index.html` bằng `file://`, vì trình duyệt thường chặn việc import ES modules trong trường hợp đó.

### Windows (PowerShell)

```powershell
cd aquarium-project
py -m http.server 8000
```

### macOS / Linux

```bash
cd aquarium-project
python3 -m http.server 8000
```

Mở trình duyệt tại **http://localhost:8000**. Trình duyệt cần hỗ trợ WebGL 2 và bật hardware acceleration.

Bạn cũng có thể cài extension **Live Server** trong VS Code, mở `index.html`, sau đó chọn **Open with Live Server**.

## 2. Điều khiển

| Thao tác | Cách thực hiện |
| --- | --- |
| Xoay góc nhìn bể cá | Kéo chuột ở vùng trống |
| Phóng to / thu nhỏ | Cuộn chuột hoặc pinch trên màn hình cảm ứng |
| Thêm vật trang trí | Mở **Tank studio → Decor**, chọn vật thể |
| Di chuyển vật trang trí | Kéo vật thể trong bể; camera sẽ không xoay trong lúc kéo |
| Xoay vật thể đang chọn | Chọn vật thể, nhấn **Rotate** |
| Thay đổi kích thước vật thể | Chọn vật thể, kéo thanh **Scale** trong thẻ đang chọn |
| Xóa vật thể | Click chuột phải lên vật thể, hoặc chọn **Remove** |
| Undo thao tác trang trí | Nút **Undo** ở cuối bảng Tank studio hoặc `Ctrl/Cmd + Z` |
| Thêm cá | Mở **Tank studio → Fish**, chọn loài cá |
| Cho cá ăn | Chọn **Feed fish**, sau đó click vào vị trí muốn thả thức ăn trong nước |
| Điều chỉnh mực nước | Kéo thanh **Water level** |
| Đổi giao diện sáng / tối | Nút mặt trời / mặt trăng ở thanh trên cùng |
| Ẩn khu vực chỉnh sửa | Chọn **Hide studio** để mở rộng vùng hiển thị bể cá |

Thao tác click chuột phải để xóa dành cho máy tính. Trên thiết bị cảm ứng, hãy chọn vật thể và dùng nút **Remove**.

## 3. Triển khai website

Đây là website static. Không có backend, database, authentication hay build output cần cấu hình.

### Netlify

1. Giải nén file ZIP.
2. Trên Netlify, tạo site mới bằng **Deploy manually** (hoặc kết nối Git repository).
3. Kéo thả thư mục project đã giải nén vào khu vực deploy.
4. File `netlify.toml` đã cấu hình publish directory là thư mục gốc. Không cần build command.

### Vercel

1. Push nội dung project đã giải nén lên Git repository và import repository đó vào Vercel.
2. Chọn framework preset **Other**.
3. Để trống build command và đặt output directory là `.`.
4. Deploy. File `vercel.json` đã có cấu hình static fallback cơ bản.

### GitHub Pages

1. Push project lên repository; `index.html` phải nằm ở thư mục root được publish.
2. Mở **Settings → Pages**.
3. Trong **Build and deployment**, chọn **Deploy from a branch**, chọn branch và `/ (root)`, sau đó Save.
4. Truy cập URL GitHub Pages sau khi deployment hoàn tất.

Các đường dẫn module trong project đều là relative path, vì vậy có thể deploy ở domain root hoặc project subpath.

## 4. Yêu cầu runtime và lưu ý

- Trình duyệt hiện đại hỗ trợ **WebGL 2**, nên bật hardware acceleration.
- Cần internet để tải `three@0.180.0` và OrbitControls từ `cdn.jsdelivr.net`.
- Lần đầu mở trang cần truy cập CDN. Nếu muốn chạy offline hoặc kiểm soát dependency trong production, hãy vendoring Three.js module và addon tương ứng vào project rồi cập nhật import map trong `index.html`.
- Khuyến nghị máy tính có GPU rời hoặc GPU tích hợp tương đối mới để chạy shadow và hiệu ứng transparency mượt hơn. Renderer giới hạn device pixel ratio ở mức 2.

## License

MIT. Xem file `LICENSE`.
