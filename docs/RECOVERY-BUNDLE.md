# Gói sao lưu và khôi phục cách ly

Bổ sung ngày 16/10/2026 cho [runbook PostgreSQL hiện có](BACKUP-RESTORE.md). Công cụ: `scripts/recovery-bundle.mjs`. Không phải cơ chế chuyển dịch vụ production sang bản khôi phục.

## Thành phần và gốc tin cậy

Gói AES-256-GCM bao gồm:

- Archive PostgreSQL từ `pg_dump --snapshot`, vẫn dùng định dạng mã hóa của công cụ cũ.
- Manifest tham chiếu object lấy **trên chính connection REPEATABLE READ** đã xuất snapshot PostgreSQL: key, hash nội dung trong DB và hash envelope-key ciphertext. Dữ liệu nhạy cảm của manifest nằm trong ciphertext.
- Các byte object theo bản logical export riêng tư. Kiểm toàn bộ inventory: thiếu hoặc thừa đều từ chối; không tự xóa orphan hoặc bỏ qua tệp cách ly/rejected/deleted còn được DB tham chiếu. Hash từng tệp ở đây là hash byte lưu trong object store, không giả định bằng hash bản rõ trong DB.
- Cấu hình realm Keycloak không chứa users/credentials/khóa bí mật, cấu hình triển khai đã loại bí mật, và danh sách **tham chiếu phiên bản khóa**. Không sao lưu private signing keys/provider secrets vào gói này.
- Một checkpoint Ed25519, có public-key pin ngoài archive và hash checkpoint được nhập độc lập. Rust kiểm chuỗi của tổ chức ghi trong checkpoint từ genesis tới đúng head/count/sequence/digest cả khi capture và kiểm bản DB phục hồi. Các tổ chức khác trong DB chỉ có kiểm hash chain của manifest PG cũ, chưa được coi là có checkpoint độc lập.

Gói có manifest, độ dài và SHA-256 cho mọi tệp; AAD/header/ciphertext được xác thực GCM. Tên tệp trong container là danh sách cố định và `objects/00000000.bin`...; object key không được dùng làm đường dẫn khi giải nén. Không dùng tar/zip extraction với đường dẫn do archive cung cấp tùy ý.

Hash độc lập không được tự lấy từ cùng archive để làm gốc tin cậy. Bộ public key phải thuộc đúng tổ chức/người giữ khóa và thời hạn tạo checkpoint. `signature-pinned-latest-not-attested` xác nhận chữ ký đã được ghim, **không** chứng minh người vận hành có checkpoint mới nhất ở bên ngoài. Việc này vẫn cần quy trình ký/lưu độc lập theo [COMPLETION-OPERATIONS.md](COMPLETION-OPERATIONS.md).

## Điều kiện capture

Cần Node 22, dependencies workspace, API protocol đã build, PostgreSQL client đúng phiên bản và Rust `audit-verifier` đã build. Script không có native fallback. `PG_DUMP_BIN`, `PG_RESTORE_BIN`, `AUDIT_VERIFIER_BIN` trỏ executable đã được đơn vị vận hành xác minh. Khóa backup độc lập được nạp vào `BACKUP_ENCRYPTION_KEY`, không cùng `AUTH_ENCRYPTION_KEY`.

Dừng writers ứng dụng/worker/identity trong cửa sổ capture và hoàn tất logical export object store trước. Công cụ không tự dừng hay gọi hạ tầng đang chạy. Tệp attestation chỉ là xác nhận của người vận hành, không phải chứng minh kỹ thuật các writers đã dừng:

```json
{
  "writersStopped": true,
  "identityWritersStopped": true,
  "objectExportCompleted": true,
  "observedAt": "<UTC ISO thời điểm kiểm>"
}
```

Attestation quá một giờ hoặc ở tương lai quá 5 giây bị từ chối khi capture. PostgreSQL tự đảm bảo manifest và dump cùng snapshot; đồng bộ sang identity/object export phụ thuộc cửa sổ writers đã dừng. Tệp object bị thay đổi giữa lúc băm và lúc đóng gói sẽ làm capture thất bại.

Thư mục object export phải `0700`, thuộc UID chạy công cụ, tệp thường, không symlink hoặc special file. Bố cục bên trong theo object key chính xác của DB. Inventory export phải khớp hoàn toàn 3 nguồn: `documents`, `generated_forms`, `identity_private.investor_files`. Không dùng thư mục dữ liệu vật lý MinIO thay cho logical object export.

