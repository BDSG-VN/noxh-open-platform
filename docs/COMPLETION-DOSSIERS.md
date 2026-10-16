# Hồ sơ và checklist chuẩn bị — phần triển khai hoàn thiện

Cập nhật 2026-10-16. Phạm vi này đo **mức độ chuẩn bị**, không xác định điều kiện hưởng chính sách, không kiểm định danh tính/giấy tờ và không can thiệp thứ tự hoặc kết quả bốc thăm.

## Đánh giá bằng chứng cứ thực

`preparation-v2` thay hai mục `documents/forms=false` cố định. Trọng số kỹ thuật giữ nguyên: khai báo 25, giấy tờ 35, kiểm tra nội bộ 20, PDF 20; đây không phải công thức pháp luật. Hàm thuần `preparationReadiness` trong contracts nhận bản khai, ngày đối chiếu và chứng cứ do máy chủ truy vấn, trả điểm từng nhóm, việc còn thiếu, mã/lời giải thích và tham chiếu chứng cứ.

Máy chủ luôn xác thực chủ hồ sơ trước, rồi lọc theo **tổ chức + dự án + hồ sơ + người sở hữu**. Không nhận danh sách chứng cứ hoặc điểm từ trình duyệt.

- Giấy tờ chỉ tính chuẩn bị khi chưa rút/xóa mềm, `scan_status=clean` và có `scanned_at`. Loại giấy tờ là nhãn do người tải tự khai. Tệp cách ly, bị từ chối hoặc thiếu dấu vết quét chưa tính. **Quét an toàn không chứng minh ảnh CCCD là danh tính thật, nội dung đúng hay xác nhận hợp lệ.**
- PDF chỉ tính khi `confirmed` và có thời điểm xác nhận, đúng `input_version` hiện tại của bản khai; ánh xạ và hướng dẫn nguồn cùng dự án đang được duyệt, trong thời hạn, chưa bị thay thế/thu hồi. Hash nguồn ở cả ánh xạ/hướng dẫn phải khớp tệp nguồn đã được kiểm chứng trong registry. Mỗi phản hồi kiểm tra bytes nguồn; không dùng tên tệp làm chứng minh.
- Đổi bản khai khiến PDF cũ không còn hoàn thành mục; tài liệu gốc vẫn giữ để đối chiếu. Duyệt một ánh xạ/hướng dẫn phiên bản mới có hiệu lực cũng làm PDF cũ mất tính hiện hành cho lần đánh giá mới.
- Khóa đọc dự án trước hồ sơ, rồi chứng cứ giữ nhất quán với thay đổi bản khai, duyệt mẫu và rút tệp trong giao dịch. Bản đánh giá lưu bất biến trong `readiness_assessments`, gồm phiên bản đầu vào, engine, checklist, ID/hash/phiên bản chứng cứ và lý do. Cột `checklist_version` dùng `<checklist UUID>:<version>` khi có hướng dẫn dự án, hoặc `preparation-v2` cho mục chung. Không sửa kết quả lịch sử khi mẫu hết hiệu lực sau đó.

Điểm 100 chỉ nghĩa hoàn thành checklist đang hiển thị. Chưa có checklist dự án được duyệt thì chế độ chung chỉ yêu cầu ít nhất một giấy tờ sạch và một PDF hiện hành; **không được mô tả là đủ bộ hồ sơ pháp lý**. API tiếp nhận, xét duyệt, phân căn và bốc thăm không sử dụng điểm này làm điều kiện chặn hoặc xếp hạng.

## Checklist cấu hình, phiên bản và duyệt độc lập

Migration `015_checklists.sql` tạo `project_preparation_checklists`. Hướng dẫn chỉ ở cấp chuẩn bị chung của dự án, không chứa công thức thu nhập, ưu tiên hay quyết định pháp lý theo nhóm/hình thức giao dịch. Cấu hình gồm tên, phạm vi/hướng dẫn, nguồn đối chiếu, ngày hiệu lực, nhóm giấy tờ và ID mẫu từ registry. Không cho chèn quy tắc thực thi, JavaScript, SQL hoặc điều kiện phân loại con người.

