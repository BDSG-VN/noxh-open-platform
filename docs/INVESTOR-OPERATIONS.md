# Điều hành nội bộ chủ đầu tư

Phân hệ hỗ trợ lập kế hoạch, quản lý nhân sự/phạm vi, wiki, hồ sơ phiên bản và bút toán quản trị. Đây là công cụ điều hành; không phải xác nhận đã đáp ứng tất cả điều kiện pháp luật của một dự án, hệ thống kế toán pháp định hoặc kết nối gửi hồ sơ thật cho cơ quan.

## Nhân sự và phân quyền

Quản trị tổ chức tạo danh tính trong Keycloak, gán `noxh_staff`, yêu cầu TOTP, rồi đăng ký chính xác subject vào danh sách nhân viên. Ứng dụng không tạo/lưu mật khẩu, không cấp role `org_admin` và không thay đổi tài khoản quản trị Keycloak. Vì không có thao tác xóa/hạ quyền quản trị tổ chức trong phân hệ này, việc bảo đảm quản trị cuối cùng thuộc cơ chế quản trị của Keycloak.

Phòng ban: ban quản lý dự án, kế toán, hành chính, pháp chế, kinh doanh. Tên phòng ban không tự cấp quyền. Quản trị chọn từng quyền đọc/ghi/duyệt và từng dự án; tạm dừng tài khoản hoặc bỏ grant có hiệu lực ở yêu cầu tiếp theo, không đợi JWT hết hạn. Quyền xét duyệt hồ sơ chuyên biệt vẫn cần realm role được ký từ Keycloak. Nhân viên không được sửa quyền nhân sự, cấu hình khóa AI/Zalo, công khai dự án hoặc truy cập các endpoint quản trị cũ.

`WorkforceAccessGuard` chặn mặc định toàn bộ đường dẫn quản trị cũ đối với `noxh_staff`; chỉ mở `me`, `logout`, các endpoint operations và applications có kiểm tra riêng. `OperationsService` kiểm tra membership đang hoạt động, quyền cụ thể và grant dự án trong giao dịch. Khoá chia sẻ giữ scope ổn định trong lúc ghi, thao tác đổi grant chờ giao dịch đang thực hiện kết thúc. Không có quyền xuyên tổ chức/dự án từ UUID do trình duyệt tự gửi.

## Giai đoạn dự án

Mẫu kế hoạch `investor-planning-v1` có 14 công việc, nhóm thành các giai đoạn: nhánh đầu tư/lựa chọn chủ đầu tư; đất đai/quy hoạch; thiết kế/thủ tục xây dựng; thi công/chất lượng; giá/điều kiện kinh doanh; công bố/tiếp nhận; đối chiếu/lựa chọn; hợp đồng/thanh toán/nghiệm thu/bàn giao; vận hành/bảo hành/lưu trữ. Các công việc có thể song song khi không có phụ thuộc. Đây là mẫu checklist cần rà soát theo loại vốn, quỹ đất, địa phương, thời điểm và trường hợp chuyển tiếp; không áp đặt một thủ tục giống nhau cho mọi dự án.

Người khác người tạo phải ghi nhận rà soát pháp lý trước khi cập nhật. Công việc có điều kiện được đề nghị “không áp dụng” với căn cứ cụ thể và vẫn cần người khác duyệt. Các công việc khác không được bỏ qua. Hoàn tất cần chứng cứ tham chiếu, ngày, SHA-256 và các bước phụ thuộc đã được chốt; công việc bên ngoài cần thêm tên cơ quan/đơn vị ban hành. Người cập nhật không tự duyệt chứng cứ của mình. Các phiên bản trạng thái, nội dung mã hóa và người thao tác được lưu append-only trong `investor_task_history`; nhật ký audit chứa mã tài nguyên, không chứa nội dung chứng cứ.