Keycloak config phải là bản redacted, không chứa users/credentials hoặc secret-bearing fields. Đây không phải bản sao đầy đủ database/session Keycloak. Bí mật và private signing key được giữ ở kho escrow riêng; danh sách tham chiếu mẫu:

```json
{
  "version": 1,
  "references": [
    {
      "id": "application-encryption",
      "purpose": "application-encryption",
      "version": "<phiên bản kho khóa>"
    },
    { "id": "application-hash", "purpose": "application-hash", "version": "<phiên bản kho khóa>" },
    { "id": "identity-signing", "purpose": "identity-signing", "version": "<phiên bản kho khóa>" }
  ]
}
```

Các khóa thực không xuất hiện trong JSON trên. Restore yêu cầu một danh sách xác nhận từ kho độc lập khớp cả id/purpose/version, nhưng không nhận key material và **không** tự chứng minh các khóa đó giải mã được dữ liệu. Báo cáo ghi `keyAvailability: reference-acknowledgements-only`.

Ví dụ, giả định môi trường và tệp riêng đã được tổ chức chuẩn bị an toàn:

```sh
node scripts/recovery-bundle.mjs capture \
  --objects /secure/export/objects \
  --identity-config /secure/export/realm-redacted.json \
  --deployment-config /secure/export/deployment-redacted.json \
  --secret-references /secure/export/secret-references.json \
  --checkpoint /secure/export/signed-checkpoint.json \
  --checkpoint-trust /secure/independent/public-key-pins.json \
  --checkpoint-hash <hash-checkpoint-đã-ghim-độc-lập> \
  --attestation /secure/export/capture-attestation.json \
  --out /secure/backups/recovery.noxh
```

`SOURCE_DATABASE_URL` chỉ nạp qua môi trường, không truyền ở argv. Capture không gọi S3/Keycloak provider để tự export. Chuẩn bị logical export/config bằng quy trình có quyền đã xác minh của đơn vị vận hành.

## Plan và thực thi diễn tập

Plan giải mã/xác thực gói trong staging tạm `0700`, kiểm checksum/inventory/key-reference acknowledgements/chữ ký và hash checkpoint; không kết nối DB, không tạo thư mục đích cuối. Sau đó xóa staging. Phải dùng thư mục cha đã tồn tại, `0700`, thuộc UID và có đường dẫn canonical không symlink.

```sh
node scripts/recovery-bundle.mjs plan \
  --input /secure/backups/recovery.noxh \
  --destination /secure/drill/noxh_recovery_<24-ký-tự-hex> \
  --secret-acknowledgements /secure/independent/key-acknowledgements.json \
  --checkpoint-trust /secure/independent/public-key-pins.json \
  --checkpoint-hash <hash-checkpoint-đã-ghim-độc-lập>
```

Đích phải chưa tồn tại; không có tùy chọn overwrite. Execute cần thêm `DRILL_ADMIN_DATABASE_URL`: chỉ chấp nhận literal loopback `127.0.0.1` hoặc `::1` và database quản trị tên **`noxh_recovery_admin`**. Chuẩn bị nó trong cluster diễn tập riêng, không tạo trên cluster production. Không nhận hostname/domain/DSN option tùy ý; chỉ query parameter `sslmode` được phép. Gate tên/loopback ngăn nhầm đích thông thường, không thay chứng cứ cluster đã được vận hành tách biệt.

```sh
node scripts/recovery-bundle.mjs restore-drill \
  --input /secure/backups/recovery.noxh \
  --destination /secure/drill/noxh_recovery_<24-ký-tự-hex> \
  --secret-acknowledgements /secure/independent/key-acknowledgements.json \
  --checkpoint-trust /secure/independent/public-key-pins.json \
  --checkpoint-hash <hash-checkpoint-đã-ghim-độc-lập> \
  --migrations /source-matching-backup/db/migrations
```

PostgreSQL helper tạo database rỗng tên ngẫu nhiên `noxh_restore_drill_<24 hex>` rồi restore thật bằng `pg_restore --single-transaction --exit-on-error --no-owner`. Nó đối chiếu schema/counts/migrations/audit manifest. Callback mới chạy lại đường kiểm checksum idempotent của migration runner: chỉ chấp nhận toàn bộ phiên bản đã áp dụng khớp source của backup; không tự upgrade một bản backup cũ bằng migrations mới. Tiếp theo kiểm object-reference inventory trên DB phục hồi và Rust checkpoint. Không vô hiệu trigger/ràng buộc để ép khớp.

