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

## Cổng nghiệm thu

Chạy check:fonts, lint/typecheck/tests/build; kiểm trực tiếp các vai trò trên bản demo; kiểm font thực được tải từ cùng host và không mất dấu; chụp lại ảnh sau thay đổi trình bày. Cấu hình bản demo và credential ở ngoài kho công khai.