- Tạo bản nháp mới mỗi lần lưu; payload/hash/ngày hiệu lực/phiên bản không sửa hoặc xóa.
- Quản trị tổ chức hoặc nhân viên có `form_legal_editor` và quyền dự án đang còn hiệu lực được soạn. Nhân viên có `form_legal_approver` được xem để rà soát; duyệt/thu hồi luôn cần quyền này, khác người soạn và xác nhận rõ ràng.
- Quyền nhân viên được đọc lại từ DB và ràng buộc dự án; không tin danh sách dự án hoặc quyền cũ từ trình duyệt.
- Phiên bản được quyết định mới nhất và đã đến ngày hiệu lực được chọn. Nếu bản này hết hạn/thu hồi thì trạng thái `unavailable`, không tự lùi về bản cũ hay chế độ chung để tăng điểm. Bản nháp hoặc bản chưa tới ngày hiệu lực chưa thay bản đang dùng. Duyệt một bản thấp hơn phiên bản đã được quyết định bị từ chối.
- Tác vụ soạn/duyệt/thu hồi và đánh giá đều ghi audit. Không tự tạo bản checklist được duyệt hoặc nguồn pháp lý giả trong fixture phát hành.

Các route trong `DossierController` (root tích hợp BFF/OpenAPI):

| Phương thức | Route sau `/api/v1/`                                            | Nội dung                                                                             |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| GET         | `dossiers/:id/checklist`                                        | Đánh giá hiện tại, chỉ chủ hồ sơ                                                     |
| POST        | `dossiers/:id/readiness`                                        | Lưu đánh giá bất biến, `If-Match` bản khai và consent xử lý hiện hành                |
| GET         | `admin/projects/:id/preparation-checklists`                     | Lịch sử cấu hình trong phạm vi nhân sự                                               |
| POST        | `admin/projects/:id/preparation-checklists`                     | Bản nháp theo `PreparationChecklistSchema`                                           |
| POST        | `admin/projects/:id/preparation-checklists/:checklistId/review` | `{action: approve hoặc revoke, accepted: true}`; kiểm tra trạng thái trong giao dịch |

## Giao diện

`PreparationChecklistAdmin({projects, staff?})` cung cấp form soạn, danh mục giấy tờ/mẫu thực, lịch sử, sao chép thành phiên bản mới, xác nhận duyệt/thu hồi riêng. Không có trình sửa JSON hoặc nút tự duyệt bản của mình.

Citizen workbench hiển thị hướng dẫn áp dụng, phiên bản, nguồn/thời hạn, lý do từng việc và liên kết tải chứng cứ qua endpoint có xác thực. Tải/quét/rút tệp, tạo/kiểm tra PDF sẽ cập nhật checklist. Có nút cập nhật riêng. Không ghi đè thay đổi chưa lưu khi tải dữ liệu mới; nếu bản khai máy chủ đổi thì báo cần đối chiếu. Không cho tạo/xác nhận PDF khi còn bản khai chưa lưu.

## Kiểm tra và giới hạn nghiệm thu

Đã chạy các kiểm thử có fixture **giả lập** bằng PGlite và hàm contracts, không gọi OpenAI/Zalo/cơ quan nhà nước:

- `pnpm --filter @noxh/api exec vitest run src/dossier.test.ts`: 15 kiểm thử qua, gồm 6 kiểm thử mới cho chứng cứ thật ở DB, cách ly/rút tệp, PDF lỗi thời/thu hồi/thay thế/hash nguồn sai, ngăn truy cập khác chủ/hồ sơ/dự án, checklist bất biến/duyệt độc lập/hết hạn/thu hồi và đọc lại quyền dự án.
- `pnpm --filter @noxh/contracts exec vitest run src/dossier.test.ts`: 4 kiểm thử qua, gồm xác định điểm/lý do/chứng cứ/phiên bản, không đánh đồng AV với danh tính và fail-closed khi checklist không còn hiệu lực.
- Typecheck API, citizen và investor; ESLint các file thuộc slice: qua tại lượt kiểm tra này. Root chạy lại kiểm tra tích hợp khi các agent ngừng sửa.

Kiểm thử đánh giá dùng bản ghi chứng cứ giả lập trong DB để kiểm các điều kiện, không phải bằng chứng đã quét malware, render PDF hoặc duyệt pháp chế thật. Quy trình AV/render đã có kiểm thử riêng trong các service tương ứng. Chưa nghiệm thu thao tác trình duyệt đối với component mới ở lượt này; cần root tích hợp tab/BFF rồi QA giao diện.

Còn cần pháp chế cấu hình danh mục riêng theo từng nhóm, mua/thuê mua/thuê, địa phương và đợt tiếp nhận trước áp dụng nghiệp vụ pháp lý. Không có phiên bản checklist pháp lý được tự phê duyệt trong thay đổi này. Không bổ sung quyết định AI, nhận diện danh tính từ ảnh, xác nhận/đóng dấu hay tự nộp hồ sơ qua cổng nhà nước.
