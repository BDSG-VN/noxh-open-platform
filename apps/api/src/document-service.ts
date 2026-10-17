import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validateStaticPdf } from '@noxh/form-engine';
import { DocumentUploadSchema, AcceptedFieldsSchema, ExtractionSchema } from '@noxh/contracts';
import { Database, type Row, type Sql } from './database';
import { AssistanceService } from './assistance-service';
import { DocumentStorage, encryptObject, decryptObject, hashBytes } from './document-storage';
import { DocumentScanner } from './document-scanner';
import { OpenAiService } from './openai-service';
import { PrivacyService } from './privacy-service';
import { event, record, uuid } from './admin-service';
import { seal, unseal } from './identity-crypto';
import type { Citizen } from './phone-service';
export function validateDocument(bytes: Buffer, mime: string) {
  if (bytes.length < 10 || bytes.length > 5 * 1024 * 1024)
    throw new BadRequestException('Tệp từ 10 byte đến 5 MiB');
  const valid =
    mime === 'application/pdf'
      ? bytes.subarray(0, 5).toString() === '%PDF-' &&
        bytes.subarray(-2048).includes(Buffer.from('%%EOF'))
      : mime === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === 'image/jpeg'
          ? bytes[0] === 255 &&
            bytes[1] === 216 &&
            bytes[2] === 255 &&
            bytes[bytes.length - 2] === 255 &&
            bytes[bytes.length - 1] === 217
          : false;
  if (!valid) throw new BadRequestException('Định dạng thực tế không khớp PDF/JPEG/PNG');
  if (
    mime === 'application/pdf' &&
    /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction|AA)\b/.test(bytes.toString('latin1'))
  )
    throw new BadRequestException('PDF có nội dung chủ động hoặc tệp nhúng; hãy xuất bản PDF tĩnh');
}
@Injectable()
export class DocumentService {
  constructor(
    @Inject(Database) readonly db: Database,
    @Inject(AssistanceService) readonly assistance: AssistanceService,
    @Inject(DocumentStorage) readonly storage: DocumentStorage,
    @Inject(DocumentScanner) readonly scanner: DocumentScanner,
    @Inject(OpenAiService) readonly ai: OpenAiService,
    @Inject(PrivacyService) readonly privacy: PrivacyService,
  ) {}
  scope(r: Row) {
    return 'document:' + r.organization_id + ':' + r.owner_user_id + ':' + r.id;
  }
  private view(r: Row) {
    const reason = r.scan_details_cipher
      ? JSON.parse(unseal(String(r.scan_details_cipher), 'document-scan:' + this.scope(r))).reason
      : '';
    const scanMessage =
      (
        {
          'scanner-not-configured': 'Dịch vụ quét chưa được cấu hình. Tệp đang được cách ly.',
          'scanner-timeout':
            'Dịch vụ quét chưa phản hồi kịp. Tệp vẫn được cách ly; bạn có thể quét lại.',
          'scanner-unavailable':
            'Chưa kết nối được dịch vụ quét. Tệp vẫn được cách ly; bạn có thể quét lại.',
          'malware-detected':
            'Dịch vụ quét phát hiện nội dung không an toàn. Hãy chuẩn bị tệp khác.',
          'invalid-or-active-static-pdf':
            'PDF có cấu trúc không hợp lệ hoặc nội dung chủ động. Hãy xuất lại thành PDF tĩnh.',
          'scan-passed': 'Đã hoàn tất kiểm tra an toàn.',
        } as Record<string, string>
      )[String(reason)] ??
      (r.scan_status === 'clean'
        ? 'Đã hoàn tất kiểm tra an toàn.'
        : 'Tệp chưa vượt qua kiểm tra an toàn và vẫn được cách ly.');
    return {
      id: r.id,
      type: r.type,
      mime: r.mime,
      sha256: r.sha256,
      bytes: r.bytes,
      scan_status: r.scan_status,
      scan_message: scanMessage,
      version: r.version,
      created_at: r.created_at,
      scanned_at: r.scanned_at,
      retention_class: r.retention_class,
      ...(r.metadata_cipher
        ? JSON.parse(unseal(String(r.metadata_cipher), 'document-meta:' + this.scope(r)))
        : { name: 'Tệp lưu trữ' }),
    };
  }
  async own(q: Sql, c: Citizen, dossier: string, id: string, lock = false) {
    await this.assistance.owner(q, c, dossier);
    const r = (
      await q.query(
        `SELECT * FROM documents WHERE id=$1 AND organization_id=$2 AND dossier_id=$3 AND owner_user_id=$4 AND deleted_at IS NULL ${lock ? 'FOR UPDATE' : ''}`,
        [uuid(id), c.organizationId, uuid(dossier), c.userId],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Không có giấy tờ trong hồ sơ');
    return r;
  }
  async workspace(c: Citizen, id: string) {
    await this.db.tx((q) => this.assistance.owner(q, c, id));
    const rows = await this.db.query(
      'SELECT * FROM documents WHERE organization_id=$1 AND dossier_id=$2 AND owner_user_id=$3 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100',
      [c.organizationId, uuid(id), c.userId],
    );
    const extractions = await this.db.query(
      'SELECT * FROM document_extractions WHERE organization_id=$1 AND dossier_id=$2 AND owner_user_id=$3 ORDER BY created_at DESC LIMIT 100',
      [c.organizationId, uuid(id), c.userId],
    );
    return {
      items: rows.map((r) => this.view(r)),
      extractions: extractions.map((r) => ({
        id: r.id,
        document_id: r.document_id,
        source_hash: r.source_hash,
        input_version: r.input_version,
        model: r.model,
        prompt_version: r.prompt_version,
        accepted_at: r.accepted_at,
        ...JSON.parse(
          unseal(
            String(r.payload_cipher),
            'extraction:' + c.organizationId + ':' + c.userId + ':' + r.id,
          ),
        ),
        ...(r.accepted_cipher
          ? {
              fields: JSON.parse(
                unseal(
                  String(r.accepted_cipher),
                  'accepted-extraction:' + c.organizationId + ':' + c.userId + ':' + r.id,
                ),
              ),
            }
          : {}),
      })),
      scannerConfigured: Boolean(process.env.CLAMD_HOST),
    };
  }
  async upload(c: Citizen, dossier: string, body: unknown) {
    await this.privacy.assertProcessing(c);
    const p = DocumentUploadSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Kiểm tra tên, loại và tệp PDF/ảnh tối đa 5 MiB');
    const b = p.data,
      bytes = Buffer.from(b.base64, 'base64');
    if (bytes.toString('base64') !== b.base64)
      throw new BadRequestException('Mã hóa tệp không hợp lệ');
    validateDocument(bytes, b.mime);

    const id = randomUUID(),
      scope = 'document:' + c.organizationId + ':' + c.userId + ':' + id,
      encrypted = encryptObject(bytes, scope),
      key = c.organizationId + '/' + c.userId + '/' + id;
    try {
      await this.db.tx(async (q) => {
        await this.privacy.assertProcessing(c, q);
        const d = await this.assistance.owner(q, c, dossier, true);
        const recent = Number(
          (
            await q.query(
              "SELECT count(*)::int AS n FROM documents WHERE organization_id=$1 AND owner_user_id=$2 AND created_at>now()-interval '1 hour'",
              [c.organizationId, c.userId],
            )
          ).rows[0]!.n,
        );
        if (recent >= 20) throw new ConflictException('Tối đa 20 lần tải giấy tờ mỗi giờ');
        if (
          Number(
            (
              await q.query(
                'SELECT count(*)::int AS n FROM documents WHERE dossier_id=$1 AND organization_id=$2 AND deleted_at IS NULL',
                [uuid(dossier), c.organizationId],
              )
            ).rows[0]!.n,
          ) >= 100
        )
          throw new ConflictException('Tối đa 100 giấy tờ/hồ sơ');
        await this.storage.put(key, encrypted.bytes);
        await q.query(
          'INSERT INTO documents(id,organization_id,project_id,dossier_id,owner_user_id,object_key,sha256,mime,type,bytes,metadata_cipher,envelope_key_cipher) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [
            id,
            c.organizationId,
            d.project_id,
            uuid(dossier),
            c.userId,
            key,
            hashBytes(bytes),
            b.mime,
            b.type,
            bytes.length,
            seal(JSON.stringify({ name: b.name }), 'document-meta:' + scope),
            encrypted.keyCipher,
          ],
        );
        await event(
          q,
          { organizationId: c.organizationId, subject: c.userId },
          'document.uploaded',
          id,
        );
      });
    } catch (e) {
      // Compensating cleanup; an orphaned object is reported for operators, not hidden.
      await this.storage
        .remove(key)
        .catch((cleanup: unknown) =>
          new Logger('document').warn(
            'Orphaned upload object after failed write: ' +
              (cleanup instanceof Error ? cleanup.name : 'unknown'),
          ),
        );
      throw e;
    }
    await this.scan(c, dossier, id);
    return { id };
  }
  async raw(r: Row) {
    const bytes = decryptObject(
      await this.storage.get(String(r.object_key)),
      String(r.envelope_key_cipher),
      this.scope(r),
    );
    if (hashBytes(bytes) !== r.sha256) throw new ConflictException('Tệp không khớp dấu kiểm chứng');
    return bytes;
  }
  async scan(c: Citizen, dossier: string, id: string) {
    await this.privacy.assertProcessing(c);
    const r = await this.db.tx((q) => this.own(q, c, dossier, id));
    if (r.scan_status === 'rejected')
      throw new ConflictException('Tệp bị từ chối, cần tải bản khác');
    const bytes = await this.raw(r);
    let result = await this.scanner.scan(bytes);
    if (result.status === 'clean' && r.mime === 'application/pdf') {
      try {
        await validateStaticPdf(bytes);
      } catch {
        result = {
          status: 'rejected',
          engine: 'clamd+strict-pdf',
          reason: 'invalid-or-active-static-pdf',
        };
      }
    }
    await this.db.tx(async (q) => {
      await this.privacy.assertProcessing(c, q);
      const current = await this.own(q, c, dossier, id, true);
      if (current.scan_status === 'rejected') throw new ConflictException('Tệp đã bị từ chối');
      await q.query(
        'UPDATE documents SET scan_status=$2,scan_details_cipher=$3,scanned_at=now(),version=version+1,updated_at=now() WHERE id=$1',
        [uuid(id), result.status, seal(JSON.stringify(result), 'document-scan:' + this.scope(r))],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'document.scanned',
        uuid(id),
      );
    });
    return result;
  }
  async download(c: Citizen, dossier: string, id: string) {
    const r = await this.db.tx((q) => this.own(q, c, dossier, id));
    if (r.scan_status !== 'clean')
      throw new ForbiddenException('Chỉ tải tệp sau khi quét an toàn thành công');
    return {
      bytes: await this.raw(r),
      mime: String(r.mime),
      filename:
        'document-' +
        r.id +
        (r.mime === 'application/pdf' ? '.pdf' : r.mime === 'image/png' ? '.png' : '.jpg'),
    };
  }
  async readForAuthorizedStaff(id: string, org: string) {
    const [r] = await this.db.query(
      "SELECT * FROM documents WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL AND scan_status='clean'",
      [uuid(id), uuid(org)],
    );
    if (!r) throw new NotFoundException('Không có tệp đã quét an toàn');
    return { bytes: await this.raw(r), mime: String(r.mime), filename: 'evidence-' + r.id };
  }
  async remove(c: Citizen, dossier: string, id: string) {
    return this.db.tx(async (q) => {
      await this.own(q, c, dossier, id, true);
      const has = (await q.query("SELECT to_regclass('public.application_documents') AS t")).rows[0]
        ?.t;
      if (
        has &&
        (
          await q.query('SELECT 1 FROM application_documents WHERE document_id=$1 LIMIT 1', [
            uuid(id),
          ])
        ).rows.length
      )
        throw new ConflictException(
          'Tệp đã được lưu trong hồ sơ nộp; gửi yêu cầu quyền dữ liệu để xử lý theo thời hạn lưu trữ pháp lý',
        );
      await q.query(
        'UPDATE documents SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1',
        [uuid(id)],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'document.withdrawn',
        uuid(id),
      );
      return { withdrawn: true, retention: 'legal-review-required' };
    });
  }
  async extract(c: Citizen, dossier: string, id: string, body: unknown) {
    const b = record(body);
    if (
      b.accepted !== true ||
      b.noticeVersion !== 'document-extraction-v1' ||
      Object.keys(b).some((k) => !['accepted', 'noticeVersion'].includes(k))
    )
      throw new BadRequestException('Cần đồng ý riêng gửi giấy tờ này đến OpenAI');
    await this.privacy.assertProcessing(c);
    const r = await this.db.tx((q) => this.own(q, c, dossier, id));
    if (r.scan_status !== 'clean')
      throw new ForbiddenException('Phải quét an toàn trước khi gửi AI');
    const bytes = await this.raw(r);
    const d = await this.db.tx((q) => this.assistance.owner(q, c, dossier));
    const consentId = randomUUID();
    await this.db.tx(async (q) => {
      await this.privacy.assertProcessing(c, q);
      await q.query(
        "INSERT INTO consent_records(id,organization_id,user_id,purpose,notice_version,granted_at) VALUES($1,$2,$3,$4,'document-extraction-v1',now())",
        [consentId, c.organizationId, c.userId, 'openai-document:' + r.id + ':' + r.sha256],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'document.ai-consented',
        String(r.id),
      );
    });
    await this.privacy.assertProcessing(c);
    const result = await this.ai.extractDocument(c, dossier, { bytes, mime: String(r.mime) });
    const extraction = randomUUID();
    await this.db.tx(async (q) => {
      await this.privacy.assertProcessing(c, q);
      const consent = (
        await q.query(
          'SELECT id FROM consent_records WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND withdrawn_at IS NULL',
          [consentId, c.organizationId, c.userId],
        )
      ).rows[0];
      if (!consent)
        throw new ForbiddenException(
          'Đồng ý trích xuất đã được rút; kết quả không được lưu vào hồ sơ',
        );
      const current = await this.own(q, c, dossier, id, true);
      if (current.scan_status !== 'clean' || current.sha256 !== r.sha256)
        throw new ConflictException('Giấy tờ đã thay đổi trạng thái');
      await q.query(
        'INSERT INTO document_extractions(id,organization_id,dossier_id,owner_user_id,document_id,source_hash,input_version,payload_cipher,model) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          extraction,
          c.organizationId,
          uuid(dossier),
          c.userId,
          uuid(id),
          r.sha256,
          d.version,
          seal(
            JSON.stringify(result.payload),
            'extraction:' + c.organizationId + ':' + c.userId + ':' + extraction,
          ),
          result.model,
        ],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'document.extracted',
        extraction,
      );
    });
    return { id: extraction, ...result.payload };
  }
  async accept(c: Citizen, dossier: string, id: string, body: unknown) {
    await this.privacy.assertProcessing(c);
    const p = AcceptedFieldsSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Cần kiểm tra từng trường và xác nhận');
    return this.db.tx(async (q) => {
      await this.privacy.assertProcessing(c, q);
      await this.assistance.owner(q, c, dossier, true);
      const r = (
        await q.query(
          'SELECT * FROM document_extractions WHERE id=$1 AND organization_id=$2 AND dossier_id=$3 AND owner_user_id=$4 FOR UPDATE',
          [uuid(id), c.organizationId, uuid(dossier), c.userId],
        )
      ).rows[0];
      if (!r || r.accepted_at) throw new ConflictException('Đề xuất không còn chờ xác nhận');
      const doc = await this.own(q, c, dossier, String(r.document_id));
      if (doc.scan_status !== 'clean' || doc.sha256 !== r.source_hash)
        throw new ConflictException('Giấy tờ không còn khả dụng để xác nhận');
      const original = ExtractionSchema.parse(
        JSON.parse(
          unseal(
            String(r.payload_cipher),
            'extraction:' + c.organizationId + ':' + c.userId + ':' + r.id,
          ),
        ),
      );
      if (
        p.data.fields.some((f) => !original.fields.some((o) => o.key === f.key)) ||
        new Set(p.data.fields.map((f) => f.key)).size !== p.data.fields.length
      )
        throw new BadRequestException('Trường xác nhận không thuộc đề xuất');
      await q.query(
        'UPDATE document_extractions SET accepted_cipher=$2,accepted_at=now() WHERE id=$1',
        [
          uuid(id),
          seal(
            JSON.stringify(
              p.data.fields.map((f) => ({
                ...original.fields.find((o) => o.key === f.key)!,
                value: f.value,
              })),
            ),
            'accepted-extraction:' + c.organizationId + ':' + c.userId + ':' + r.id,
          ),
        ],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'document.extraction-accepted',
        uuid(id),
      );
      return {
        accepted: true,
        notice:
          'Chỉ lưu dữ liệu đã kiểm tra để điền mẫu; không tự sửa bản khai hay quyết định điều kiện.',
      };
    });
  }
}
