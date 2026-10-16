# Hệ thống trình bày NOXH Open Platform

Giao diện dùng chung thư viện `@noxh/ui`; các phân hệ tổ chức theo công việc và quyền của người sử dụng. Không viết một hệ màu, thang chữ hoặc kiểu nút riêng cho mỗi màn hình.

## Tiếng Việt và phông chữ

Web tự lưu **Be Vietnam Pro** ở400/500/600/700, lấy từ nguồn Google Fonts đã khóa revision, giấy phép OFL tách khỏi MIT của mã ứng dụng. `packages/ui/fonts/manifest.json` giữ URL/hash; không gửi request font ra bên ngoài. Toàn bộ web, đối tác, minh bạch và khung Zalo dùng cùng font. Kiểm glyph phủ các ký tự tiếng Việt U+1EA0–U+1EF9 và Đ/đ trước build.

Văn bản người dùng có dấu và dùng thuật ngữ nhất quán: hồ sơ chuẩn bị, hồ sơ đã gửi, biên nhận, thẩm định, phê duyệt, lượt chọn, phiên bốc thăm. Mã API, hash, phiên bản máy và công thức đặt trong vùng chi tiết; chỉ giữ ở luồng chính nếu cần để người dùng quyết định hoặc kiểm chứng.

PDF giữ bố cục nguồn chính thức; phần điền và provenance dùng DejaVu Serif có tiếng Việt và giấy phép trong form-engine. Không thay phông/tiêu đề toàn bộ mẫu nguồn hay sinh chữ ký/con dấu.

## Phân cấp và bố cục

- Một tiêu đề chính mỗi không gian; bên dưới là mô tả ngắn về việc cần làm và trạng thái thực tế.
- Danh sách/tiến độ/kết quả có trước; cấu hình dài nằm trong vùng mở rộng có tên rõ ràng. Các mục lớn của quản trị được nhóm theo hành trình dự án, hồ sơ, kinh doanh, điều hành và quản trị hệ thống.
- Dùng chung surface-head/body, bảng có tiêu đề cột, thanh lọc và trạng thái trống/lỗi/đang tải. Không làm toàn bộ màn hình thành một chuỗi ô nhập dài.
- Thông báo pháp lý quan trọng ở đúng thao tác có hệ quả; không nhắc lại cùng đoạn kỹ thuật ở mọi thẻ.

## Thang trình bày

Nội dung làm việc14px, nhãn13px, tiêu đề màn hình26–30px, tiêu đề khối16–20px; dòng1.5–1.8 để dấu tiếng Việt không chạm/cắt. Metadata có thể nhỏ hơn; không dùng chữ nhỏ cho nội dung cần ra quyết định. Các bảng số dùng tabular numbers; thời gian và tiền được định dạng vi-VN.

Màu chính xanh đậm, điểm nhấn xanh ngọc; nền trung tính sáng, đường viền mảnh. Màu trạng thái luôn đi với chữ, không dùng riêng màu để phân biệt. Nút chính dành cho bước tiếp theo, nút phụ cho xem/sửa, thao tác thu hồi/hủy có lý do và quyền thích hợp.

## Biểu mẫu và khả năng truy cập

Ô nhập/select/textarea kế thừa font, có nhãn thật, điều khiển tối thiểu44px, viền/focus rõ ràng. Checkbox không chọn sẵn cho chia sẻ dữ liệu/xác nhận; lời giải thích liền với lựa chọn. Giữ giá trị khi lỗi và chỉ báo lỗi thao tác cụ thể. Bấm gửi lặp không tạo nhiều hồ sơ.

Điều hướng quản trị dài có cuộn riêng; trên điện thoại chuyển sang thanh cuộn ngang. Bảng được cuộn trong khung, tránh kéo rộng toàn trang. Thử tối thiểu390px và1280px, bàn phím, diacritics và nhãn dài. Ảnh chụp là ứng dụng thực dùng dữ liệu giả lập, không dùng ảnh dựng để che trạng thái chưa có dữ liệu.

## Quy tắc khả năng truy cập được kiểm tự động

Bộ kiểm `pnpm test:a11y` (Playwright + axe-core, thẻ WCAG 2.0/2.1 A và AA) chạy trên bản build thật của 5 giao diện với API giả lập; mọi trang trong `tests/a11y/pages.ts` phải không còn vi phạm. Các quy tắc sau là bắt buộc cho màn hình mới:

- **Ngôn ngữ và cấu trúc**: `<html lang="vi">`; đúng một `<h1>` mỗi trang, cấp tiêu đề không nhảy bậc (`h1 → h2 → h3`); đúng một `<main id="noi-dung" tabIndex={-1}>`; nội dung nằm trong landmark (`header/nav/main/aside/footer`); `nav`/`aside` lặp lại phải có `aria-label` khác nhau. Trạng thái trống dùng `EmptyState` (không tạo tiêu đề), tiêu đề khối dùng `h2.section-title`/`h3` theo đúng cấp.
- **Liên kết bỏ qua**: `SkipLink` từ `@noxh/ui` đứng đầu `<body>` của mọi layout (Mini App: thẻ tĩnh trong `index.html`); phím Tab đầu tiên phải tới liên kết này và Enter đưa tiêu điểm vào `<main>`.
- **Bàn phím**: chỉ dùng `button`/`a`/`input`/`select`/`textarea`/`summary` cho thao tác; không gắn `onClick` lên `div`/`span`. Mọi phần tử nhận tiêu điểm phải hiện vòng focus (quy tắc `:focus-visible` dùng chung, màu `--focus-ring`). Nút chỉ có biểu tượng phải có `aria-label`; biểu tượng trang trí dùng `aria-hidden`.
- **Biểu mẫu**: nhãn thật (`<label>` bao ngoài hoặc `htmlFor`/`id`); trường bắt buộc có `required` + `aria-required`; khi lỗi, trường liên quan đặt `aria-invalid` và `aria-describedby` trỏ tới thông báo `role="alert"`; tiến trình dài (tải tệp, xử lý) thông báo bằng `role="status"` và có nút hủy. Bảng dữ liệu có `th scope="col"`, ô thao tác không để trống (dùng `sr-only`).
- **Màu chữ**: chỉ dùng token trong `packages/ui/platform.css` (`--ink`, `--ink-muted`, `--accent-ink`, `--amber-ink`, `--blue-ink`, `--badge-ink`, `--sidebar-ink-muted`…), tất cả ≥ 4,5:1 trên nền sáng tương ứng. Không đặt màu xám nhạt inline; màu nhạt chỉ dành cho viền và biểu tượng trang trí. Trên nền tối của sidebar/auth-story dùng `--sidebar-ink-muted` thay vì `opacity`.
- **Thu phóng và chuyển động**: không tràn ngang ở 390px và ở 200% (640px CSS); bảng rộng cuộn trong `.table-scroll`. `prefers-reduced-motion: reduce` tắt animation/transition dùng chung.

Chưa kiểm tự động được: đọc màn hình thật (VoiceOver/TalkBack) trên thiết bị, thứ tự đọc trong Zalo thật, và nội dung PDF sinh ra; các mục này nằm trong nghiệm thu thủ công.

## Cổng nghiệm thu

Chạy check:fonts, lint/typecheck/tests/build và `pnpm test:a11y` sau build; kiểm trực tiếp các vai trò trên bản demo; kiểm font thực được tải từ cùng host và không mất dấu; chụp lại ảnh sau thay đổi trình bày. Cấu hình bản demo và credential ở ngoài kho công khai.
