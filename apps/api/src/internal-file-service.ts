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
import { InternalFileUploadSchema } from '@noxh/contracts';
import { validateStaticPdf } from '@noxh/form-engine';
import { Database, type Row } from './database';
import { OperationsService } from './operations-service';
import { DocumentStorage, decryptObject, encryptObject, hashBytes } from './document-storage';
import { DocumentScanner } from './document-scanner';
import { validateDocument } from './document-service';
import { event, uuid } from './admin-service';
import { seal, unseal } from './identity-crypto';
import type { Staff } from './workforce';
@Injectable()
export class InternalFileService {
  constructor(
    @Inject(Database) readonly db: Database,
    @Inject(OperationsService) readonly operations: OperationsService,
    @Inject(DocumentStorage) readonly storage: DocumentStorage,
    @Inject(DocumentScanner) readonly scanner: DocumentScanner,
  ) {}
  private async authorizeDepartment(s: Staff, project: string, department: string) {
    await this.operations.authorizeRecordFiles(s, project, true);
    if (s.role === 'org_admin') return;
    const [e] = await this.db.query(
      "SELECT department FROM identity_private.investor_employees WHERE organization_id=$1 AND subject=$2 AND status='active'",
      [s.organizationId, s.subject],
    );
    if (!e || e.department !== department)
      throw new ForbiddenException('Chỉ tải hoặc quét tệp thuộc phòng ban được giao');
  }
  private scope(r: Row) {
    return 'internal-file:' + r.organization_id + ':' + r.project_id + ':' + r.id;
  }
  private view(r: Row) {
    return {
      id: r.id,
      department: r.department,
      classification: r.classification,
      mime: r.mime,
      bytes: r.bytes,
      sha256: r.sha256,
      created_by: r.created_by,
      created_at: r.created_at,
      scan_status: r.scan_status,
      scanned_at: r.scanned_at,
      version: r.version,
      reference: 'file:' + r.id,
      ...JSON.parse(unseal(String(r.metadata_cipher), 'metadata:' + this.scope(r))),
    };
  }
  async list(s: Staff, project: string) {
    await this.operations.authorizeRecordFiles(s, project, false);
    const rows = await this.db.query(
      'SELECT * FROM identity_private.investor_files WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 200',
      [s.organizationId, uuid(project)],
    );
    const items = [];
    for (const row of rows) {
      try {
        const visible = await this.operations.authorizeInternalFile(s, project, String(row.id));
        items.push(this.view(visible));
      } catch (e) {
        if (!(e instanceof NotFoundException) && !(e instanceof ForbiddenException)) throw e;
      }
    }
    return { items, scannerConfigured: Boolean(process.env.CLAMD_HOST) };
  }
  private row(s: Staff, project: string, id: string, write = false) {
    return this.operations.authorizeInternalFile(s, project, id, write);
  }
  async upload(s: Staff, project: string, body: unknown) {
    const p = InternalFileUploadSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException('Chọn phòng ban, tệp PDF/ảnh và phân loại hạn chế');
    const b = p.data;
    await this.authorizeDepartment(s, project, b.department);
    const bytes = Buffer.from(b.base64, 'base64');
    if (bytes.toString('base64') !== b.base64) throw new BadRequestException('Mã tệp không hợp lệ');
    validateDocument(bytes, b.mime);

    const id = randomUUID(),
      row = { id, organization_id: s.organizationId, project_id: uuid(project) },
      scope = this.scope(row),
      encrypted = encryptObject(bytes, scope),
      key = s.organizationId + '/internal/' + uuid(project) + '/' + id;
    try {
      await this.db.tx(async (q) => {
        await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          'internal-files:' + s.organizationId + ':' + s.subject,
        ]);
        const count = Number(
          (
            await q.query(
              "SELECT count(*)::int AS n FROM identity_private.investor_files WHERE organization_id=$1 AND created_by=$2 AND created_at>now()-interval '1 hour'",
              [s.organizationId, s.subject],
            )
          ).rows[0]!.n,
        );
        if (count >= 20) throw new ConflictException('Tối đa 20 tệp lưu trữ mỗi giờ');
        await this.storage.put(key, encrypted.bytes);
        await q.query(
          "INSERT INTO identity_private.investor_files(id,organization_id,project_id,created_by,department,classification,metadata_cipher,object_key,envelope_key_cipher,sha256,mime,bytes) VALUES($1,$2,$3,$4,$5,'restricted',$6,$7,$8,$9,$10,$11)",
          [
            id,
            s.organizationId,
            uuid(project),
            s.subject,
            b.department,
            seal(JSON.stringify({ name: b.name }), 'metadata:' + scope),
            key,
            encrypted.keyCipher,
            hashBytes(bytes),
            b.mime,
            bytes.length,
          ],
        );
        await event(q, s, 'internal-file.uploaded', id);
      });
    } catch (e) {
      // Compensating cleanup; an orphaned object is reported for operators, not hidden.
      await this.storage
        .remove(key)
        .catch((cleanup: unknown) =>
          new Logger('internal-file').warn(
            'Orphaned upload object after failed write: ' +
              (cleanup instanceof Error ? cleanup.name : 'unknown'),
          ),
        );
      throw e;
    }
    await this.scan(s, project, id);
    return { id, reference: 'file:' + id, sha256: hashBytes(bytes) };
  }
  private async raw(r: Row) {
    const bytes = decryptObject(
      await this.storage.get(String(r.object_key)),
      String(r.envelope_key_cipher),
      this.scope(r),
    );
    if (hashBytes(bytes) !== r.sha256)
      throw new ConflictException('Tệp lưu trữ không khớp mã kiểm chứng');
    return bytes;
  }
  async scan(s: Staff, project: string, id: string) {
    const r = await this.row(s, project, id, true);
    if (r.scan_status === 'rejected')
      throw new ConflictException('Tệp bị từ chối, phải tải bản mới');
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
    await this.authorizeDepartment(s, project, String(r.department));
    await this.db.tx(async (q) => {
      const current = (
        await q.query(
          'SELECT scan_status FROM identity_private.investor_files WHERE id=$1 AND organization_id=$2 FOR UPDATE',
          [uuid(id), s.organizationId],
        )
      ).rows[0];
      if (!current || current.scan_status === 'rejected')
        throw new ConflictException('Tệp đã thay đổi trạng thái');
      await q.query(
        'UPDATE identity_private.investor_files SET scan_status=$2,scan_details_cipher=$3,scanned_at=now(),updated_at=now(),version=version+1 WHERE id=$1',
        [uuid(id), result.status, seal(JSON.stringify(result), 'scan:' + this.scope(r))],
      );
      await event(q, s, 'internal-file.scanned', uuid(id));
    });
    return result;
  }
  async download(s: Staff, project: string, id: string) {
    const r = await this.row(s, project, id);
    if (r.scan_status !== 'clean')
      throw new ForbiddenException('Chỉ tải tệp sau khi quét an toàn thành công');
    const bytes = await this.raw(r);
    await this.row(s, project, id);
    await this.db.tx((q) => event(q, s, 'internal-file.downloaded', uuid(id)));
    return {
      bytes,
      mime: String(r.mime),
      filename:
        'internal-' +
        r.id +
        (r.mime === 'application/pdf' ? '.pdf' : r.mime === 'image/png' ? '.png' : '.jpg'),
    };
  }
}
