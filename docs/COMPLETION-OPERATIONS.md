# Checkpoint nhật ký có chữ ký và kiểm chứng theo trang

Ngày triển khai mã nguồn: 16/10/2026. Phạm vi này bổ sung bằng chứng kiểm chứng nhật ký; không xác nhận hệ thống đã đáp ứng đầy đủ nghĩa vụ pháp lý, có kho lưu độc lập hoặc đã được kiểm toán an toàn.

## Phạm vi đã triển khai

- Đề nghị checkpoint bất biến, gắn toàn tổ chức và khóa công khai đã cấu hình; mã yêu cầu bảo đảm gửi lại không tạo đề nghị mới.
- Ký Ed25519 bằng công cụ ngoại tuyến. API và giao diện không nhận khóa bí mật.
- Nhập checkpoint chỉ khi chữ ký được kiểm bằng khóa đã ghim theo tổ chức và định danh người giữ khóa. Người lập đề nghị không được tự nhập checkpoint đó. Hai tài khoản khác nhau chưa chứng minh hai người thực tế độc lập.
- Mỗi checkpoint gắn checkpoint trước bằng hash; đề nghị cũ thuộc nhánh cạnh tranh không được nhập sau một mốc khác.
- Xác minh từ genesis tới đúng thứ tự, hash đầu cuối, tổng số sự kiện và dấu vết thứ tự đã ký. Một đoạn có hash hợp lệ không được coi là nhật ký đầy đủ.
- Rust thực hiện kiểm chứng từng trang; API không có nhánh dự phòng JavaScript khi binary thiếu hoặc lỗi. Kết quả không hợp lệ từ binary bị từ chối.
- Migration 017 bổ sung bảng riêng tư có RLS bắt buộc, trigger cấm cập nhật/xóa và không cấp quyền mới cho `noxh_runtime`.

Phạm vi này chưa triển khai xóa dữ liệu theo thời hạn, legal hold, tombstone chống khôi phục dữ liệu đã xóa hoặc quy trình phục hồi backup. Đó vẫn là công việc riêng. Bảng checkpoint không thay thế những kiểm soát đó.

## Quy trình sử dụng

1. Quản trị vận hành cấu hình khóa **công khai** và công bố hash/định danh khóa qua kênh độc lập. Khóa bí mật ở người giữ khóa ngoại tuyến.
2. Quản trị toàn tổ chức tạo đề nghị, tải JSON đề nghị và các trang bằng chứng liên tục từ đầu. Một trang tối đa 500 sự kiện.
3. Người giữ khóa đối chiếu dữ liệu, ký đề nghị thành tệp ứng viên, rồi kiểm toàn bộ trang với tệp vừa ký trước khi chấp nhận và đưa vào kho độc lập. Công cụ ký không tự kết luận dữ liệu trong đề nghị đúng.
4. Một quản trị toàn tổ chức khác nhập checkpoint. Máy chủ kiểm lại toàn bộ chuỗi tới mốc ký, đối chiếu đề nghị bất biến và mốc trước.
5. Người kiểm tra lấy checkpoint/hash mới nhất từ kho độc lập rồi đối chiếu với bản sao dữ liệu cần kiểm. Không lấy chữ “mới nhất” từ chính cơ sở dữ liệu đang bị kiểm tra làm gốc tin cậy.

Tải bằng chứng chứa metadata nhật ký, có thể gồm định danh tài khoản nhân sự từ cơ chế nhật ký hiện có. Chỉ lưu tại kho riêng được phân quyền. Không đưa tệp lên trang minh bạch công khai.

## Endpoint và tích hợp

Controller: `/api/v1/admin/audit/checkpoints`.

| Phương thức | Đường dẫn                                 | Chức năng                                                               |
| ----------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| GET         | `/`                                       | Đầu nhật ký, mốc đã nhập và trạng thái cấu hình khóa                    |
| POST        | `/proposals`                              | `{requestId, signerId}`; trả `{proposal, duplicate, signatureRequired}` |
| GET         | `/proposals/:id/evidence?afterSequence=0` | Một trang bằng chứng; theo `nextAfterSequence` tới `null`               |
| POST        | `/imports`                                | Nhập `{proposal, signature}` từ người khác                              |
| POST        | `/verify`                                 | Kiểm `{proposal, signature}` dù chưa nhập vào DB                        |

