# Kho nguồn NOXH — rà soát ngày 16/10/2026

Nguồn trung ương và mẫu trích nguyên trang phục vụ rà soát dự án. **Không phải xác nhận đã bao quát mọi văn bản, địa phương và đối tượng.** Mẫu chỉ hiện cho khách sau khi chủ đầu tư soạn hướng dẫn, người có quyền `form_legal_approver` khác người soạn duyệt, và đến ngày hiệu lực. Không có cơ chế AI tự duyệt pháp lý.

**Hiện có 10 PDF nguồn và 16 PDF mẫu trích.** Báo cáo đối chiếu, nguồn mới, khoảng trống nhóm 13/BCA và khác biệt nguồn vốn nằm tại [LEGAL-COVERAGE-20261016](../docs/LEGAL-COVERAGE-20261016.md). Không thay đổi quy tắc nghiệp vụ đang chạy.

## Nguồn chính đã lưu

| Văn bản                                  | Nội dung sử dụng                                                | Nguồn chính thức                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 79/VBHN-VPQH ngày 26/3/2026              | Luật Nhà ở 27/2023/QH15 và các sửa đổi được hợp nhất            | [Công báo Chính phủ](https://congbao.chinhphu.vn/van-ban/van-ban-hop-nhat-so-79-vbhn-vpqh-469209/63824.htm) |
| 24/VBHN-BXD ngày 18/5/2026               | NĐ 100/2024/NĐ-CP; sửa đổi bởi NĐ 261/2025, 54/2026 và 136/2026 | [Cổng Chính phủ](https://chinhphu.vn/?classid=0&docid=218177&pageid=27160)                                  |
| 17/VBHN-BXD ngày 24/3/2026               | TT 05/2024/TT-BXD; sửa đổi bởi TT 09/2025, 32/2025 và 08/2026   | [Bộ Xây dựng](https://moc.gov.vn/pl/pages/ChiTietVanBan.aspx?TypeVB=2&vID=647)                              |
| 08/2026/TT-BXD ngày 15/2/2026 và phụ lục | Mẫu 01, 02, 05 và hướng dẫn sửa đổi                             | [Bộ Xây dựng](https://moc.gov.vn/pl/Pages/ChiTietVanBan.aspx?TypeVB=1&vID=616)                              |

Văn bản hợp nhất giúp đọc các sửa đổi cùng nhau; không thay thế việc xác định hiệu lực từng quy phạm. `sources/manifest.json` lưu URL, SHA-256, ngày lấy và trạng thái nguồn. `catalog.json` lưu mã mẫu, trang gốc và hash mẫu trích. 15 PDF ban đầu được tách bằng `scripts/prepare-legal-forms.py` (Python + pypdf); mẫu BQP bổ sung dùng nguyên trang 5 của TT 94/2024 với xuất xứ trong catalog. Không chạy script cũ để ghi đè catalog mở rộng. Các mẫu trích không viết lại bố cục hoặc nội dung pháp lý. Giữ nguyên nguồn và xuất xứ khi phân phối; giấy phép MIT áp dụng mã phần mềm của dự án, không nhận quyền tác giả đối với văn bản nhà nước.

## Ma trận cần rà soát khi áp dụng

| Khoản Điều 76 | Chứng minh đối tượng / lưu ý                                                                                                                                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1             | Giấy tờ người có công, thân nhân liệt sĩ theo chế độ tương ứng; không tự tạo giấy xác nhận thay thế                                                                                                                                                                                                                    |
| 2, 3          | Hộ nghèo/cận nghèo nông thôn; chính sách, chương trình và điều kiện địa phương cần rà soát riêng                                                                                                                                                                                                                       |
| 4             | Hộ nghèo/cận nghèo đô thị; giấy tờ chứng minh theo chính sách tương ứng                                                                                                                                                                                                                                                |
| 5             | Thu nhập thấp đô thị: mẫu 01a khi có HĐLĐ / trường hợp hưởng lương hưu; mẫu 05 cho không có HĐLĐ, không hưởng lương hưu BHXH                                                                                                                                                                                           |
| 6             | Công nhân, người lao động: mẫu 01a; nhà lưu trú KCN có đơn riêng                                                                                                                                                                                                                                                       |
| 7             | Lực lượng vũ trang: thêm mẫu xác nhận đối tượng TT 94/2024/TT-BQP chờ duyệt, chỉ phạm vi BQP; BCA phải kiểm toàn văn TT 89/2026 trước phát hành. Chưa chứng nhận bộ chuyên ngành đầy đủ                                                                                                                                |
| 8             | Cán bộ, công chức, viên chức: mẫu 01a                                                                                                                                                                                                                                                                                  |
| 9             | Đã trả nhà công vụ: mẫu 01, xác nhận theo cơ quan có thẩm quyền                                                                                                                                                                                                                                                        |
| 10            | Thu hồi đất/giải tỏa, chưa được bồi thường nhà/đất ở: mẫu 01 và xác nhận trường hợp thực tế                                                                                                                                                                                                                            |
| 11            | Học sinh, sinh viên: mẫu 01; thuê trong thời gian học, không suy diễn thành quyền mua                                                                                                                                                                                                                                  |
| 12            | Doanh nghiệp, hợp tác xã, liên hiệp HTX trong KCN: phạm vi nhà lưu trú công nhân, không phải đơn cá nhân mua NOXH                                                                                                                                                                                                      |
| 13            | Người có từ hai con đẻ trở lên: bổ sung bởi Luật Dân số, hiệu lực từ 1/7/2026. **Chưa tự động chọn hoặc tạo mẫu**; xem vấn đề hướng dẫn còn đang được BXD/MOH xử lý trong [trả lời chính thức ngày 11/10/2026](https://chinhsachonline.chinhphu.vn/dieu-kien-mua-nha-o-xa-hoi-voi-nguoi-co-tu-2-con-tro-len-92439.htm) |

Với mua/thuê mua, rà soát giấy nhà ở (mẫu 02 hoặc 03), thu nhập và vợ/chồng theo trường hợp cụ thể. **Thuê không mặc nhiên cần toàn bộ điều kiện nhà ở/thu nhập của mua và thuê mua**; không biến các trường thu nhập trong giấy kết hợp thành điều kiện xét cho mọi người thuê. Không dùng bảng trên làm máy quyết định đủ điều kiện.

16 mẫu trong catalog gồm: 1 giấy xác nhận đối tượng TT 94/2024/TT-BQP (chờ duyệt chuyên ngành/dự án); 3 đơn tại phụ lục NĐ; 8 giấy chứng minh tại phụ lục I TT (01, 01a, 02–07); 3 mẫu hợp đồng mua/thuê mua/thuê tại phụ lục VI TT; 1 đơn thẩm định giá của chủ đầu tư. Mẫu 06–07 dành cho vay tự xây/cải tạo/sửa chữa, không đưa vào bộ mua nhà dự án một cách mặc định. Hợp đồng và thẩm định giá là tài liệu tham khảo cho giai đoạn riêng, chưa được trình soạn hướng dẫn cá nhân tự động chọn.

## Phạm vi chưa kết luận

- TT 94/2024/TT-BQP đã có bản gốc, mẫu trang 5 và hash. TT 56/2024/TT-BCA chỉ lưu nguồn lịch sử/chưa xác minh tình trạng hiện hành; đã có thông tin chính thức về TT 89/2026/TT-BCA nhưng chưa lấy được toàn văn gốc và mẫu mới để đối chiếu. Chưa công bố bộ chuyên ngành đầy đủ.
- Cơ chế thí điểm, giá, đất, vốn, phát triển dự án và quy định của từng tỉnh/thành: cần registry và quy trình rà soát riêng; không nằm trọn trong 16 mẫu này.
- Cổng Dịch vụ công có thể hiển thị mẫu/hướng dẫn khác thời điểm: đối chiếu nơi tiếp nhận, không để AI chọn nguồn cũ thay văn bản đã kiểm chứng.
- Chức năng tạo/điền hồ sơ trong phần mềm không thay thế xác nhận của cơ quan, ký số hợp lệ hoặc tiếp nhận qua cổng nhà nước. Việc tải mẫu không chứng nhận hồ sơ hợp lệ.

## Bản gốc bổ sung ngày 16/10/2026

- TT 94/2024/TT-BQP: ban hành 11/11/2024, hiệu lực 26/12/2024; mẫu xác nhận đối tượng được trích nguyên trang 5, giữ trạng thái chờ duyệt.
- NĐ 136/2026/NĐ-CP: ban hành/hiệu lực 7/4/2026; giữ bản gốc để đối chiếu điều kiện, chuyển tiếp và Mẫu 01 đã có ở nguồn hợp nhất.
- Luật Dân số 113/2025/QH15: hiệu lực chung 1/7/2026; Điều 29 khoản 3 liên quan nhóm 13 và ưu tiên.
- TT 56/2024/TT-BCA: bản gốc cũ lưu để tra cứu lịch sử; không đưa mẫu NOCA cũ vào catalog đang áp dụng.

URL chính thức, hash và trạng thái từng bản có trong `sources/manifest.json`. Nguồn chuyên ngành và thứ tự ưu tiên cần được rà soát trước từng cấu hình dự án; không tự coi bản hợp nhất là quy tắc mới nhất cho mọi thời điểm.
