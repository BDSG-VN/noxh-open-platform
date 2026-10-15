# Bảng hàng, phương án giá và phân căn

Ngày rà soát nguồn: 15/10/2026. Chức năng hiện chỉ chạy với dự án, hồ sơ và phiên bốc thăm **giả lập**. Không nhận đặt cọc hoặc lập hợp đồng.

## Phạm vi pháp lý

Nguồn chính: [VBHN 24/VBHN-BXD ngày 18/05/2026](https://moc.gov.vn/pl/pages/ChiTietVanBan.aspx?vID=680), [bản PDF Chính phủ](https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/24-vbhn-bxd.pdf), Điều 32 và Điều 35, trang in 25–29. Nguồn hợp nhất các Nghị định 100/2024, 261/2025, 54/2026 và 136/2026. Cần kiểm tra phạm vi đầu tư và cơ chế đặc thù của từng dự án trước áp dụng.

Điều 32 dùng hệ số vị trí theo nguyên tắc bình quân gia quyền theo diện tích bằng 1 cho từng khối nhà. Công cụ nhận **giá bình quân đồng/m² có căn cứ**, đã gồm GTGT, chưa gồm kinh phí bảo trì, rồi phân bổ theo trọng số. Nó không tự suy ra chi phí được phép đưa vào giá, lợi nhuận, ưu đãi hoặc phê duyệt giá thay cơ quan có thẩm quyền. Quy trình nội bộ hai người kiểm tra không thay văn bản thẩm định, ban hành và công bố giá theo cơ chế pháp luật áp dụng. Trường hợp giá trúng đấu thầu, cơ chế thí điểm, hồ sơ quá hạn và điều chỉnh sau kiểm toán cần pháp chế đánh giá riêng; hệ thống không tự kết luận được miễn thủ tục.

Mô hình này hiện áp dụng **giá bán**. Thuê và thuê mua có công thức/phạm vi riêng, không được áp lại công thức mua; API từ chối gắn hồ sơ thuê hoặc thuê mua vào bảng này. Không có hệ số tầng, hướng, căn góc hoặc thuế/phí mặc định được gán là mức pháp luật bắt buộc.

## Cách tính và chứng cứ

Diện tích lưu bằng số nguyên cm²; giá đồng/m² nhập bằng chuỗi số nguyên; trọng số dương là tỷ lệ tương đối do dự án đề xuất. Với mỗi tòa, đặt `S = Σ diện tích` và `W = Σ (diện tích × trọng số)`. Hệ số căn i được lưu dưới dạng phân số chính xác `Ki = trọng số_i × S / W`. Vì vậy `Σ (diện tích_i × Ki) / S = 1` chính xác, không phụ thuộc số chữ số hiển thị.

Tổng giá căn bằng `giá bình quân × diện tích_cm² / 10000 × Ki`. API bắt buộc gọi chương trình Rust `pricing-engine` để lập phương án; không có nhánh tính giá dự phòng bằng TypeScript khi chương trình thiếu hoặc lỗi. Tử số và mẫu số dùng `u128` với mọi phép cộng/nhân có kiểm tra tràn số; tiền không dùng số thực. Tổng giá cuối cùng làm tròn đến đồng gần nhất, đúng nửa đồng làm tròn lên; quy tắc này là lựa chọn kỹ thuật được nêu trong phương án để người kiểm tra chấp thuận. Phần hệ số và đơn giá vẫn lưu phân số nguyên vẹn, nên có thể đối soát chênh lệch làm tròn. API đối chiếu cấu trúc, tập căn, thứ tự, phân số và phép làm tròn trước khi lưu bằng chứng; kết quả lỗi bị từ chối, không chuyển sang bộ tính khác.

Hợp đồng đầu vào Rust là JSON `{units,baseVndPerM2}`, đầu ra là mảng `PriceQuote` với các trường tiền/phân số ở dạng chuỗi số nguyên thập phân. Tối đa 500 căn, diện tích mỗi căn tối đa `10^8 cm²`, trọng số tối đa `10^6`, giá bình quân nhỏ hơn `10^11 đồng/m²`. Trung gian lớn nhất `2 × raw + divisor < 1,01 × 10^36`, nhỏ hơn giới hạn `u128 > 3,4 × 10^38`; vượt bất kỳ giới hạn nào bị từ chối. Mã căn `[A-Z0-9-]` được sắp xếp ASCII rõ ràng, không phụ thuộc locale máy chủ. Bộ tham chiếu TypeScript dùng BigInt để kiểm thử đối chiếu; các phương án và mã băm đã lưu không bị viết lại khi đổi bộ xử lý.

Triển khai cần `PRICING_ENGINE_BIN` là đường dẫn tuyệt đối đến chương trình Rust (mặc định `/opt/noxh/bin/pricing-engine`). Chạy `pnpm native:build` trước kiểm thử và chạy ứng dụng. `apps/api/src/pricing-rust.test.ts` bắt buộc gọi chương trình đã biên dịch, đối chiếu 40 bộ dữ liệu nhiều tòa, biên 500 căn, giá vượt số nguyên an toàn JavaScript, quy tắc nửa đồng và chuẩn hóa Unicode; không tự bỏ qua nếu thiếu chương trình.

Bảng hàng có tòa/tầng/vị trí/diện tích/loại/hướng/trọng số. Giao diện dựng **sơ đồ ô lưới** từ khai báo, không tự nhận là mặt bằng đo đạc. CSV tối đa 500 căn. Mã căn và vị trí trong tầng phải duy nhất. Khi phương án đầu tiên đã lập, không sửa bảng nguồn để tránh thay diện tích/hệ số đằng sau phiên bản giá đã duyệt. Có thể lập thêm phương án giá bất biến trước khi kích hoạt phân căn; thay cấu trúc bảng đã khóa cần quy trình phiên bản mở rộng tiếp theo.

Mỗi phương án có cấu hình, giá từng căn, phiên bản bảng nguồn, SHA-256 toàn bộ snapshot, căn cứ, hash tài liệu, hiệu lực và người lập. Người duyệt phải khác người lập và có quyền riêng `price_approver` trong phiên đã xác minh. Quyết định duyệt là cuối cùng; tạo phiên bản mới để sửa. Chứng cứ phân căn chứa nguyên giá, mã phương án và hash tại thời điểm xác nhận, không thay khi giá khác xuất hiện.

## Phương thức và điều kiện truy cập

- **Tắt:** chưa mở chọn căn.
- **Chọn theo thứ tự:** thứ tự lấy từ kết quả chọn người đã công bố. Chỉ người có lượt thấp nhất chưa được phân căn và còn quyền mới xác nhận được căn còn lại.
- **Phân ngẫu nhiên đã công bố:** dùng đúng căn được thuật toán bốc thăm phân căn gán trước đó; bấm xác nhận không sinh ngẫu nhiên mới hoặc cho phép quay lại.

Giá và quy chế phải được duyệt độc lập. Quy chế, phương thức, phiên bốc thăm và phương án giá khóa sau lần kích hoạt đầu tiên. Chủ đầu tư được tạm dừng/tiếp tục, không đổi phương thức giữa chừng. Tất cả mã được chọn phải được gắn trước khi mở; không thể bỏ sót người có lượt đầu để cho người sau chọn.

Mỗi mã công khai phải khớp `applications.public_code` đã được hệ thống sinh; ứng dụng phải có trạng thái `approved`, đúng tổ chức/dự án/hồ sơ/chủ sở hữu và là dữ liệu giả lập. API kiểm tra lại điều kiện trước khi kích hoạt, xem bảng riêng và phân căn. Khách không tự nhập mã công khai để chiếm lượt. Mã công khai không chứa số điện thoại hoặc nội dung giấy tờ. Danh sách công khai của bốc thăm không trả liên kết tới chủ sở hữu riêng.

Thu hồi lượt trước khi phân căn cần người có quyền duyệt giá khác người đã gắn danh sách, lý do mã hóa và nhật ký. Một căn đã phân không được xóa/sửa ngầm. Quy trình hủy, khiếu nại, chuyển suất sau phân căn hoặc hồ sơ vắng mặt cần mở rộng nghiệp vụ được duyệt; không có bộ đếm giữ chỗ tự động hoặc thời hạn giả định làm mất lượt.

## Đồng thời và kiểm thử

Giao dịch khóa dự án/quy chế, lượt và căn; ràng buộc duy nhất ngăn hai người nhận một căn hoặc một lượt nhận hai căn. Khóa chống ghi lặp có hash nội dung, trả lại cùng kết quả khi gửi lại đúng yêu cầu; thay nội dung cùng khóa bị từ chối. Phiên bản If-Match ngăn xác nhận vào cấu hình cũ. Tạm dừng, thu hồi và hủy phiên bốc thăm đều được kiểm tra trên máy chủ. Các thao tác phát sinh nhật ký trong cùng giao dịch.

`apps/api/src/inventory.test.ts` kiểm tra phép tính chính xác theo từng tòa, biên số lớn, phạm vi tổ chức, người duyệt độc lập, bản ghi bất biến, thứ tự, đầy đủ danh sách, ghi lặp đồng thời, căn trùng, phương thức ngẫu nhiên không quay lại, tạm dừng, thu hồi và phiên bốc thăm đã hủy. PGlite chạy PostgreSQL/WASM thực tế cho các ràng buộc và trigger; đây không thay kiểm thử tải/cạnh tranh nhiều tiến trình với PostgreSQL triển khai thật.

Vận hành thật còn cần kiểm toán độc lập thuật toán/bằng chứng, rà soát pháp lý quy chế, ma trận quyền, thiết bị và nguồn ngẫu nhiên, hạ tầng giám sát, khả năng truy cập, xử lý khiếu nại và phương án khôi phục. Cờ giả lập không được dùng để vượt các điều kiện này.