Mọi thao tác cần `org_admin` toàn tổ chức, không có danh sách hạn chế dự án. Giao diện `AuditCheckpointAdmin` gọi BFF `/api/admin/audit/checkpoints`; không có trường nhập khóa bí mật. Thiếu cấu hình khóa không chặn việc xem trạng thái, nhưng không cho tạo/nhập/kiểm checkpoint có chữ ký.

Root tích hợp controller/provider trong AppModule, BFF allowlist, OpenAPI và tab quản trị. Màn hình phải giữ rõ hai trạng thái: “đầy đủ tới mốc đã chọn” và “nhật ký hiện tại trùng mốc”. Tạo đề nghị và nhập checkpoint đều ghi thêm sự kiện sau mốc được chụp, nên nhật ký có sự kiện mới hơn là bình thường.

Endpoint kiểm hash nhật ký cũ của DossierService vẫn giữ giao thức cũ. Không diễn giải kết quả cũ thành bằng chứng có chữ ký hoặc chứng minh toàn bộ lịch sử.

## Cấu hình tin cậy và vòng đời khóa

`AUDIT_CHECKPOINT_TRUSTED_KEYS` là JSON server-side tối đa 64 KiB:

```json
[
  {
    "organizationId": "<uuid-tổ-chức>",
    "signerId": "custodian-2026",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
    "notBefore": "2026-01-01T00:00:00.000Z",
    "notAfter": "2027-01-01T00:00:00.000Z"
  }
]
```

Đây là mẫu cấu hình, không phải khóa sử dụng thật. Chỉ nhận khóa Ed25519 SPKI. Cửa sổ khóa áp dụng cho thời điểm tạo đề nghị; xóa khóa khỏi bộ tin cậy sẽ từ chối cả bằng chứng cũ dùng khóa đó. Nếu cần kiểm lịch sử sau xoay khóa, dùng bộ tin cậy lưu trữ được phê duyệt và ghim độc lập, không tự lấy khóa từ tệp bằng chứng. Không nhận “khóa mới” do chính checkpoint khai báo.

Kết quả API luôn ghi `custody: not-attested`: chữ ký không chứng minh tệp đã rời máy chủ, người giữ khóa thực sự độc lập hoặc có dấu thời gian được bên thứ ba chứng nhận. Máy chủ bị chiếm quyền cùng toàn bộ kho khóa/kho bằng chứng vẫn là rủi ro ngoài phạm vi kiểm chứng này.

## Giao thức chính xác

`noxh-audit-checkpoint-v1` ký UTF-8 của JSON array theo thứ tự:

```text
[version,id,organizationId,signerId,requestedBy,createdAt,
 previousCheckpointHash,sequence,head,eventCount,sequenceDigest]
```

Số thứ tự và số lượng là chuỗi số thập phân chuẩn, không số 0 đầu. Hash dùng hex chữ thường 64 ký tự. Thời điểm có UTC milliseconds. `requestedBy` là SHA-256 của chuỗi `audit-checkpoint:<organizationId>:<subject>`; không đưa subject thô vào đề nghị mới.

`checkpointHash = SHA256(canonicalBytes || 0x00 || signatureBase64url)`. Ed25519 ký trực tiếp canonicalBytes; không tự thay thuật toán bằng RSA/HMAC.

Chuỗi sự kiện `audit-v1` trước đây không băm cột `sequence`. Giao thức mới giữ tương thích hash cũ và bổ sung dấu vết thứ tự:

```text
sequenceDigest[0] = 64 ký tự "0"
sequenceDigest[n] = SHA256(UTF8(JSON.stringify([
  "audit-checkpoint-sequence-v1", sequenceDigest[n-1],
  sequenceDecimal, event_hash, id
])))
```

Mỗi mốc ký cả số lượng, thứ tự cuối và digest này. BIGSERIAL là toàn DB nên các khoảng trống số thứ tự giữa hai sự kiện cùng tổ chức là hợp lệ; đổi thứ tự hoặc nhãn số vẫn thay digest. Không giả định sequence bằng số lượng sự kiện.