Trạng thái “hoàn tất nội bộ” không có nghĩa cơ quan đã phê duyệt. Số văn bản/SHA do nhân sự nhập chỉ chứng minh rằng tổ chức ghi nhận một tham chiếu; phần mềm chưa xác thực chữ ký số, bản chính hoặc quyết định điện tử từ hệ thống cơ quan. Không tự gửi thông báo khách hàng hay hồ sơ cho Sở.

## Wiki và lưu trữ

Wiki/hồ sơ có nội dung mã hóa, SHA-256, mã tài liệu gốc và số phiên bản. Sửa tạo phiên bản mới; trigger DB cấm đổi payload/nội dung hay xóa phiên bản. Duyệt/thu hồi cần người khác người soạn. Phân loại “hạn chế” chỉ cho quản trị, tác giả, phòng pháp chế hoặc người được giao duyệt tài liệu trong phạm vi dự án. Mã tham chiếu/SHA của tệp là metadata; phân hệ này chưa tự tải hoặc lưu binary tệp. Bộ lưu trữ tài liệu khách hàng là luồng riêng.

Danh sách trả tối đa 200 mục; chưa có phân trang con trỏ, tìm kiếm toàn văn, quản lý phiên bản binary, ký số, lịch lưu/xóa tự động hoặc hệ thống giao nhận công văn. Không diễn giải nhãn “hồ sơ lưu trữ” là đã hoàn thành nghĩa vụ lưu trữ chuyên ngành.

## Sổ quản trị nội bộ

Chứng từ VND gồm ngày, diễn giải, tham chiếu và 2–100 dòng tài khoản. Mỗi dòng chỉ Nợ hoặc Có, số nguyên không âm; tổng Nợ phải bằng tổng Có và lớn hơn 0. Nháp bất biến sau tạo; người khác người lập có quyền `finance_post` mới ghi sổ. Trigger DB ngăn thay đổi/xóa bút toán đã ghi; điều chỉnh bằng chứng từ đối ứng có dẫn chiếu, không sửa lịch sử.

Đây chưa phải sổ cái pháp định: chưa có hệ thống tài khoản cấu hình theo chế độ doanh nghiệp, kỳ khóa sổ, ngân sách, công nợ/đối soát ngân hàng, bảng lương, hóa đơn điện tử, kê khai thuế hoặc báo cáo tài chính. Không gắn giao dịch thật hay tuyên bố đáp ứng chuẩn kế toán từ chứng từ quản trị này.

## Căn cứ để rà soát kế hoạch (kiểm tra ngày 15/10/2026)

- [Luật Xây dựng 135/2025/QH15, hiệu lực 01/07/2026](https://vanban.chinhphu.vn/?classid=1&docid=216514&orggroupid=1&pageid=27160): cần kiểm tra điều khoản áp dụng và chuyển tiếp của hồ sơ cụ thể.
- [Nghị định 192/2025/NĐ-CP](https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179217): cơ sở dữ liệu văn bản ghi hết hiệu lực một phần; không dùng bản gốc độc lập thay cho toàn bộ sửa đổi.
- [Nghị định 261/2025/NĐ-CP, bản ký chính thức](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/10/261nd.signed.pdf): sửa NĐ 100/2024 và NĐ 192/2025, có quy định chuyển tiếp và giới hạn thời gian áp dụng với một số điều.
- [Công bố của Chính phủ về Luật Đầu tư 143/2025/QH15 đã được sửa bởi Luật 24/2026/QH16](https://xaydungchinhsach.chinhphu.vn/danh-muc-nganh-nghe-dau-tu-kinh-doanh-co-dieu-kien-119260910153514547.htm): ghi nhận sự thay đổi văn bản; không thay việc pháp chế đọc toàn văn và thủ tục dự án.

Các quy định đất đai, môi trường, PCCC, đấu thầu/loại vốn, kinh doanh bất động sản, nghiệm thu, kế toán và quyết định phân cấp địa phương cần được bổ sung vào hồ sơ rà soát riêng. Mẫu không đặt hạn ngày pháp định tự động khi chưa có căn cứ được duyệt.