Database tạm chỉ được xóa nếu chính lần chạy tạo thành công, không `DROP FORCE` hoặc xóa theo prefix. **Database diễn tập không được giữ làm runtime**. Sau khi kiểm DB thành công và dọn DB, script tạo thư mục đích mới chứa opaque object files, `object-inventory.json`, identity/deployment/secret-ref/checkpoint JSON và `DR-REPORT.json`, tệp `0600`. Không có dump PostgreSQL bản rõ ở đích. Lỗi khi copy/report sẽ xóa đúng thư mục do lần chạy tạo và không tác động nguồn.

## Gate trước khôi phục dịch vụ thực

Báo cáo luôn `activationAllowed: false`, `noServicesStarted: true`, `offHostCustody: not-attested`. Đây là gói khôi phục cách ly và diễn tập, chưa phải full failover:

- Chưa tự tạo/import bucket S3 hoặc realm Keycloak đang chạy; chưa phục hồi identity database/users/sessions, Redis/outbox hoặc cấu hình reverse proxy/TLS.
- Chưa kiểm giải mã nội dung object bằng khóa escrow thật, chưa kiểm đăng nhập/mapping, malware scan hay transaction provider sau khôi phục.
- Chưa có ledger tombstone/retention/legal-hold **mới nhất độc lập** để áp dụng sau một backup cũ. Không mở dịch vụ từ gói này trước khi quyết định những sự kiện xóa/hạn chế/hold xảy ra sau capture. Không tự xóa dữ liệu pháp lý hoặc dùng archive cũ để bỏ dấu `deleted_at`.
- Chưa có off-host custody, lịch tự động, RPO/RTO cam kết hoặc chứng nhận recovery production. GCM không thay kho khóa độc lập; mất khóa backup làm gói không đọc được.

Tệp mã hóa được mở bằng O_NOFOLLOW, kiểm regular-file/size trên chính descriptor dùng xuyên suốt giải mã; quá giới hạn ciphertext bị chặn trước khi tạo tệp bản rõ. Tệp sparse quá cỡ và symlink cũng bị từ chối.

Giới hạn: manifest 16 MiB, 100.000 object, tổng payload 100 GiB, mỗi Rust request 2 MB/500 events; checkpoint tối đa 1 triệu events. Giới hạn chủ đích cho công cụ này, không phải cam kết dung lượng. Dùng volume tạm mã hóa; xóa tệp không bảo đảm secure erase vật lý trên SSD.

## Kiểm tra

`node --test tests/recovery-bundle.test.mjs tests/backup-restore.test.mjs`: 8 test bundle và 4 test cũ. Các test bundle dùng Rust, AES-GCM và filesystem thật; adapter DB được thay bằng fixture trong unit tests. Có kiểm plan không effects, restore staging bytes, thiếu/thừa object, symlink, path traversal, file checksum sai, ciphertext tamper, migrations đổi, checkpoint/hash không ghim, sequence/truncated prefix, missing key references, đích hiện hữu/live/remote và cleanup. Không coi adapter test là bằng chứng pg_dump/pg_restore thật.

Bằng chứng native riêng phải ghi phiên bản PostgreSQL, số migration/object/audit và kết quả cleanup; không ghi URL, credential, nội dung giấy tờ hoặc bí mật. Chỉ được chạy trên cluster tổng hợp mới do lần diễn tập tạo, không dùng infrastructure thật để thử phá.

## Bằng chứng native tổng hợp 16/10/2026

Đã chạy thành công lúc 03:14 UTC bằng PostgreSQL/client 17.6, trong cluster mới được tạo riêng ở `/private/tmp` và chỉ bind loopback: 20 migration, 1 opaque object tổng hợp và 1 sự kiện audit được checkpoint Ed25519. Gói 361.645 byte, 6 tệp; hash manifest `2c8f29a5800bc2646ef7143b96d6d91399f948fb9d56f64d9d4a62d4fec658bb`. Plan không tạo DB/đích; restore thật xác minh schema/counts/migrations, inventory và Rust checkpoint, sau đó xóa DB drill. Tệp object/config được staging cách ly. Sửa ciphertext bị từ chối trước khi có database mới. Cluster, dữ liệu thử và staging của lần diễn tập được dọn; chỉ giữ báo cáo không bí mật ngoài repository. Không truy cập cluster demo/production hoặc khóa thật. Đây là bằng chứng chức năng trên dữ liệu nhỏ, không phải RTO/SLA hoặc full failover production.

Diễn tập native đã chạy lại sau sửa giới hạn ciphertext và O_NOFOLLOW; vẫn đạt toàn bộ bước trên. Regression sparse vượt giới hạn và symlink xác nhận dừng trước bản rõ/DB.
