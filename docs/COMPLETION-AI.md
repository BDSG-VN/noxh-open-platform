# Trợ lý dựa trên tri thức dự án và tạo PDF chờ xác nhận

Cập nhật 2026-10-16. Phần mềm phát triển, mặc định không kết nối OpenAI. Mã này không chứng nhận pháp lý hoặc tự kết luận điều kiện NOXH.

## Luồng đã triển khai

1. Nhân viên có quyền soạn tài liệu dự án, ghi nguồn cơ quan nhà nước, SHA-256 bản nguồn, điều khoản, hình thức/nhóm và ngày hiệu lực. Nội dung mã hóa, từng revision bất biến. Người khác có quyền pháp chế tại dự án mới được duyệt. URL/hash do người soạn cung cấp phải được người duyệt đối chiếu; máy chủ không tự tải hay xác nhận tính đúng của nội dung nguồn.
2. Khách chọn phạm vi tìm hiểu. Khi chưa xác định hình thức/nhóm, chỉ tri thức hướng dẫn chung được tìm kiếm; trợ lý không tự chọn nhóm pháp lý. Tìm kiếm từ khóa tiếng Việt có/không dấu, chia đoạn xác định, tối đa sáu đoạn mỗi lần; không dùng embedding ngoài máy.
3. Chỉ bản được duyệt, đang hiệu lực và mới nhất được đưa vào ngữ cảnh. Bản thu hồi/hết hạn/đổi phạm vi không làm bản cũ tự xuất hiện lại. Trước khi trả lời, kiểm lại trạng thái của các revision được lấy. Mã nguồn, revision và đoạn trích được trả riêng cho giao diện.
4. Các công cụ đọc mẫu/ánh xạ và đề xuất PDF bị lọc trên máy chủ theo chính hình thức/nhóm khách chọn. AI không được chọn dự án, tổ chức, người dùng hay giá trị điền mẫu.
5. Đề xuất PDF lấy giá trị cục bộ từ bản khai hiện tại và trích xuất đã được khách kiểm tra, cùng phiên bản, từ giấy tờ còn nguyên hash và quét sạch. Thông tin mâu thuẫn, trường thiếu và phần xác nhận cơ quan để trống với lý do. Dữ liệu điền không gửi ngược tới mô hình khi khách chưa chia sẻ bản khai.
6. Khách đọc tất cả giá trị và xác nhận riêng một lần. Kiểm lại quyền, đồng ý dữ liệu, phiên bản bản khai, phạm vi, hiệu lực mẫu/ánh xạ và giấy tờ. Tạo metadata PDF và tiêu thụ đề xuất trong cùng giao dịch; xác nhận lặp không tạo thêm PDF. PDF vẫn là bản nháp, cần đọc bản in và xác nhận từng trường trước khi tải bộ hồ sơ.

`FormService.generate` nhận giao dịch có sẵn để tránh giao dịch lồng khi AI xác nhận. Thứ tự khóa thống nhất: tổ chức/đồng ý → dự án → hồ sơ → mẫu tạo → giấy tờ. Không cấp cho mô hình công cụ shell, URL tùy ý, quyết định xét duyệt, nộp dịch vụ công, ký hoặc thanh toán.

## Kiểm thử và giới hạn

- `knowledge.test.ts`: mã hóa/bất biến; quyền duyệt đang hoạt động; đúng tổ chức/hồ sơ/hình thức/nhóm; hiệu lực/thu hồi/thay thế; tìm không dấu; mã trích nguồn giả và thu hồi giữa yêu cầu.
- `ai-form-action.test.ts`: backend tự điền, chừa ô xác nhận, không lộ giá trị sang mô hình, xác nhận đồng thời chỉ tạo một PDF; thông tin trích xuất mâu thuẫn/không còn sạch; bản khai lỗi thời và mapping thu hồi.
- `ai-review.test.ts`: kiểm độc lập quyền cấu hình, sai phạm vi mẫu, rút đồng ý trong lúc yêu cầu đang chạy và đổi phạm vi tri thức.

Đây là kiểm thử provider giả và PDF/kho lưu trữ cô lập. Chưa gọi OpenAI thật trong lượt kiểm; chủ đầu tư phải cấu hình model/key/quota và có cơ sở xử lý dữ liệu trước khi bật. Kiểm mã tham chiếu chỉ xác minh mã trỏ tới đoạn đã lấy, không chứng minh diễn giải của mô hình chính xác (`semanticClaimsVerified: false`). Cần đánh giá bằng bộ câu hỏi/giấy tờ pilot, độ chính xác trích xuất và kiểm tra diễn giải có người rà soát. Việc tải đủ giấy tờ không tự tạo xác nhận của cơ quan hoặc một hồ sơ chắc chắn được chấp thuận.

API thực hiện function calling qua Responses, schema strict, `store:false`, số vòng/công cụ/thời gian/kích thước/hạn mức có chặn. Tham chiếu triển khai: [OpenAI Docs — Function calling](https://developers.openai.com/api/docs/guides/function-calling), đọc 2026-10-16. Không thay model được chủ đầu tư cấu hình và không cần dịch vụ OpenAI để sử dụng luồng hồ sơ thủ công.
