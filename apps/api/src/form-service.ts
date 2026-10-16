import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  FormMappingSchema,
  GenerateFormSchema,
  ExtractionSchema,
  DeclarationSchema,
  emptyDeclaration,
  type MappingField,
} from '@noxh/contracts';
import { renderOfficialForm, validateMappingBounds, createFormPacket } from '@noxh/form-engine';
import { Database, type Row, type Sql } from './database';
import { AssistanceService } from './assistance-service';
import { DocumentStorage, encryptObject, decryptObject, hashBytes } from './document-storage';
import { DocumentService } from './document-service';
import { PrivacyService } from './privacy-service';
import { event, record, uuid } from './admin-service';
import { seal, unseal } from './identity-crypto';
import type { Citizen } from './phone-service';
import type { Staff } from './workforce';
@Injectable()
export class FormService {
  constructor(
    @Inject(Database) readonly db: Database,
    @Inject(AssistanceService) readonly assistance: AssistanceService,
    @Inject(DocumentStorage) readonly storage: DocumentStorage,
    @Inject(DocumentService) readonly documents: DocumentService,
    @Inject(PrivacyService) readonly privacy: PrivacyService,
  ) {}
  async mappings(s: Staff, project: string) {
    await this.assistance.projectForms(s, project);
    return {
      items: await this.db.query(
        'SELECT * FROM form_field_mappings WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 200',
        [s.organizationId, uuid(project)],
      ),
    };
  }
  async draft(s: Staff, project: string, body: unknown) {
    const p = FormMappingSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException('Kiểm tra nguồn, ngày hiệu lực, tọa độ và trường ánh xạ');
    await this.assistance.projectForms(s, project);
    return this.db.tx(async (q) => {
      await q.query('SELECT id FROM projects WHERE id=$1 AND organization_id=$2 FOR UPDATE', [
        uuid(project),
        s.organizationId,
      ]);
      const r = (
        await q.query(
          "SELECT * FROM project_form_releases WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND status='approved'",
          [p.data.releaseId, s.organizationId, uuid(project)],
        )
      ).rows[0];
      if (!r) throw new ConflictException('Cần hướng dẫn pháp lý đã được duyệt');
      const version = Number(
          (
            await q.query(
              'SELECT COALESCE(max(version),0)+1 AS n FROM form_field_mappings WHERE organization_id=$1 AND release_id=$2',
              [s.organizationId, r.id],
            )
          ).rows[0]!.n,
        ),
        id = randomUUID();
      const source = await this.assistance.pdf(String(r.form_id));
      try {
        await validateMappingBounds(source.bytes, p.data.fields);
      } catch {
        throw new BadRequestException('Tọa độ điền nằm ngoài trang PDF');
      }
      await q.query(
        'INSERT INTO form_field_mappings(id,organization_id,project_id,release_id,form_id,source_hash,payload,content_hash,version,created_by,effective_from,effective_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          id,
          s.organizationId,
          uuid(project),
          r.id,
          r.form_id,
          r.source_hash,
          JSON.stringify(p.data),
          hashBytes(Buffer.from(JSON.stringify(p.data))),
          version,
          s.subject,
          p.data.effectiveFrom,
          p.data.effectiveTo,
        ],
      );
      await event(q, s, 'form.mapping-drafted', id);
      return { id, version };
    });
  }
  async preview(s: Staff, project: string, id: string) {
    await this.assistance.projectForms(s, project);
    const [r] = await this.db.query(
      'SELECT * FROM form_field_mappings WHERE id=$1 AND organization_id=$2 AND project_id=$3',
      [uuid(id), s.organizationId, uuid(project)],
    );
    if (!r) throw new NotFoundException('Không có ánh xạ');
    const source = await this.assistance.pdf(String(r.form_id));
    const output = await renderOfficialForm({
      source: source.bytes,
      sourceHash: String(r.source_hash),
      fields: record(r.payload).fields as MappingField[],
      values: {},
      font: await readFile(
        resolve(__dirname, '../../../packages/form-engine/assets/DejaVuSerif.ttf'),
      ),
      trackingId: 'PREVIEW-' + r.id,
      mappingVersion: Number(r.version),
      inputHash: String(r.content_hash),
      timestamp: new Date(r.created_at as string).toISOString(),
      confirmed: false,
      debugCoordinates: true,
    });
    return {
      bytes: output.bytes,
      mime: 'application/pdf',
      filename: 'mapping-preview-' + r.id + '.pdf',
    };
  }
  async review(s: Staff, project: string, id: string, body: unknown) {
    if (!s.permissions?.includes('form_legal_approver'))
      throw new ForbiddenException('Cần quyền form_legal_approver');
    const b = record(body);
    if (
      b.accepted !== true ||
      !['approve', 'revoke'].includes(String(b.action)) ||
      Object.keys(b).some((k) => !['accepted', 'action'].includes(k))
    )
      throw new BadRequestException('Cần quyết định và xác nhận đã kiểm tra bản in');
    return this.db.tx(async (q) => {
      await q.query('SELECT id FROM projects WHERE id=$1 AND organization_id=$2 FOR UPDATE', [
        uuid(project),
        s.organizationId,
      ]);
      const r = (
        await q.query(
          'SELECT * FROM form_field_mappings WHERE id=$1 AND organization_id=$2 AND project_id=$3 FOR UPDATE',
          [uuid(id), s.organizationId, uuid(project)],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Không có ánh xạ');
      if (r.created_by === s.subject) throw new ForbiddenException('Người soạn không tự duyệt');
      if (r.status !== (b.action === 'approve' ? 'draft' : 'approved'))
        throw new ConflictException('Trạng thái đã thay đổi');
      if (b.action === 'approve') {
        await this.activeRelease(q, r);
        await q.query(
          "UPDATE form_field_mappings SET status='approved',approved_by=$2,approved_at=now() WHERE id=$1",
          [uuid(id), s.subject],
        );
      } else
        await q.query("UPDATE form_field_mappings SET status='revoked' WHERE id=$1", [uuid(id)]);
      await event(q, s, 'form.mapping-' + b.action, uuid(id));
      return { saved: true };
    });
  }
  private async activeRelease(q: Sql, r: Row) {
    const source = (await this.assistance.catalog()).forms.find((f) => f.id === r.form_id);
    if (!source || source.sha256 !== r.source_hash)
      throw new ConflictException('Nguồn mẫu đã thay đổi');
    const release = (
      await q.query(
        "SELECT * FROM project_form_releases WHERE id=$1 AND organization_id=$2 AND status='approved' AND effective_from<=CURRENT_DATE AND(effective_to IS NULL OR effective_to>=CURRENT_DATE) FOR SHARE",
        [r.release_id, r.organization_id],
      )
    ).rows[0];
    if (!release) throw new ConflictException('Hướng dẫn nguồn hết hiệu lực hoặc thu hồi');
    const latest = (
      await q.query(
        "SELECT id,status FROM project_form_releases WHERE organization_id=$1 AND project_id=$2 AND form_id=$3 AND mode=$4 AND subject_group=$5 AND status IN('approved','revoked') AND effective_from<=CURRENT_DATE ORDER BY version DESC LIMIT 1 FOR SHARE",
        [r.organization_id, r.project_id, release.form_id, release.mode, release.subject_group],
      )
    ).rows[0];
    if (latest?.id !== release.id || latest?.status !== 'approved')
      throw new ConflictException('Hướng dẫn đã được thay thế');
    return release;
  }
  private async activeMapping(q: Sql, c: Citizen, dossier: string, id: string) {
    const owned = await this.assistance.owner(q, c, dossier);
    await q.query('SELECT id FROM projects WHERE id=$1 AND organization_id=$2 FOR SHARE', [
      owned.project_id,
      c.organizationId,
    ]);
    const d = await this.assistance.owner(q, c, dossier, true),
      r = (
        await q.query(
          "SELECT * FROM form_field_mappings WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND status='approved' AND effective_from<=CURRENT_DATE AND(effective_to IS NULL OR effective_to>=CURRENT_DATE) FOR SHARE",
          [uuid(id), c.organizationId, d.project_id],
        )
      ).rows[0];
    if (!r) throw new ConflictException('Ánh xạ chưa được duyệt hoặc hết hiệu lực');
    const latest = (
      await q.query(
        "SELECT id,status FROM form_field_mappings WHERE organization_id=$1 AND release_id=$2 AND status IN('approved','revoked') AND effective_from<=CURRENT_DATE ORDER BY version DESC LIMIT 1 FOR SHARE",
        [c.organizationId, r.release_id],
      )
    ).rows[0];
    if (latest?.id !== r.id || latest?.status !== 'approved')
      throw new ConflictException('Ánh xạ đã thay thế hoặc thu hồi');
    const release = await this.activeRelease(q, r);
    return { d, r, release };
  }
  async workspace(c: Citizen, dossier: string) {
    const d = await this.db.tx((q) => this.assistance.owner(q, c, dossier));
    const all = await this.db.query(
      "SELECT * FROM form_field_mappings WHERE organization_id=$1 AND project_id=$2 AND status='approved' AND effective_from<=CURRENT_DATE AND(effective_to IS NULL OR effective_to>=CURRENT_DATE) ORDER BY created_at DESC LIMIT 200",
      [c.organizationId, d.project_id],
    );
    const mappings: Row[] = [];
    for (const r of all) {
      try {
        const { release } = await this.db.tx((q) =>
          this.activeMapping(q, c, dossier, String(r.id)),
        );
        mappings.push({
          id: r.id,
          version: r.version,
          source_hash: r.source_hash,
          form_id: r.form_id,
          mode: release.mode,
          subject_group: release.subject_group,
          ...record(r.payload),
        });
      } catch {
        /* Fail closed if source/release/mapping is revoked. */
      }
    }
    const generated = await this.db.query(
      'SELECT id,mapping_id,input_version,input_hash,sha256,status,confirmed_at,created_at,version FROM generated_forms WHERE organization_id=$1 AND dossier_id=$2 AND owner_user_id=$3 ORDER BY created_at DESC LIMIT 100',
      [c.organizationId, uuid(dossier), c.userId],
    );
    return {
      mappings,
      generated: generated.map((f) => ({
        ...f,
        usable:
          mappings.some((m) => m.id === f.mapping_id) &&
          Number(f.input_version) === Number(d.version),
      })),
      inputVersion: d.version,
    };
  }
  private scope(c: Citizen, id: string) {
    return 'generated-form:' + c.organizationId + ':' + c.userId + ':' + id;
  }
  private async render(
    r: Row,
    values: Record<string, string>,
    id: string,
    inputHash: string,
    timestamp: string,
    confirmed: boolean,
  ) {
    const source = await this.assistance.pdf(String(r.form_id));
    return renderOfficialForm({
      source: source.bytes,
      sourceHash: String(r.source_hash),
      fields: record(r.payload).fields as MappingField[],
      values,
      font: await readFile(
        resolve(__dirname, '../../../packages/form-engine/assets/DejaVuSerif.ttf'),
      ),
      trackingId: id,
      mappingVersion: Number(r.version),
      inputHash,
      timestamp,
      confirmed,
    });
  }
  async prepareFromEvidence(
    c: Citizen,
    dossier: string,
    mappingId: string,
    expected: number,
    context: { mode: string; group: number },
    transaction?: Sql,
  ) {
    const prepare = async (q: Sql) => {
      await this.privacy.assertProcessing(c, q);
      const { d, r, release } = await this.activeMapping(q, c, dossier, mappingId);
      if (release.mode !== context.mode || Number(release.subject_group) !== context.group)
        throw new ConflictException('Mẫu không đúng hình thức và nhóm đối tượng đã chọn');
      if (Number(d.version) !== expected)
        throw new ConflictException('Bản khai đã thay đổi, cần chuẩn bị lại');
      const [declaration] = (
        await q.query(
          'SELECT encrypted_payload FROM declaration_versions WHERE organization_id=$1 AND dossier_id=$2 AND version=$3',
          [c.organizationId, uuid(dossier), d.version],
        )
      ).rows;
      // Keep the same encryption context as DossierService; no model generates a field value.
      const data = declaration
        ? DeclarationSchema.parse(
            JSON.parse(
              unseal(
                Buffer.from(declaration.encrypted_payload as Uint8Array).toString('utf8'),
                'declaration:' + c.organizationId + ':' + c.userId + ':' + dossier,
              ),
            ),
          )
        : emptyDeclaration;
      const rows = (
        await q.query(
          `SELECT e.*,d.sha256 AS document_hash FROM document_extractions e JOIN documents d ON d.organization_id=e.organization_id AND d.dossier_id=e.dossier_id AND d.id=e.document_id WHERE e.organization_id=$1 AND e.dossier_id=$2 AND e.owner_user_id=$3 AND e.accepted_at IS NOT NULL AND e.input_version=$4 AND d.project_id=$5 AND d.owner_user_id=$3 AND d.deleted_at IS NULL AND d.scan_status='clean' AND e.source_hash=d.sha256 ORDER BY e.created_at DESC,e.id LIMIT 101 FOR SHARE OF e,d`,
          [c.organizationId, uuid(dossier), c.userId, d.version, d.project_id],
        )
      ).rows;
      if (rows.length > 100)
        throw new ConflictException('Có quá nhiều bản trích xuất; cần rà soát lại bộ giấy tờ');
      const candidates = new Map<string, { value: string; document?: string }[]>();
      const declared: Record<string, string> = {
        fullName: data.fullName,
        dateOfBirth: data.dateOfBirth,
        address: data.address,
        occupation: data.occupation,
      };
      for (const [key, value] of Object.entries(declared))
        if (value) candidates.set(key, [{ value }]);
      for (const ex of rows) {
        const accepted = JSON.parse(
          unseal(
            String(ex.accepted_cipher),
            'accepted-extraction:' + c.organizationId + ':' + c.userId + ':' + ex.id,
          ),
        );
        const fields = ExtractionSchema.parse({ fields: accepted, warnings: [] }).fields;
        for (const field of fields)
          if (field.value)
            candidates.set(field.key, [
              ...(candidates.get(field.key) ?? []),
              { value: field.value, document: String(ex.document_id) },
            ]);
      }
      const values: Record<string, string> = {},
        warnings: string[] = [],
        evidence = new Set<string>();
      for (const field of record(r.payload).fields as MappingField[]) {
        values[field.key] = '';
        if (field.externalConfirmation) {
          warnings.push(field.label + ': để trống phần xác nhận của cơ quan.');
          continue;
        }
        const list = candidates.get(field.key) ?? [],
          unique = new Set(list.map((v) => v.value));
        if (unique.size > 1) {
          warnings.push(
            field.label + ': có thông tin khác nhau giữa bản khai hoặc giấy tờ; cần bạn đối chiếu.',
          );
          continue;
        }
        if (unique.size === 1) {
          values[field.key] = list[0]!.value;
          for (const item of list) if (item.document) evidence.add(item.document);
        } else if (field.required)
          warnings.push(field.label + ': chưa có giá trị đã kiểm tra, để trống.');
      }
      if (evidence.size > 30)
        throw new ConflictException('Bản mẫu dẫn quá 30 giấy tờ; cần phân lại bộ hồ sơ');
      return {
        mappingId: String(r.id),
        title: String(record(r.payload).title),
        values,
        evidenceIds: [...evidence].sort(),
        warnings,
        scope: context,
        preparationHash: hashBytes(
          Buffer.from(
            JSON.stringify({
              inputVersion: expected,
              mappingId: r.id,
              mappingHash: r.content_hash,
              scope: context,
              values,
              extractions: rows.map((e) => ({
                id: e.id,
                sourceHash: e.source_hash,
                acceptedCipher: e.accepted_cipher,
              })),
            }),
          ),
        ),
      };
    };
    return transaction ? prepare(transaction) : this.db.tx(prepare);
  }
  async generate(c: Citizen, dossier: string, body: unknown, transaction?: Sql) {
    await this.privacy.assertProcessing(c, transaction);
    const p = GenerateFormSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Cần ánh xạ, phiên bản và dữ liệu điền mẫu');
    const generate = async (q: Sql) => {
      await this.privacy.assertProcessing(c, q);
      const { d, r } = await this.activeMapping(q, c, dossier, p.data.mappingId);
      if (Number(d.version) !== p.data.inputVersion)
        throw new ConflictException('Bản khai đã thay đổi, tải lại');
      const fields = record(r.payload).fields as MappingField[];
      if (Object.keys(p.data.values).some((k) => !fields.some((f) => f.key === k)))
        throw new BadRequestException('Có trường không thuộc mẫu đã duyệt');
      const evidence = [];
      for (const id of p.data.evidenceIds) {
        const doc = await this.documents.own(q, c, dossier, id, true);
        if (doc.scan_status !== 'clean')
          throw new ConflictException('Giấy tờ dẫn chứng chưa quét an toàn');
        evidence.push({ id: doc.id, sha256: doc.sha256 });
      }
      const count = Number(
        (
          await q.query(
            'SELECT count(*)::int AS n FROM generated_forms WHERE dossier_id=$1 AND organization_id=$2',
            [uuid(dossier), c.organizationId],
          )
        ).rows[0]!.n,
      );
      if (count >= 100) throw new ConflictException('Tối đa 100 bản PDF/hồ sơ');
      const id = randomUUID(),
        inputs = { values: p.data.values, evidence },
        inputHash = hashBytes(Buffer.from(JSON.stringify(inputs))),
        timestamp = new Date().toISOString();
      let output;
      try {
        output = await this.render(r, p.data.values, id, inputHash, timestamp, false);
      } catch {
        throw new BadRequestException(
          'Dữ liệu vượt vùng điền; hãy rút gọn hoặc yêu cầu chủ đầu tư rà soát ánh xạ',
        );
      }
      const encrypted = encryptObject(output.bytes, this.scope(c, id)),
        key = c.organizationId + '/' + c.userId + '/forms/' + id + '/draft';
      await this.storage.put(key, encrypted.bytes);
      await q.query(
        'INSERT INTO generated_forms(id,organization_id,project_id,dossier_id,owner_user_id,mapping_id,input_version,inputs_cipher,input_hash,object_key,envelope_key_cipher,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          id,
          c.organizationId,
          d.project_id,
          uuid(dossier),
          c.userId,
          r.id,
          d.version,
          seal(JSON.stringify(inputs), 'inputs:' + this.scope(c, id)),
          inputHash,
          key,
          encrypted.keyCipher,
          output.sha256,
        ],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'form.generated-draft',
        id,
      );
      return { id, missing: output.missing };
    };
    return transaction ? generate(transaction) : this.db.tx(generate);
  }
  private async own(q: Sql, c: Citizen, dossier: string, id: string) {
    await this.assistance.owner(q, c, dossier);
    const r = (
      await q.query(
        'SELECT * FROM generated_forms WHERE id=$1 AND organization_id=$2 AND dossier_id=$3 AND owner_user_id=$4 FOR UPDATE',
        [uuid(id), c.organizationId, uuid(dossier), c.userId],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Không có PDF trong hồ sơ');
    return r;
  }
  async detail(c: Citizen, dossier: string, id: string) {
    return this.db.tx(async (q) => {
      const r = await this.own(q, c, dossier, id);
      return {
        id: r.id,
        status: r.status,
        input_version: r.input_version,
        version: r.version,
        ...JSON.parse(unseal(String(r.inputs_cipher), 'inputs:' + this.scope(c, uuid(id)))),
      };
    });
  }
  async confirm(c: Citizen, dossier: string, id: string, body: unknown) {
    await this.privacy.assertProcessing(c);
    const b = record(body);
    if (
      b.accepted !== true ||
      !Array.isArray(b.checkedFields) ||
      Object.keys(b).some((k) => !['accepted', 'checkedFields'].includes(k))
    )
      throw new BadRequestException('Cần đọc bản in và xác nhận từng trường');
    return this.db.tx(async (q) => {
      await this.privacy.assertProcessing(c, q);
      const owned = await this.assistance.owner(q, c, dossier);
      await q.query('SELECT id FROM projects WHERE id=$1 AND organization_id=$2 FOR SHARE', [
        owned.project_id,
        c.organizationId,
      ]);
      await this.assistance.owner(q, c, dossier, true);
      const f = await this.own(q, c, dossier, id);
      if (f.status !== 'draft') throw new ConflictException('PDF đã xác nhận');
      const { d, r } = await this.activeMapping(q, c, dossier, String(f.mapping_id));
      if (Number(d.version) !== Number(f.input_version))
        throw new ConflictException('Bản khai đã thay đổi; cần tạo lại PDF');
      const inputs = JSON.parse(
        unseal(String(f.inputs_cipher), 'inputs:' + this.scope(c, uuid(id))),
      ) as { values: Record<string, string>; evidence: { id: string; sha256: string }[] };
      for (const e of inputs.evidence) {
        const doc = await this.documents.own(q, c, dossier, e.id, true);
        if (doc.scan_status !== 'clean' || doc.sha256 !== e.sha256)
          throw new ConflictException('Giấy tờ dẫn chứng không còn khả dụng');
      }
      const fields = record(r.payload).fields as MappingField[];
      if (
        fields.some((x) => !(b.checkedFields as unknown[]).includes(x.key)) ||
        (b.checkedFields as unknown[]).length !== fields.length
      )
        throw new BadRequestException(
          'Cần kiểm tra toàn bộ trường, kể cả trường để trống hoặc cần xác nhận bên ngoài',
        );
      let output;
      try {
        output = await this.render(
          r,
          inputs.values,
          uuid(id),
          String(f.input_hash),
          new Date(f.created_at as string).toISOString(),
          true,
        );
      } catch {
        throw new BadRequestException('Chưa đủ trường bắt buộc hoặc dữ liệu vượt vùng điền');
      }
      const encrypted = encryptObject(output.bytes, this.scope(c, uuid(id))),
        key = c.organizationId + '/' + c.userId + '/forms/' + uuid(id) + '/confirmed';
      await this.storage.put(key, encrypted.bytes);
      await q.query(
        "UPDATE generated_forms SET status='confirmed',confirmed_at=now(),object_key=$2,envelope_key_cipher=$3,sha256=$4,version=version+1 WHERE id=$1",
        [uuid(id), key, encrypted.keyCipher, output.sha256],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'form.citizen-confirmed',
        uuid(id),
      );
      return { confirmed: true, sha256: output.sha256 };
    });
  }
  async packet(c: Citizen, dossier: string) {
    // Existing private reads remain available after processing consent withdrawal.
    // Keep one snapshot locked until the actual ZIP bytes have been assembled.
    return this.db.tx(async (q) => {
      const owned = await this.assistance.owner(q, c, dossier);
      await q.query('SELECT id FROM projects WHERE id=$1 AND organization_id=$2 FOR SHARE', [
        owned.project_id,
        c.organizationId,
      ]);
      const d = await this.assistance.owner(q, c, dossier, true);
      const rows = (
        await q.query(
          "SELECT * FROM generated_forms WHERE organization_id=$1 AND project_id=$2 AND dossier_id=$3 AND owner_user_id=$4 AND status='confirmed' AND input_version=$5 ORDER BY created_at DESC,id LIMIT 21 FOR SHARE",
          [c.organizationId, d.project_id, uuid(dossier), c.userId, d.version],
        )
      ).rows;
      if (!rows.length)
        throw new ConflictException('Chưa có bản PDF đã kiểm tra của phiên bản bản khai hiện tại');
      if (rows.length > 20) throw new ConflictException('Bộ mẫu vượt 20 bản; hãy tải từng PDF');
      const entries: { name: string; bytes: Uint8Array }[] = [],
        manifest: Record<string, unknown>[] = [];
      for (const r of rows) {
        await this.activeMapping(q, c, dossier, String(r.mapping_id));
        const bytes = decryptObject(
          await this.storage.get(String(r.object_key)),
          String(r.envelope_key_cipher),
          this.scope(c, String(r.id)),
        );
        if (hashBytes(bytes) !== r.sha256)
          throw new ConflictException('PDF không khớp dấu kiểm chứng');
        entries.push({ name: 'form-' + r.id + '.pdf', bytes });
        manifest.push({
          id: r.id,
          mappingId: r.mapping_id,
          inputVersion: r.input_version,
          inputHash: r.input_hash,
          sha256: r.sha256,
          confirmedAt: r.confirmed_at,
        });
      }
      entries.push({
        name: 'manifest.json',
        bytes: Buffer.from(
          JSON.stringify(
            {
              schema: 'noxh-prepared-forms-v1',
              dossierId: uuid(dossier),
              inputVersion: d.version,
              notice:
                'Bộ mẫu do người khai kiểm tra. Không phải hồ sơ đã nộp, không chứng nhận đủ điều kiện, không thay xác nhận cơ quan. Cần đối chiếu danh mục hồ sơ của dự án và các giấy tờ bắt buộc.',
              forms: manifest,
            },
            null,
            2,
          ),
        ),
      });
      try {
        return {
          bytes: createFormPacket(entries),
          mime: 'application/zip',
          filename: 'prepared-forms-' + uuid(dossier) + '.zip',
        };
      } catch {
        throw new ConflictException('Bộ mẫu vượt giới hạn 20 MiB; hãy tải từng PDF');
      }
    });
  }
  async readForAuthorizedStaff(id: string, org: string) {
    const [r] = await this.db.query(
      "SELECT * FROM generated_forms WHERE id=$1 AND organization_id=$2 AND status='confirmed'",
      [uuid(id), uuid(org)],
    );
    if (!r) throw new NotFoundException('Không có PDF đã xác nhận');
    const scope = 'generated-form:' + r.organization_id + ':' + r.owner_user_id + ':' + r.id;
    const bytes = decryptObject(
      await this.storage.get(String(r.object_key)),
      String(r.envelope_key_cipher),
      scope,
    );
    if (hashBytes(bytes) !== r.sha256) throw new ConflictException('PDF không khớp dấu kiểm chứng');
    return { bytes, mime: 'application/pdf', filename: 'form-' + r.id + '.pdf' };
  }
  async download(c: Citizen, dossier: string, id: string) {
    const r = await this.db.tx((q) => this.own(q, c, dossier, id)),
      bytes = decryptObject(
        await this.storage.get(String(r.object_key)),
        String(r.envelope_key_cipher),
        this.scope(c, uuid(id)),
      );
    if (hashBytes(bytes) !== r.sha256) throw new ConflictException('PDF không khớp dấu kiểm chứng');
    return {
      bytes,
      mime: 'application/pdf',
      filename: 'form-' + uuid(id) + (r.status === 'draft' ? '-draft' : '') + '.pdf',
    };
  }
}
