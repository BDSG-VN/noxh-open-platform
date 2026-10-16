# Zalo Mini App — định danh máy chủ và liên kết có xác nhận

Cập nhật 2026-10-16. Triển khai chỉ gọi giao thức chính thức ở phía máy chủ khi được bật; kiểm thử dùng transport giả lập, không gửi tin OA/ZBS hoặc gọi Zalo thật. Đăng nhập kênh, OTP điện thoại và ảnh giấy tờ đều **không chứng minh danh tính pháp lý**.

## Giao thức nguồn đã đối chiếu

- [Đăng nhập Mini App, tài liệu chính thức cập nhật 15/10/2026](https://docs.zaloplatforms.com/docs/MA/intro/best-practices/authen-user): SDK lấy access token, máy chủ gọi `GET https://graph.zalo.me/v2.0/me` với header `access_token` và `appsecret_proof`. Proof là HMAC-SHA256 của token, dùng App Secret của Zalo App, xuất hex. Tài liệu yêu cầu proof từ 01/01/2024 để ràng buộc token với Zalo App đã đăng ký. `id` thuộc namespace của từng Zalo App ID.
- [getAccessToken chính thức](https://docs.zaloplatforms.com/docs/MA/api/user/user-information/getAccessToken): từ SDK 2.35.0 có thể lấy token cho ID; tên/ảnh cần quyền `scope.userInfo`. Mã này chỉ yêu cầu `fields=id`, không xin quyền tên/ảnh. Zalo App ID và Mini App ID khác nhau; proof này ràng buộc **Zalo App**, không phải bằng chứng riêng cho từng Mini App nằm trong cùng App.
- [getPhoneNumber chính thức](https://docs.zaloplatforms.com/docs/MA/api/user/user-information/getPhoneNumber): token số điện thoại cần quyền chia sẻ riêng, chỉ dùng một lần trong hai phút; server giải mã qua endpoint `/v2.0/me/info`. Thay đổi này **không sử dụng** token đó để tự gộp tài khoản. Người dùng xác thực OTP theo kênh điện thoại sẵn có rồi xác nhận liên kết.
- [Lưu ý server-server](https://docs.zaloplatforms.com/docs/MA/intro/getting-started/frequently-solved-issues): App Secret phải nằm ở backend; SDK identity cần chạy trong Zalo thật. Trình duyệt/simulator không phải bằng chứng đã tích hợp thật.

Endpoint profile không trả `app_id` để máy chủ tự đối chiếu nhãn cấu hình. Quản trị phải xác nhận cặp Zalo App ID/App Secret đúng từ Zalo Console; không tuyên bố đã có introspection app-id riêng.

Không lấy thời hạn OAuth Social hoặc OA để suy ra thời hạn token SDK Mini App. Mỗi lần đăng nhập/liên kết gọi provider kiểm chứng; phiên nội bộ có thời hạn riêng một giờ.

## Dữ liệu và luồng

Migration `020_channel_identity.sql` tạo cấu hình Mini App riêng, liên kết private theo tổ chức/Zalo App/HMAC subject và challenge ngắn hạn. Không tái sử dụng khóa OA/ZBS để gửi OTP. App Secret mã hóa AES-GCM theo tổ chức và App ID; phản hồi admin chỉ có `hasSecret`.

1. Mini App yêu cầu challenge máy chủ hai phút. Exchange cần token SDK, challenge/proof và `accepted:true`; backend gọi đúng URL HTTPS, không redirect, timeout 5 giây, giới hạn 16 KiB. Chỉ chấp nhận `error===0` và ID chuỗi có định dạng giới hạn; không tin ID/tên/số điện thoại do client gửi.
2. Challenge được kiểm tra lại và tiêu thụ đúng một lần trong giao dịch sau provider. Nếu Zalo chưa liên kết, trả `needsLink` và **không tạo người dùng hoặc hồ sơ khác**.
3. Liên kết cần phiên `phone-otp` còn hạn, được tạo trong năm phút gần nhất, người dùng còn active và có tài khoản điện thoại chuẩn. Phiên Zalo không thay việc xác thực lại điện thoại.
4. `link/start` xác minh token, tạo challenge ràng buộc người dùng, hash phiên điện thoại, hash token, subject, App ID và phiên bản cấu hình. `link/confirm` cần xác nhận riêng, cùng phiên điện thoại/proof/token; gọi provider lại và kiểm tra lại cấu hình/quyền trong giao dịch. Các liên kết mâu thuẫn bị từ chối, không tự merge dù tên/số điện thoại giống nhau.
5. Zalo đã liên kết được cấp phiên opaque cùng định dạng với web, trỏ tới đúng user điện thoại. Không sao chép bản khai/hồ sơ. Hash token phiên lưu trong DB, token chỉ đưa về Mini App để giữ trong bộ nhớ.
6. Đổi cấu hình, khóa hoặc tắt kênh thu hồi các phiên/challenge Zalo cũ. `PhoneService.authenticate` kiểm lại cờ triển khai, App ID, phiên bản và trạng thái cấu hình mỗi request. Phiên điện thoại không bị thu hồi bởi thao tác cấu hình kênh.

Rate limit DB: tối đa 100 thao tác/peer/tổ chức/giờ và 20 thao tác/token/giờ, khóa chỉ lưu digest; proof sai tối đa năm lần/challenge. Không log credential hoặc trả lỗi provider nguyên văn. Challenge chống dùng lại **gói request**, không biến access token dạng bearer thành chứng minh quyền sở hữu mật mã. Token cùng App bị đánh cắp vẫn là credential nhạy cảm; cần bảo vệ thiết bị/kênh TLS và đánh giá DPoP nếu giao thức SDK hỗ trợ phù hợp. Không tuyên bố có DPoP khi chưa triển khai.

## API và tích hợp

Các route sau `/api/v1/`:

| Route                         | Phương thức | Chức năng                                                 |
| ----------------------------- | ----------- | --------------------------------------------------------- |
| `auth/zalo/status`            | GET         | Trạng thái bật kênh, không trả secret                     |
| `auth/zalo/challenges`        | POST        | Body `{}`, trả challenge ID/proof/thời hạn                |
| `auth/zalo/exchange`          | POST        | `{challengeId,challengeProof,accessToken,accepted:true}`  |
| `auth/link/start`             | POST        | Bearer phone mới; `{accessToken,accepted:true}`           |
| `auth/link/confirm`           | POST        | Cùng Bearer; payload challenge như exchange               |
| `admin/settings/zalo-miniapp` | GET/PUT     | Org admin; PUT `{enabled,appId,appSecret?}` và `If-Match` |

Provider/controller: `ZaloIdentityTransport`, `ZaloIdentityService`, `ZaloIdentityController`. Component quản trị: `ZaloMiniAppSettings()`; root tích hợp tab/BFF/OpenAPI.

Biến môi trường:

- Backend `ZALO_MINIAPP_ENABLED=false` mặc định; chỉ mở sau cấu hình và nghiệm thu provider.
- Mini App `VITE_API_ORIGIN` bắt buộc là origin HTTPS API (development có thể localhost HTTP); không chứa path/query/credential. `VITE_CITIZEN_WEB_URL` là cổng web được cấu hình.
- `ZALO_MINIAPP_ALLOWED_ORIGINS` do root tích hợp CORS, danh sách HTTPS origin chính xác, ví dụ origin chạy Mini App theo tài liệu; không wildcard và không coi CORS là xác thực người dùng.
- Khóa `AUTH_HASH_KEY`, `AUTH_ENCRYPTION_KEY` dùng hạ tầng hiện có. Đổi App Secret được xử lý bằng version/revoke. Đổi khóa HMAC nền tảng cần quy trình migration/reindex riêng cho cả phone/identity references, không tự coi là xoay App Secret.

Mini App giữ SDK token, session và challenge trong bộ nhớ, không localStorage/sessionStorage, URL hoặc log. Có màn hình login, phone OTP, xem yêu cầu/link confirm riêng, danh sách hồ sơ chuẩn và workspace chuẩn bị ngay trong Mini App. Đóng/mở lại yêu cầu đăng nhập lại. Liên kết tới cổng web không mang token; web vẫn xác thực riêng. Đã có tạo/mở hồ sơ, lưu bản khai với If-Match, thành viên hộ, upload PDF/JPEG/PNG 5 MiB → quét, đồng ý riêng từng tệp trước trích xuất OpenAI, kiểm tra/chọn từng trường, điền mẫu được duyệt → PDF nháp → xác nhận từng trường → tải blob hoặc ZIP. Không có thao tác ký hoặc nộp/xét duyệt chính thức trong Mini App.

## Nghiệm thu

Kiểm thử targeted: `zalo-identity.test.ts` **7/7 PASS**, `admin-auth.test.ts` **9/9 PASS**, Mini App **15/15 PASS** (chạy từng file, một worker, sau khi build chung kết thúc). Bao phủ: giao thức HMAC/URL/header, lỗi provider, oversize/timeout, off/config/version/role, replay challenge, fresh phone, confirmation, chống merge, nối lại cùng user/hồ sơ, keyrotation/disable/cross-org và frontend memory-only. Các test-double chứng minh xử lý theo contract, không chứng minh App Zalo/OA đã được duyệt, token provider thật hoặc việc gửi OTP thật.

Cổng phát hành thật còn cần Zalo App/Mini App được duyệt, credential đúng từng ứng dụng, origin HTTPS/CORS, nghiệm thu trong Zalo trên thiết bị thật, chính sách consent/dữ liệu và quy trình hỗ trợ đối chiếu/thu hồi liên kết. Không có endpoint công khai tự gộp hoặc đổi chủ liên kết; trường hợp tranh chấp phải đi qua đối chiếu thủ công được ủy quyền.

## Workspace Mini App và vòng đời dữ liệu trên thiết bị

`MiniDossierWorkspace.tsx` dùng chính API owner-scoped hiện có và các schema contracts, không tạo bộ quy tắc pháp lý thứ hai phía client. Mỗi lần lưu bản khai gửi `If-Match`; xung đột được báo để khách đối chiếu, không tự ghi đè. Mẫu/PDF cũ được hiển thị là đối chiếu khi máy chủ trả `usable=false`. Phần xác nhận cơ quan trên mẫu để trống.

Tệp được người dùng chọn qua HTML file input có thông báo khả năng thiết bị; không tự giả lập hợp đồng SDK file-picker chưa đối chiếu. Upload là thao tác chủ động, tự yêu cầu AV sau upload thành công nhưng giữ đúng trạng thái cách ly khi scanner chưa sẵn sàng. Chưa quét sạch không xuất hiện nút trích xuất hoặc tải. Kết quả trích xuất chỉ lưu các trường khách chọn sau đối chiếu; chưa sửa bản khai. Chuyển sang vùng điền mẫu cần thao tác riêng. Chọn/quyết định đối tượng chính sách, chữ ký và xác nhận của cơ quan không tự sinh.

Tải tệp đi qua API có Bearer của chính phiên hiện tại, chỉ nhận MIME allowlist và stream tối đa 21 MiB. Client giữ tối đa một object URL đang hiển thị; đổi tệp, rời workspace hoặc đóng phiên sẽ thu hồi URL. Không đưa token vào URL tải. Nếu trình duyệt trong Zalo không hỗ trợ tải/xem tệp blob, có hướng dẫn dùng cổng web, không tuyên bố đã tải thành công chỉ vì API trả bytes.

Đăng xuất thu hồi cả phiên Mini App và phiên phone OTP tạm dùng để liên kết. Handoff liên kết thành công thu hồi phiên phone tạm trước khi cấp phiên Mini App mới; không thu hồi một phiên web khác không thuộc adapter. Đóng phiên xóa dữ liệu giao diện ngay, abort request đang chạy, chặn kết quả cũ hiện lại sau logout. Lỗi mạng khi thu hồi được báo rõ và local memory vẫn bị xóa.

Kiểm tra bổ sung: Mini App **15 test PASS** trong hai file adapter/vòng đời, cùng ESLint và typecheck/production Vite build. Bao phủ hủy liên kết/handoff/logout thu hồi phone session, yêu cầu OTP lặp hoặc đồng thời, giữ phiên để thử thu hồi lại khi máy chủ lỗi, chặn exchange sau hủy, endpoint owner/If-Match, MIME tải, abort request private và kết quả SDK đến muộn sau khi đóng giao diện.

`apps/api/src/miniapp-journey.test.ts` có **5 test HTTP PASS**, nạp trực tiếp adapter Mini App và gọi AppModule qua HTTP loopback với CORS/PrivacyGuard/controller/service thực. Dữ liệu là persona giả lập; chỉ mock nhà cung cấp Zalo/OTP/OpenAI, storage và AV. Kiểm tra nối lại đúng hồ sơ web, preflight origin chính xác, lưu/xung đột bản khai, từ chối owner khác và cùng owner nhưng khác dossier, upload cách ly → quét sạch → tải, đồng ý AI riêng từng tệp → chấp nhận riêng trường, mapping duyệt độc lập → PDF nháp → xác nhận trường → ZIP thực, vô hiệu hóa bộ cũ sau sửa bản khai, rút consent vẫn đọc/tải riêng tư và đồng ý lại rõ ràng. Không có cuộc gọi provider thật.

Refresh chứng cứ giữ nguyên nội dung đang sửa **và phiên bản gốc dùng cho If-Match**; không lấy phiên bản mới trên web để vô tình ghi đè bằng bản nháp cũ. Phản hồi của dossier/vòng đời cũ bị loại, thao tác lặp bị chặn trước render, mẫu thu hồi được bỏ chọn, các checkbox consent được đặt lại theo thông báo và trạng thái xử lý. Upload dựa trên lượt quét tự động tại API; chỉ retry thủ công khi vẫn cách ly, không gọi AV thêm một lượt mặc định.

Các kiểm thử này chưa thay cho QA tất cả thao tác SDK/chọn tệp/blob trong Zalo thật trên Android/iOS hoặc nghiệm thu App/OA.
