import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  EmployeeSchema,
  investorWorkflowTemplate,
  JournalSchema,
  operationPermissions,
  RecordSchema,
  TaskUpdateSchema,
} from '@noxh/contracts';
import type { EmployeeInput, TaskInput, RecordInput, JournalInput } from '@noxh/contracts';
import { Database, type Row, type Sql } from './database';
import { event, record, text, uuid } from './admin-service';
import { seal, sha, unseal } from './identity-crypto';
import type { Staff } from './workforce';
function parse<T>(
  schema: { safeParse: (body: unknown) => { success: boolean; data?: T } },
  body: unknown,
): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException('Dữ liệu không hợp lệ hoặc thiếu trường bắt buộc');
  return r.data!;
}
@Injectable()
export class OperationsService {
  constructor(@Inject(Database) readonly db: Database) {}
  async authorizeRecordFiles(s: Staff, project: string, write = false) {
    return this.db.tx((q) => this.scope(q, s, project, write ? 'records_write' : 'records_read'));
  }
  private async fileReadable(q: Sql, s: Staff, project: string, file: Row, allowPending = false) {
    if (file.created_by === s.subject) return true;
    await this.scope(q, s, project, 'records_read');
    const employee =
      s.role === 'org_admin'
        ? null
        : (
            await q.query(
              "SELECT permissions FROM identity_private.investor_employees WHERE organization_id=$1 AND subject=$2 AND status='active'",
              [s.organizationId, s.subject],
            )
          ).rows[0];
    const pending =
      allowPending &&
      (s.role === 'org_admin' ||
        Boolean((employee?.permissions as string[] | undefined)?.includes('records_review')));
    const bindings = (
      await q.query(
        "SELECT r.* FROM identity_private.investor_record_files b JOIN identity_private.investor_record_revisions r ON r.id=b.record_revision_id AND r.organization_id=b.organization_id AND r.project_id=b.project_id WHERE b.organization_id=$1 AND b.project_id=$2 AND b.file_id=$3 AND b.sha256=$4 AND (r.status='approved' OR($5::boolean AND r.status='draft')) FOR SHARE OF r",
        [s.organizationId, uuid(project), file.id, file.sha256, pending],
      )
    ).rows;
    for (const r of bindings)
      if (r.classification !== 'restricted' || (await this.restricted(q, s, String(r.created_by))))
        return true;
    return false;
  }
  async authorizeInternalFile(s: Staff, project: string, id: string, write = false) {
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, write ? 'records_write' : 'records_read');
      const file = (
        await q.query(
          'SELECT * FROM identity_private.investor_files WHERE id=$1 AND organization_id=$2 AND project_id=$3 FOR SHARE',
          [uuid(id), s.organizationId, uuid(project)],
        )
      ).rows[0];
      if (!file) throw new NotFoundException('Không có tệp trong phạm vi dự án');
      if (write && file.created_by !== s.subject)
        throw new ForbiddenException('Chỉ tác giả được quét lại tệp');
      if (!(await this.fileReadable(q, s, project, file, !write)))
        throw new NotFoundException('Tệp chưa thuộc tài liệu được phân quyền đọc hoặc kiểm tra');
      return file;
    });
  }
  private admin(s: Staff) {
    if (s.role !== 'org_admin')
      throw new ForbiddenException('Chỉ quản trị tổ chức quản lý quyền nhân sự');
  }
  private async restricted(q: Sql, s: Staff, author: string) {
    if (s.role === 'org_admin' || s.subject === author) return true;
    const r = (
      await q.query(
        "SELECT department,permissions FROM identity_private.investor_employees WHERE organization_id=$1 AND subject=$2 AND status='active'",
        [s.organizationId, s.subject],
      )
    ).rows[0];
    return Boolean(
      r && (r.department === 'legal' || (r.permissions as string[]).includes('records_review')),
    );
  }
  private async scope(
    q: Sql,
    s: Staff,
    project: string,
    permission: (typeof operationPermissions)[number],
  ) {
    project = uuid(project);
    const p = (
      await q.query(
        'SELECT id,name FROM projects WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL',
        [project, s.organizationId],
      )
    ).rows[0];
    if (!p) throw new NotFoundException('Không có dự án');
    if (s.role === 'org_admin') return p;
    const a = (
      await q.query(
        "SELECT e.permissions FROM identity_private.investor_employees e JOIN investor_employee_projects g ON g.organization_id=e.organization_id AND g.employee_id=e.id WHERE e.organization_id=$1 AND e.subject=$2 AND e.status='active' AND g.project_id=$3 FOR SHARE OF e,g",
        [s.organizationId, s.subject, project],
      )
    ).rows[0];
    if (!a || !(a.permissions as string[]).includes(permission))
      throw new ForbiddenException('Không được cấp quyền thao tác này tại dự án');
    return p;
  }
  async projects(s: Staff) {
    return this.db.tx(async (q) => {
      if (s.role === 'org_admin')
        return (
          await q.query(
            'SELECT id,name,locality FROM projects WHERE organization_id=$1 AND archived_at IS NULL ORDER BY name',
            [s.organizationId],
          )
        ).rows;
      return (
        await q.query(
          "SELECT p.id,p.name,p.locality FROM projects p JOIN investor_employee_projects g ON g.project_id=p.id AND g.organization_id=p.organization_id JOIN identity_private.investor_employees e ON e.id=g.employee_id AND e.organization_id=g.organization_id WHERE p.organization_id=$1 AND e.subject=$2 AND e.status='active' AND p.archived_at IS NULL ORDER BY p.name",
          [s.organizationId, s.subject],
        )
      ).rows;
    });
  }
  async employees(s: Staff) {
    this.admin(s);
    const rows = await this.db.query(
      'SELECT id,subject,name,department,status,permissions,version FROM identity_private.investor_employees WHERE organization_id=$1 ORDER BY name LIMIT 200',
      [s.organizationId],
    );
    return Promise.all(
      rows.map(async (r) => ({
        ...r,
        projectIds: (
          await this.db.query(
            'SELECT project_id FROM investor_employee_projects WHERE organization_id=$1 AND employee_id=$2',
            [s.organizationId, r.id],
          )
        ).map((g) => g.project_id),
      })),
    );
  }
  async saveEmployee(s: Staff, body: unknown, id?: string, expected?: number) {
    this.admin(s);
    const b = parse<EmployeeInput>(EmployeeSchema, body);
    return this.db.tx(async (q) => {
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'employees:' + s.organizationId,
      ]);
      const ref = id ? uuid(id) : randomUUID();
      const projectIds = [...new Set(b.projectIds.map(uuid))];
      for (const p of projectIds) await this.scope(q, s, p, 'workflow_read');
      if (id) {
        const old = (
          await q.query(
            'SELECT subject,version FROM identity_private.investor_employees WHERE id=$1 AND organization_id=$2 FOR UPDATE',
            [ref, s.organizationId],
          )
        ).rows[0];
        if (!old) throw new NotFoundException();
        if (old.version !== expected) throw new ConflictException('Quyền nhân sự đã thay đổi');
        if (old.subject !== b.subject)
          throw new BadRequestException('Không được đổi danh tính Keycloak; tạo tài khoản mới');
        await q.query(
          'UPDATE identity_private.investor_employees SET name=$1,department=$2,status=$3,permissions=$4,version=version+1,updated_at=now() WHERE id=$5 AND organization_id=$6',
          [b.name, b.department, b.status, [...new Set(b.permissions)], ref, s.organizationId],
        );
      } else {
        if (
          (
            await q.query(
              'SELECT id FROM identity_private.investor_employees WHERE organization_id=$1 AND subject=$2',
              [s.organizationId, b.subject],
            )
          ).rows.length
        )
          throw new ConflictException('Danh tính đã có tài khoản nhân sự');
        await q.query(
          'INSERT INTO identity_private.investor_employees(id,organization_id,subject,name,department,status,permissions) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            ref,
            s.organizationId,
            b.subject,
            b.name,
            b.department,
            b.status,
            [...new Set(b.permissions)],
          ],
        );
      }
      await q.query(
        'DELETE FROM investor_employee_projects WHERE organization_id=$1 AND employee_id=$2',
        [s.organizationId, ref],
      );
      for (const p of projectIds)
        await q.query(
          'INSERT INTO investor_employee_projects(organization_id,employee_id,project_id) VALUES($1,$2,$3)',
          [s.organizationId, ref, p],
        );
      await event(q, s, 'employee.permissions.changed', ref);
      return { id: ref, version: id ? expected! + 1 : 1 };
    });
  }
  private async workflowRow(
    q: Sql,
    s: Staff,
    project: string,
    permission: (typeof operationPermissions)[number],
  ) {
    await this.scope(q, s, project, permission);
    const w = (
      await q.query(
        'SELECT * FROM investor_workflows WHERE organization_id=$1 AND project_id=$2 FOR UPDATE',
        [s.organizationId, uuid(project)],
      )
    ).rows[0];
    if (!w) throw new NotFoundException('Chưa khởi tạo kế hoạch dự án');
    return w;
  }
  private taskPayload(r: Row) {
    return JSON.parse(
      unseal(
        String(r.payload_cipher),
        'operation-task:' + r.organization_id + ':' + r.workflow_id + ':' + r.code,
      ),
    ) as { note: string; evidence: unknown };
  }
  async workflow(s: Staff, project: string) {
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'workflow_read');
      const w = (
        await q.query(
          'SELECT * FROM investor_workflows WHERE organization_id=$1 AND project_id=$2',
          [s.organizationId, uuid(project)],
        )
      ).rows[0];
      if (!w) return null;
      const tasks = (
        await q.query(
          'SELECT * FROM investor_workflow_tasks WHERE organization_id=$1 AND workflow_id=$2 ORDER BY code',
          [s.organizationId, w.id],
        )
      ).rows.map((r) => ({
        ...r,
        ...(r.definition as object),
        ...this.taskPayload(r),
        code: String(r.code),
        status: String(r.status),
        payload_cipher: undefined,
        definition: undefined,
        updatedBy: r.updated_by,
        reviewedBy: r.reviewed_by,
      }));
      return { ...w, status: String(w.status), tasks };
    });
  }
  async initialize(s: Staff, project: string) {
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'workflow_write');
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'workflow:' + s.organizationId + ':' + uuid(project),
      ]);
      if (
        (
          await q.query(
            'SELECT id FROM investor_workflows WHERE organization_id=$1 AND project_id=$2',
            [s.organizationId, uuid(project)],
          )
        ).rows.length
      )
        throw new ConflictException('Kế hoạch đã được tạo');
      const id = randomUUID();
      await q.query(
        'INSERT INTO investor_workflows(id,organization_id,project_id,created_by) VALUES($1,$2,$3,$4)',
        [id, s.organizationId, uuid(project), s.subject],
      );
      for (const t of investorWorkflowTemplate)
        await q.query(
          'INSERT INTO investor_workflow_tasks(organization_id,workflow_id,code,definition,payload_cipher) VALUES($1,$2,$3,$4,$5)',
          [
            s.organizationId,
            id,
            t.code,
            JSON.stringify(t),
            seal(
              JSON.stringify({ note: '', evidence: null }),
              'operation-task:' + s.organizationId + ':' + id + ':' + t.code,
            ),
          ],
        );
      await event(q, s, 'workflow.created', id);
      return { id };
    });
  }
  async activate(s: Staff, project: string, body: unknown, expected: number) {
    const b = record(body);
    if (b.reviewed !== true) throw new BadRequestException('Cần xác nhận đã rà soát nhánh pháp lý');
    const note = text(b.note, 3000);
    return this.db.tx(async (q) => {
      const w = await this.workflowRow(q, s, project, 'workflow_review');
      if (w.version !== expected || w.status !== 'draft')
        throw new ConflictException('Kế hoạch đã thay đổi');
      if (w.created_by === s.subject)
        throw new ForbiddenException('Người khác người tạo phải rà soát kế hoạch');
      await q.query(
        "UPDATE investor_workflows SET status='active',legal_note=$1,reviewed_by=$2,version=version+1,updated_at=now() WHERE id=$3",
        [note, s.subject, w.id],
      );
      await event(q, s, 'workflow.legal-review.recorded', String(w.id));
      return { status: 'active' };
    });
  }
  async updateTask(s: Staff, project: string, code: string, body: unknown, expected: number) {
    const b = parse<TaskInput>(TaskUpdateSchema, body);
    return this.db.tx(async (q) => {
      const w = await this.workflowRow(q, s, project, 'workflow_write');
      if (w.status !== 'active')
        throw new ConflictException('Cần người khác rà soát kế hoạch trước khi cập nhật');
      const t = (
        await q.query(
          'SELECT * FROM investor_workflow_tasks WHERE organization_id=$1 AND workflow_id=$2 AND code=$3 FOR UPDATE',
          [s.organizationId, w.id, code],
        )
      ).rows[0];
      if (!t) throw new NotFoundException('Không có công việc');
      if (t.version !== expected) throw new ConflictException('Công việc đã thay đổi');
      if (['completed', 'not_applicable'].includes(String(t.status)))
        throw new ConflictException(
          'Công việc đã chốt; tạo hồ sơ điều chỉnh có kiểm soát ngoài phiên bản này',
        );
      const definition = t.definition as (typeof investorWorkflowTemplate)[number];
      if (b.status === 'not_applicable' && (!definition.conditional || b.note.length < 20))
        throw new BadRequestException('Chỉ bỏ qua bước có điều kiện với căn cứ cụ thể');
      if (b.status === 'evidence_recorded' && !b.evidence)
        throw new BadRequestException('Cần mã tham chiếu, ngày và SHA-256 chứng cứ');
      if (definition.external && b.evidence && !b.evidence.authority.trim())
        throw new BadRequestException('Cần tên cơ quan ban hành chứng cứ');
      // A request to mark a conditional task not applicable is reviewed, never silently skipped.
      const payload = {
        note: b.note,
        evidence: b.evidence,
        requestedNotApplicable: b.status === 'not_applicable',
      };
      await q.query(
        'UPDATE investor_workflow_tasks SET status=$1,payload_cipher=$2,updated_by=$3,reviewed_by=NULL,version=version+1,updated_at=now() WHERE organization_id=$4 AND workflow_id=$5 AND code=$6',
        [
          b.status === 'not_applicable' ? 'evidence_recorded' : b.status,
          seal(
            JSON.stringify(payload),
            'operation-task:' + s.organizationId + ':' + w.id + ':' + code,
          ),
          s.subject,
          s.organizationId,
          w.id,
          code,
        ],
      );
      await event(q, s, 'workflow.task.updated', String(w.id) + ':' + code);
      return { version: expected + 1 };
    });
  }
  async completeTask(s: Staff, project: string, code: string, expected: number) {
    return this.db.tx(async (q) => {
      const w = await this.workflowRow(q, s, project, 'workflow_review');
      if (w.status !== 'active') throw new ConflictException('Kế hoạch chưa được rà soát');
      const tasks = (
        await q.query(
          'SELECT * FROM investor_workflow_tasks WHERE organization_id=$1 AND workflow_id=$2 FOR UPDATE',
          [s.organizationId, w.id],
        )
      ).rows;
      const t = tasks.find((r) => r.code === code);
      if (!t) throw new NotFoundException();
      if (t.version !== expected || t.status !== 'evidence_recorded')
        throw new ConflictException('Cần chứng cứ/căn cứ chờ duyệt đúng phiên bản');
      if (!t.updated_by || t.updated_by === s.subject)
        throw new ForbiddenException('Không được tự duyệt công việc đã cập nhật');
      const p = this.taskPayload(t) as {
        note: string;
        evidence: unknown;
        requestedNotApplicable?: boolean;
      };
      const def = t.definition as (typeof investorWorkflowTemplate)[number];
      if (
        !p.requestedNotApplicable &&
        def.dependencies.some(
          (d) =>
            !tasks.some(
              (x) => x.code === d && ['completed', 'not_applicable'].includes(String(x.status)),
            ),
        )
      )
        throw new ConflictException('Còn bước phụ thuộc chưa hoàn tất/được duyệt không áp dụng');
      if (!p.requestedNotApplicable && !p.evidence) throw new BadRequestException('Thiếu chứng cứ');
      await q.query(
        'UPDATE investor_workflow_tasks SET status=$1,reviewed_by=$2,version=version+1,updated_at=now() WHERE organization_id=$3 AND workflow_id=$4 AND code=$5',
        [
          p.requestedNotApplicable ? 'not_applicable' : 'completed',
          s.subject,
          s.organizationId,
          w.id,
          code,
        ],
      );
      await event(q, s, 'workflow.task.reviewed', String(w.id) + ':' + code);
      return { version: expected + 1 };
    });
  }
  async records(s: Staff, project: string) {
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'records_read');
      const rows = (
        await q.query(
          'SELECT * FROM identity_private.investor_record_revisions WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 200',
          [s.organizationId, uuid(project)],
        )
      ).rows;
      const visible = [];
      for (const r of rows) {
        if (
          r.classification === 'restricted' &&
          !(await this.restricted(q, s, String(r.created_by)))
        )
          continue;
        visible.push({
          ...r,
          ...JSON.parse(
            unseal(String(r.payload_cipher), 'internal-record:' + s.organizationId + ':' + r.id),
          ),
          payload_cipher: undefined,
        });
      }
      return visible;
    });
  }
  async saveRecord(s: Staff, project: string, body: unknown) {
    const b = parse<RecordInput>(RecordSchema, body);
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'records_write');
      const recordId = b.recordId ? uuid(b.recordId) : randomUUID();
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'record:' + s.organizationId + ':' + recordId,
      ]);
      let revision = 1;
      if (b.recordId) {
        const old = (
          await q.query(
            'SELECT revision,classification,created_by FROM identity_private.investor_record_revisions WHERE organization_id=$1 AND project_id=$2 AND record_id=$3 ORDER BY revision DESC LIMIT 1',
            [s.organizationId, uuid(project), recordId],
          )
        ).rows[0];
        if (!old) throw new NotFoundException('Không có tài liệu gốc tại dự án');
        if (
          old.classification === 'restricted' &&
          !(await this.restricted(q, s, String(old.created_by)))
        )
          throw new ForbiddenException('Tài liệu hạn chế');
        if (old.classification === 'restricted' && b.classification !== 'restricted')
          throw new ForbiddenException(
            'Không được hạ phân loại tài liệu hạn chế; tạo bản công bố đã rà soát riêng nếu cần',
          );
        revision = Number(old.revision) + 1;
      }
      let attachment = b.attachment,
        file: Row | undefined;
      if (attachment?.reference.startsWith('file:')) {
        const fileId = uuid(attachment.reference.slice(5));
        file = (
          await q.query(
            "SELECT * FROM identity_private.investor_files WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND scan_status='clean' FOR SHARE",
            [fileId, s.organizationId, uuid(project)],
          )
        ).rows[0];
        if (!file || file.sha256 !== attachment.sha256)
          throw new BadRequestException('Tệp phải thuộc dự án, đã quét an toàn và khớp SHA256');
        if (b.classification !== 'restricted')
          throw new ForbiddenException('Tệp lưu trữ riêng chỉ gắn với tài liệu Hạn chế');
        if (!(await this.fileReadable(q, s, project, file, false)))
          throw new ForbiddenException(
            'Không được gắn tệp của người khác chưa có quyền đọc bản tài liệu đã duyệt',
          );
        attachment = { reference: 'file:' + fileId, sha256: String(file.sha256) };
      }
      const id = randomUUID(),
        payload = JSON.stringify({ body: b.body, attachment }),
        hash = sha(JSON.stringify([b.title, b.kind, b.classification, b.body, attachment]));
      await q.query(
        'INSERT INTO identity_private.investor_record_revisions(id,organization_id,project_id,record_id,revision,title,kind,classification,payload_cipher,content_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          id,
          s.organizationId,
          uuid(project),
          recordId,
          revision,
          b.title,
          b.kind,
          b.classification,
          seal(payload, 'internal-record:' + s.organizationId + ':' + id),
          hash,
          s.subject,
        ],
      );
      if (file)
        await q.query(
          'INSERT INTO identity_private.investor_record_files(record_revision_id,file_id,organization_id,project_id,sha256) VALUES($1,$2,$3,$4,$5)',
          [id, file.id, s.organizationId, uuid(project), file.sha256],
        );
      await event(q, s, 'record.revision.created', id);
      return { id, recordId, revision, contentHash: hash };
    });
  }
  async reviewRecord(s: Staff, project: string, id: string, body: unknown, expected: number) {
    const b = record(body);
    if (!['approve', 'revoke'].includes(String(b.action))) throw new BadRequestException();
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'records_review');
      const r = (
        await q.query(
          'SELECT * FROM identity_private.investor_record_revisions WHERE id=$1 AND organization_id=$2 AND project_id=$3 FOR UPDATE',
          [uuid(id), s.organizationId, uuid(project)],
        )
      ).rows[0];
      if (!r) throw new NotFoundException();
      if (r.version !== expected || r.status !== (b.action === 'approve' ? 'draft' : 'approved'))
        throw new ConflictException('Phiên bản/trạng thái đã thay đổi');
      if (r.created_by === s.subject)
        throw new ForbiddenException('Không được duyệt tài liệu tự soạn');
      if (b.action === 'approve') {
        const bad = (
          await q.query(
            'SELECT f.id,f.scan_status,f.sha256,b.sha256 AS bound_hash FROM identity_private.investor_record_files b JOIN identity_private.investor_files f ON f.id=b.file_id AND f.organization_id=b.organization_id AND f.project_id=b.project_id WHERE b.record_revision_id=$1 FOR SHARE OF f',
            [uuid(id)],
          )
        ).rows;
        if (bad.some((f) => f.scan_status !== 'clean' || f.sha256 !== f.bound_hash))
          throw new ConflictException('Tệp đính kèm không còn đạt kiểm tra an toàn hoặc toàn vẹn');
      }
      await q.query(
        'UPDATE identity_private.investor_record_revisions SET status=$1,reviewed_by=$2,version=version+1 WHERE id=$3',
        [b.action === 'approve' ? 'approved' : 'revoked', s.subject, uuid(id)],
      );
      await event(q, s, 'record.' + String(b.action), uuid(id));
      return { version: expected + 1 };
    });
  }
  async journals(s: Staff, project: string) {
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'finance_read');
      return (
        await q.query(
          'SELECT * FROM identity_private.investor_journals WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 200',
          [s.organizationId, uuid(project)],
        )
      ).rows.map((r) => ({
        ...r,
        ...JSON.parse(
          unseal(String(r.payload_cipher), 'internal-journal:' + s.organizationId + ':' + r.id),
        ),
        payload_cipher: undefined,
      }));
    });
  }
  async createJournal(s: Staff, project: string, body: unknown) {
    const b = parse<JournalInput>(JournalSchema, body);
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'finance_write');
      const id = randomUUID(),
        payload = JSON.stringify(b),
        total = b.lines.reduce((sum, line) => sum + line.debit, 0);
      await q.query(
        'INSERT INTO identity_private.investor_journals(id,organization_id,project_id,journal_date,payload_cipher,content_hash,debit_total,credit_total,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8)',
        [
          id,
          s.organizationId,
          uuid(project),
          b.date,
          seal(payload, 'internal-journal:' + s.organizationId + ':' + id),
          sha(payload),
          total,
          s.subject,
        ],
      );
      await event(q, s, 'journal.draft.created', id);
      return { id };
    });
  }
  async postJournal(s: Staff, project: string, id: string, expected: number) {
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'finance_post');
      const r = (
        await q.query(
          'SELECT * FROM identity_private.investor_journals WHERE id=$1 AND organization_id=$2 AND project_id=$3 FOR UPDATE',
          [uuid(id), s.organizationId, uuid(project)],
        )
      ).rows[0];
      if (!r) throw new NotFoundException();
      if (r.status !== 'draft' || r.version !== expected)
        throw new ConflictException('Bút toán đã thay đổi/ghi sổ');
      if (r.created_by === s.subject)
        throw new ForbiddenException('Người lập không được tự ghi sổ');
      await q.query(
        "UPDATE identity_private.investor_journals SET status='posted',posted_by=$1,posted_at=now(),version=version+1 WHERE id=$2",
        [s.subject, uuid(id)],
      );
      await event(q, s, 'journal.posted', uuid(id));
      return { version: expected + 1 };
    });
  }
}