Rust nhận thêm `anchor` và `expectedEnd` tùy chọn. Anchor chỉ đáng tin khi caller đã xác minh từ genesis hoặc từ checkpoint được xác thực. `completeToExpected: true` chỉ có khi cursor tính được bằng đúng expectedEnd. Kết quả legacy không có anchor/expectedEnd giữ nguyên giao thức golden cũ.

## Công cụ ngoại tuyến

Yêu cầu Node 22 và API đã được build; công cụ đọc module giao thức từ `apps/api/dist`. Ví dụ đường dẫn dưới đây cần thay bằng tệp riêng của đơn vị vận hành:

```sh
node scripts/audit-checkpoint.mjs sign \
  --proposal /private/evidence/proposal.json \
  --private-key-file /private/offline/ed25519.pem \
  --output /private/evidence/signed-candidate.json

AUDIT_VERIFIER_BIN=/absolute/path/audit-verifier \
node scripts/audit-checkpoint.mjs verify \
  --checkpoint-file /private/evidence/signed-candidate.json \
  --checkpoint-hash <hash-đã-ghim-độc-lập> \
  --trust-file /private/offline/trusted-public-keys.json \
  --pages-directory /private/evidence/pages
```

Tệp khóa bí mật phải là tệp thường, không symlink, thuộc UID chạy công cụ và không có quyền group/other (0600 hoặc 0400); đường dẫn tuyệt đối. Công cụ không đọc DATABASE_URL, không truy cập mạng và không truyền bí mật qua tham số child process. Binary Rust nhận dữ liệu bằng stdin với môi trường child tối thiểu. Đầu ra mới được ghi 0600, fsync rồi publish mà không ghi đè tệp cũ.

Tên bằng chứng `page-000001.json`, `page-000002.json`... liên tục. Với chuỗi rỗng dùng thư mục rỗng; không thêm trang rỗng. Giới hạn API: 100.000 sự kiện mỗi lần, trang 500. Công cụ ngoại tuyến: tối đa 2.000 trang/1 triệu sự kiện; mỗi lần Rust tối đa 2 MB. Quá giới hạn phải dừng và thiết kế lô kiểm lớn hơn có kiểm chứng, không tự cắt rồi tuyên bố hoàn tất.

## Giới hạn quyền DB và vận hành còn lại

Migration không tăng quyền cho runtime công dân và không cấp DDL hay BYPASSRLS cho vai trò mới. Nó không sửa toàn bộ mô hình API hiện còn dùng kết nối chủ sở hữu trong một số chế độ. Chạy API với vai trò DB tối thiểu, phân tách quản trị audit, bảo vệ kho khóa, backup và quy trình restore vẫn cần thiết kế triển khai và diễn tập riêng. RLS không chống được superuser hoặc người có quyền vô hiệu trigger.

Lưu checkpoint/hash đã chấp nhận ngoài miền quản trị DB là điều kiện để phát hiện việc cơ sở dữ liệu và bản checkpoint cùng bị quay lui. Kiểm chứng một mốc cũ hợp lệ không phát hiện việc người kiểm tra chưa nhận được mốc mới hơn. Phần mềm nêu rõ giới hạn này thay vì gán nhãn “nhật ký không thể sửa”.

## Kiểm tra đã thực hiện

- Rust: legacy golden/CLI và kiểm incremental, sai anchor, thay sequence, mất đuôi, expectedEnd giả.
- PGlite và binary Rust thật: quyền tổ chức, SoD, idempotency, bảng bất biến, nhánh cạnh tranh, khóa sai/không ghim, native lỗi, output lỗi, denied runtime privileges, 10.005 sự kiện.
- CLI với khóa tổng hợp: ký, hai trang, hash được ghim, từ chối mất trang và quyền tệp khóa không an toàn.

Các kiểm tra dùng dữ liệu tổng hợp. Chưa diễn tập kho khóa thật, kho lưu độc lập, khôi phục backup hay chứng nhận tuân thủ cho một chủ đầu tư cụ thể.
