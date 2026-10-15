# Quản trị chủ đầu tư và đăng nhập khách hàng — v0.2

BDSG Foundation phát hành mã MIT, tự triển khai. Bản này có backend nghiệp vụ quản trị và bảng điều khiển khách, chưa có quy trình nộp đơn pháp lý, thẩm định hay bốc thăm.

## Khởi tạo quản trị

1. Chạy `node scripts/init-dev-env.mjs`, rồi Docker Compose theo README. Với `.env` development cũ, chạy `node scripts/init-dev-env.mjs --add-auth-keys` để chỉ thêm biến thiếu, giữ các giá trị đã có. Cần có `AUTH_ORGANIZATION_ID`, `AUTH_ENCRYPTION_KEY` và `AUTH_HASH_KEY`; mỗi khóa phải là 32 byte ngẫu nhiên ở dạng 64 ký tự hex. Giữ khóa ổn định và sao lưu riêng với DB; đổi trực tiếp sẽ làm mất khả năng giải mã hoặc tìm tài khoản cũ.
2. Mở Keycloak http://localhost:8080 bằng tài khoản bootstrap trong `.env`. Chọn realm `noxh`; tạo tài khoản nhân sự của chính chủ đầu tư, đặt mật khẩu và gán realm role `org_admin`. Không có tài khoản nhân sự/mật khẩu mặc định trong mã nguồn. OTP bắt buộc; người dùng thiết lập ứng dụng TOTP khi đăng nhập lần đầu.
3. Mở http://localhost:3001, chọn đăng nhập Keycloak. Luồng Authorization Code + PKCE yêu cầu mật khẩu và TOTP. API xác minh chữ ký RS256, issuer, audience `noxh-api`, client `noxh-investor`, hạn token và `amr` chứa `otp`, sau đó kiểm tra role. BFF chỉ lưu token trong cookie HttpOnly.
4. Quản trị dự án (nháp/công bố/lưu trữ), lịch tiếp nhận và xem số liệu DB. Sửa/lưu trữ dùng `If-Match`; phiên bản cũ trả 409. Lưu trữ giữ hồ sơ liên quan. Lịch tiếp nhận chưa kích hoạt nộp đơn chính thức.

Realm được import khi tạo mới. Keycloak bỏ qua realm đã tồn tại: người dùng nâng cấp phải import cấu hình vào realm mới hoặc áp dụng flow `noxh-browser`, AMR mapper, audience, default client scope `basic` (cung cấp `sub`) và client PKCE tương ứng bằng Admin Console; không xóa volume để nâng cấp. Đọc cấu hình tại `deploy/keycloak/noxh-realm.json`. Role `project_manager` được dự phòng, chưa được API chấp nhận; chưa có phân công quyền theo từng dự án. `org_admin` quản trị toàn tổ chức cấu hình phía máy chủ, không nhận organization từ trình duyệt.

## Chủ đầu tư tự cấu hình Zalo

Trong quản trị → **Zalo OTP**, nhập OA ID, App ID, Template ID, tên tham số OTP, Access Token và App Secret của chính chủ đầu tư. Mẫu cần được Zalo duyệt và có quyền gửi OTP theo số điện thoại. Hiện hỗ trợ một tham số OTP; cần chỉnh adapter nếu mẫu yêu cầu nhiều trường. OA/App ID là thông tin cấu hình để đối soát; token và template mới quyết định tài khoản gửi ở nhà cung cấp. Nhập mới token khi hết hạn, chưa có tự gia hạn OAuth.

Chỉ bật gửi sau khi cấu hình hợp lệ. Lưu cấu hình không tự gửi tin. Credential mã hóa AES-256-GCM tại backend và API chỉ trả metadata, không trả lại token/secret. Để trống hai trường bí mật khi sửa sẽ giữ credential cũ. Tắt checkbox sẽ chặn yêu cầu và xác minh OTP mới; phiên đã cấp hết hạn sau tối đa một giờ hoặc khi đăng xuất.

