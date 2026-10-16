# Hợp đồng nghĩa vụ thu và bàn giao diễn tập

Phần mở rộng ngày 16/10/2026. Migration `016_tenancy.sql`, `TenancyService`, `TenancyController`, component `TenancyAdmin` và `TenancyCustomer` tạo một luồng có persistence, không thay hợp đồng ký hoặc phần mềm kế toán pháp định.

## Luồng đã có

Chủ đầu tư chọn hồ sơ **synthetic đã duyệt** và căn đúng dự án, nhập hình thức khớp snapshot hồ sơ, điều khoản/căn cứ/hash chứng cứ, ngày đầu–cuối và từng kỳ nghĩa vụ. Mua cần allocation hiện hữu đúng hồ sơ và tổng lịch thu khớp nguyên giá snapshot đã phân, giữ nguyên chứng cứ phương án giá; thuê/thuê mua không dùng căn có allocation mua. Không có lãi suất, thuế, phí hoặc mức giá pháp luật mặc định. Tổng lịch tính bằng `BigInt`, mỗi số tiền truyền dưới dạng chuỗi nguyên, lưu `numeric(30,0)`. Ngưỡng cần đối soát trước bàn giao là số tiền được dự án nêu tường minh, không được vượt tổng.

Người có quyền pháp lý khác người lập duyệt dự thảo. Khách đọc điều khoản và lịch thu rồi xác nhận **đã xem bản diễn tập**, không tạo chữ ký hoặc dấu. Nhân viên lập khoản thu giả lập theo kỳ và chứng cứ. Người có `finance_post` đang hoạt động ở đúng dự án, khác người lập, chấp nhận hoặc từ chối đối soát. Nhận tiền thật, callback ngân hàng, ERP và hóa đơn điện tử chưa được triển khai.

Đề nghị bàn giao/gia hạn/chấm dứt/nhận lại căn cần khách xác nhận và một nhân viên khác duyệt. Phê duyệt bị chặn nếu hợp đồng đã thay đổi từ khi lập đề nghị. Gia hạn chỉ cho thuê/thuê mua, thêm kỳ sau thời hạn cũ; không thay kỳ và điều khoản gốc. Bàn giao kiểm tra khoản đã đối soát >= ngưỡng dự thảo. Chấm dứt và nhận lại ở bản này chỉ khi toàn bộ lịch nghĩa vụ đã đối soát; **không khẳng định mọi khoản tương lai đều đến hạn theo luật**. Trường hợp thương lượng xóa/điều chỉnh/hoàn tiền chưa có phải dừng xử lý để mở rộng quy trình, không sửa/xóa sổ.

Chấm dứt chưa giải phóng căn. Trả căn thuê/thuê mua được khách xác nhận và người khác duyệt mới giải phóng reservation để hồ sơ hợp lệ tiếp theo lập dự thảo mới. Allocation mua bất biến không bị xóa và không được tái cấp bằng luồng trả căn này.

## Bất biến và phân quyền

- Nội dung điều khoản, căn cứ, hash nguồn và tham chiếu khách được mã hóa AES-GCM theo contract ID/tổ chức; tham chiếu khoản thu mã hóa và HMAC để chống ghi lặp, không ghi vào audit nội dung.
- Scope tổ chức/dự án kiểm tra máy chủ, nhân viên đọc lại trạng thái/grants và giao với scope phiên. Khách chỉ đọc hợp đồng của chính mình; không chấp nhận owner ID tự khai.
- `form_legal_approver` ký trong phiên cho duyệt hợp đồng, tác giả không tự duyệt. Lập hợp đồng dùng `records_write`, xem dùng `records_read` hoặc `finance_read`, đề nghị dùng `records_write`, duyệt đề nghị dùng `records_review`. Org admin quản trị quy trình; vẫn không tự duyệt bản mình lập. Tạo khoản thu dùng `finance_write`; đối soát bắt buộc grant `finance_post` trong employee/project đang hoạt động, cả org admin cũng cần grant.
- Căn được khóa hàng; partial unique index giữ một hợp đồng chưa giải phóng/căn và một/hồ sơ. Trigger ở `inventory_allocations` chặn đường allocate cũ chiếm căn đã được hợp đồng khác giữ. Cấp căn thuê không chạy ngẫu nhiên hoặc tự cấp quyền hợp pháp; đây chỉ là reservation diễn tập do admin lập từ hồ sơ được duyệt.
- Đổi trạng thái dùng If-Match; draft/payment/action có UUID idempotency key và hash nội dung; trùng key khác nội dung bị409. Nhiều khoản pending không được vượt số dư kỳ. Bản snapshot/lịch thu cũ không sửa/xóa; gia hạn thêm chứng cứ và kỳ mới.
- Đồng ý xử lý dữ liệu được kiểm khi tạo dự thảo và khách xác nhận; khóa privacy tổ chức đồng bộ với rút/hạn chế. Khách vẫn đọc được lịch sử của mình. Các bước nội bộ giữ chứng cứ theo phạm vi được ủy quyền; chính sách lưu/xóa pháp lý và runtime DB tối thiểu vẫn cần nghiệm thu riêng.

## API và tích hợp

Prefix `api/v1/admin/tenancy/projects/:project`: `GET /options`, `GET|POST /contracts`, `GET /contracts/:id`, `POST /contracts/:id/review`, `POST /contracts/:id/payments`, `POST /payments/:id/review`, `POST /contracts/:id/actions`, `POST /actions/:id/review`.

Prefix `api/v1/citizen/tenancy`: `GET /contracts`, `GET /contracts/:id`, `POST /contracts/:id/confirm`, `POST /actions/:id/confirm`. Header If-Match là version hợp đồng khi lập khoản thu/đề nghị/xác nhận hợp đồng, version khoản thu khi duyệt khoản, version đề nghị khi xác nhận/duyệt đề nghị. Các body strict nằm ở `packages/contracts/src/tenancy.ts`.

Root tích hợp module/controller vào app, contracts index, BFF và trang dashboard; OpenAPI và ma trận trạng thái do root quản lý. Các component mới nhận route BFF `/api/admin/tenancy/...` và `/api/citizen/tenancy/...`. Sau thay đổi cần giữ schema đúng với UI và API.

## Kiểm tra và giới hạn

`pnpm --filter @noxh/api exec vitest run src/tenancy.test.ts`: PGlite chạy SQL migration và luồng thuê diễn tập thực thi trong DB tạm, số tiền vượt safe integer JS, hai gửi lặp, SoD, owner/project/org denial, phê duyệt/bàn giao/gia hạn/quyết toán/chấm dứt/trả căn/cấp mới và lịch sử không xóa; thêm nhánh thuê mua, nguồn allocation mua đúng hồ sơ/giá và chặn allocate cũ chiếm căn thuê. Đây không thay kiểm thử cạnh tranh đa tiến trình PostgreSQL, chữ ký số, cơ quan nhà nước, giao dịch tiền hoặc pháp lý dự án thật.

Còn thiếu: contract/PDF template mapping được duyệt, giá thuê/thuê mua theo công thức pháp lý của dự án, quy tắc lựa chọn căn thuê có giám sát, hoàn tiền/điều chỉnh giảm/cancel future dues, e-sign/ERP/e-invoice/payment provider, outbox thông báo, thu hồi nhân sự giữa nhiều phiên và runtime least privilege đầy đủ. Không mở production bằng cách bỏ literal synthetic hoặc sửa nhãn giao diện.
