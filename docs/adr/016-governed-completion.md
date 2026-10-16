# ADR 016 — Hoàn thiện các luồng có chứng cứ và giữ giới hạn phát hành

Ngày: 2026-10-16 · Chấp nhận cho triển khai phát triển.

## Bối cảnh

Một trang quản trị hoặc một trạng thái thành công chưa đủ chứng minh yêu cầu nghiệp vụ đã được thực hiện. Các bước hồ sơ, mẫu, phân căn, hợp đồng, vận hành và AI cần ràng buộc cùng phiên bản, đúng người và chứng cứ, đồng thời vẫn phải hoạt động khi không có nhà cung cấp bên ngoài.

## Quyết định

- Checklist tính lại bằng chứng cứ hiện hành, không chấm điểm bằng LLM. Checklist riêng dự án cần duyệt độc lập; thiếu cấu hình hợp lệ phải được hiển thị, không âm thầm dùng phiên bản cũ.
- Tri thức dự án là nội dung mã hóa, có revision, nguồn và phạm vi áp dụng; không dùng wiki hạn chế hoặc hồ sơ người khác làm ngữ cảnh chung. AI tạo đề xuất, máy chủ áp dụng sau xác nhận riêng và kiểm lại phiên bản/quyền.
- Hợp đồng, kỳ thu và các trạng thái bàn giao/gia hạn/chấm dứt/trả căn được quản lý bằng giao dịch, số nguyên chính xác, người lập khác người duyệt và xác nhận của khách. Luồng hiện chỉ diễn tập, không tự trở thành chữ ký, hóa đơn hoặc giao dịch tiền thật.
- Checkpoint audit được ký ngoại tuyến Ed25519 với public key gắn tổ chức, signer và khoảng hiệu lực do người vận hành pin trước. Rust kiểm từng đoạn có anchor, đích và sequence digest; một prefix hợp lệ không được coi là đủ chuỗi. API không giữ private key.
- Tách bằng chứng triển khai khỏi bằng chứng kinh doanh/pháp lý. Kiểm bản phát triển, kiểm provider thật, kiểm độc lập và ký pilot là các điều kiện khác nhau. Các API chưa được cấp quyền không được giả làm đồng bộ chính thức.

## Hệ quả

Mã lõi vẫn MIT, vận hành BDSG Housing và tài liệu Lam Sơn riêng nằm ngoài kho công khai. Migration thêm mới phải được sao lưu/kiểm checksum, không hạ phiên bản bằng xóa dữ liệu. Mặc định không mở tiếp nhận thật, AI bên ngoài, bốc thăm thật hoặc giao dịch thanh toán thật. Hướng dẫn và kết quả kiểm từng phần nằm tại `COMPLETION-DOSSIERS.md`, `COMPLETION-AI.md`, `COMPLETION-TENANCY.md`, `COMPLETION-OPERATIONS.md` và `VALIDATION.md`.