Khách mở http://localhost:3000/login, nhập số di động Việt Nam và đồng ý thông báo mục đích xác thực. Backend gửi qua endpoint chính thức Zalo; chỉ khi nhà cung cấp chấp nhận mới cho xác minh. Mã 6 số hết hạn sau 5 phút, tối đa 5 lần nhập sai, dùng một lần, gắn với chứng cứ trình duyệt HttpOnly. Gửi lại cách ít nhất 60 giây, tối đa 5 lần/số/giờ. Khi xác thực thành công, lưu bản ghi chấp thuận `phone-login-v1`, cấp phiên opaque lưu hash và hiển thị hồ sơ chuẩn bị thuộc tài khoản đó.

Đây là xác thực quyền truy cập kênh điện thoại, chưa chứng minh danh tính pháp lý. Không tự gộp với tài khoản nhân sự hoặc Zalo Mini App. Hiện dashboard chỉ chứa mã/trạng thái hồ sơ chuẩn bị; cần thiết kế xác minh danh tính, khôi phục và xử lý số điện thoại tái cấp trước khi lưu giấy tờ nhạy cảm. Mini App token exchange vẫn trả 501.

API và kiểm thử tích hợp không cần Zalo thật: transport giả chỉ được inject trong test, không có chế độ bypass OTP ở runtime. Việc gửi OTP tới Zalo thật cần chủ đầu tư cấu hình OA/token/mẫu đã duyệt và kiểm tra trên tài khoản của mình; chưa được xác nhận bằng credential thật trong đợt phát triển này. Hợp đồng adapter dựa trên [Zalo Open APIs](https://docs.zaloplatforms.com/open-apis), [mã lỗi](https://docs.zaloplatforms.com/docs/ZBS/bang-ma-loi); MFA dựa trên [Keycloak Server Administration](https://www.keycloak.org/docs/26.2.5/server_admin/index.html).

## Vận hành và giới hạn

- Compose chỉ phục vụ development, dùng DB owner trên loopback. API có điều kiện phạm vi tổ chức/owner tại mọi truy vấn nghiệp vụ; chưa dùng DB login tối thiểu với RLS cho runtime mới. Không coi đây là cấu hình production.
- Production cần HTTPS cho web/IdP/JWKS, origin và redirect URI chính xác, realm issuer riêng cho tổ chức, tài khoản DB tối thiểu, quản lý/luân chuyển khóa có phiên bản, sao lưu/khôi phục, hạn lưu và xóa dữ liệu theo chính sách được duyệt. Không công bố cổng DB/Redis/Keycloak quản trị ra Internet.
- Rate limit lưu DB bền vững. Giới hạn peer dựa vào socket API, nên khi đi qua BFF có thể gộp nhiều người vào 100 yêu cầu/giờ. Cần bổ sung edge rate limit và trusted-proxy/IP policy trước khi mở rộng; không tin `X-Forwarded-For` từ client tùy ý.
- Đăng xuất thu hồi phiên khách hoặc token nhân sự hiện tại trong DB. Chưa có quản lý/thu hồi toàn bộ thiết bị hoặc logout toàn bộ IdP. Thay đổi role có hiệu lực khi token mới được cấp, token sống tối đa 15 phút trong realm mẫu.
- Sự kiện nghiệp vụ append-only bằng trigger, chưa có chuỗi hash, checkpoint ký hoặc bản sao ngoài máy chủ. Chưa có tự dọn challenge/session/rate-limit hết hạn; cần tác vụ retention trước pilot. Không ghi OTP/token/số điện thoại vào log.
- Các danh sách hiện chưa phân trang; dùng cho nền phát triển nhỏ. Cấu hình sai, DB lỗi hay Zalo từ chối phải trả lỗi, không thay bằng hồ sơ hoặc đăng nhập giả.
