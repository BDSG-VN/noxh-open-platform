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
  KnowledgeDraftSchema,
  KnowledgeSearchSchema,
  type KnowledgeCitation,
} from '@noxh/contracts';
import { Database, type Row, type Sql } from './database';
import { event, record, uuid } from './admin-service';
import { sha, seal, unseal } from './identity-crypto';
import type { Citizen } from './phone-service';
import type { Staff } from './workforce';

const normalize = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const stopwords = new Set([
  'toi',
  'can',
  'la',
  'va',
  'cua',
  'cho',
  'co',
  'gi',
  'nhu',
  'the',
  'nao',
  'duoc',
  'hay',
  've',
  'xin',
]);
function terms(s: string) {
  return [...new Set(normalize(s).match(/[a-z0-9]+/g) ?? [])].filter(
    (w) => w.length > 1 && !stopwords.has(w),
  );
}
export function retrieveKnowledge(query: string, rows: KnowledgeCitation[], maximum = 6) {
  const tokens = terms(query);
  if (!tokens.length) return [];
  return rows
    .map((r) => {
      const body = new Set(terms(r.excerpt)),
        title = new Set(terms(r.title));
      const hits = tokens.filter((t) => body.has(t) || title.has(t));
      return { r, score: hits.reduce((n, t) => n + (title.has(t) ? 3 : 1), 0) / tokens.length };
    })
    .filter((v) => v.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.r.revisionId.localeCompare(b.r.revisionId) || a.r.chunk - b.r.chunk,
    )
    .slice(0, maximum)
    .map((v, i) => ({ ...v.r, id: 'K' + (i + 1) }));
}

@Injectable()
export class KnowledgeService {
  constructor(@Inject(Database) readonly db: Database) {}
  private scope(org: string, id: string) {
    return 'knowledge:' + org + ':' + id;
  }
  private async staffScope(
    q: Sql,
    s: Staff,
    project: string,
    permission: 'records_write' | 'records_read' | 'form_legal_approver',
  ) {
    const p = (
      await q.query(
        'SELECT id FROM projects WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL',
        [uuid(project), s.organizationId],
      )
    ).rows[0];
    if (!p) throw new NotFoundException('Không có dự án trong tổ chức');
    if (s.role === 'org_admin' && permission !== 'form_legal_approver') return;
    if (s.role !== 'org_admin' && !s.projectIds?.includes(project))
      throw new ForbiddenException('Dự án ngoài phạm vi được giao');
    const e = (
      await q.query(
        "SELECT e.permissions FROM identity_private.investor_employees e JOIN investor_employee_projects g ON g.organization_id=e.organization_id AND g.employee_id=e.id WHERE e.organization_id=$1 AND e.subject=$2 AND e.status='active' AND g.project_id=$3 FOR SHARE OF e,g",
        [s.organizationId, s.subject, project],
      )
    ).rows[0];
    if (!(e?.permissions as string[] | undefined)?.includes(permission))
      throw new ForbiddenException('Chưa được cấp quyền cho thao tác tri thức');
  }
  private view(r: Row) {
    return {
      id: String(r.id),
      recordId: String(r.record_id),
      revision: Number(r.revision),
      title: String(r.title),
      content: unseal(
        String(r.content_cipher),
        this.scope(String(r.organization_id), String(r.id)),
      ),
      sourceUrl: String(r.source_url),
      sourceHash: String(r.source_hash),
      contentHash: String(r.content_hash),
      legalBasis: String(r.legal_basis),
      mode: String(r.mode),
      group: r.subject_group == null ? null : Number(r.subject_group),
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      status: String(r.status),
      createdBy: String(r.created_by),
      reviewedBy: r.reviewed_by,
    };
  }
  async list(s: Staff, project: string) {
    return this.db.tx(async (q) => {
      await this.staffScope(q, s, project, 'records_read');
      const rows = (
        await q.query(
          'SELECT * FROM identity_private.project_knowledge_revisions WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 200',
          [s.organizationId, uuid(project)],
        )
      ).rows;
      return { items: rows.map((r) => this.view(r)) };
    });
  }
  async draft(s: Staff, project: string, body: unknown) {
    const p = KnowledgeDraftSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException(
        'Kiểm tra nội dung, nguồn chính thức, mã SHA-256, phạm vi và ngày hiệu lực',
      );
    return this.db.tx(async (q) => {
      await this.staffScope(q, s, project, 'records_write');
      await q.query('SELECT id FROM projects WHERE id=$1 AND organization_id=$2 FOR UPDATE', [
        project,
        s.organizationId,
      ]);
      const b = p.data,
        id = randomUUID(),
        recordId = b.recordId ?? randomUUID();
      const rows = (
        await q.query(
          'SELECT revision FROM identity_private.project_knowledge_revisions WHERE organization_id=$1 AND project_id=$2 AND record_id=$3 ORDER BY revision DESC LIMIT 1',
          [s.organizationId, project, recordId],
        )
      ).rows;
      if (b.recordId && !rows.length)
        throw new NotFoundException('Không có tài liệu gốc trong dự án');
      const revision = Number(rows[0]?.revision ?? 0) + 1;
      await q.query(
        'INSERT INTO identity_private.project_knowledge_revisions(id,organization_id,project_id,record_id,revision,title,content_cipher,content_hash,source_url,source_hash,legal_basis,mode,subject_group,effective_from,effective_to,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
        [
          id,
          s.organizationId,
          project,
          recordId,
          revision,
          b.title,
          seal(b.content, this.scope(s.organizationId, id)),
          sha(b.content),
          b.sourceUrl,
          b.sourceHash,
          b.legalBasis,
          b.mode,
          b.group,
          b.effectiveFrom,
          b.effectiveTo,
          s.subject,
        ],
      );
      await event(q, s, 'knowledge.drafted', id);
      return { id, recordId, revision, status: 'draft' };
    });
  }
  async review(s: Staff, project: string, id: string, body: unknown) {
    const b = record(body);
    if (
      b.accepted !== true ||
      !['approve', 'revoke'].includes(String(b.action)) ||
      Object.keys(b).some((k) => !['accepted', 'action'].includes(k))
    )
      throw new BadRequestException('Cần quyết định rà soát riêng');
    return this.db.tx(async (q) => {
      await this.staffScope(q, s, project, 'form_legal_approver');
      await q.query('SELECT id FROM projects WHERE id=$1 AND organization_id=$2 FOR UPDATE', [
        project,
        s.organizationId,
      ]);
      const r = (
        await q.query(
          'SELECT * FROM identity_private.project_knowledge_revisions WHERE id=$1 AND organization_id=$2 AND project_id=$3 FOR UPDATE',
          [uuid(id), s.organizationId, uuid(project)],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Không có bản tài liệu');
      if (r.created_by === s.subject)
        throw new ForbiddenException('Người soạn không tự duyệt hoặc thu hồi tài liệu của mình');
      if (b.action === 'approve') {
        if (r.status !== 'draft') throw new ConflictException('Bản tài liệu không còn chờ duyệt');
        await q.query(
          "UPDATE identity_private.project_knowledge_revisions SET status='approved',reviewed_by=$2,reviewed_at=now() WHERE id=$1",
          [id, s.subject],
        );
      } else {
        if (r.status !== 'approved') throw new ConflictException('Chỉ thu hồi bản đã duyệt');
        await q.query(
          "UPDATE identity_private.project_knowledge_revisions SET status='revoked' WHERE id=$1",
          [id],
        );
      }
      await event(q, s, 'knowledge.' + (b.action === 'approve' ? 'approved' : 'revoked'), id);
      return { id, status: b.action === 'approve' ? 'approved' : 'revoked' };
    });
  }
  async search(c: Citizen, dossier: string, body: unknown) {
    const p = KnowledgeSearchSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Cần câu hỏi và phạm vi tìm kiếm hợp lệ');
    return this.db.tx(async (q) => {
      const d = (
        await q.query(
          'SELECT project_id FROM prep_dossiers WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3',
          [uuid(dossier), c.organizationId, c.userId],
        )
      ).rows[0];
      if (!d) throw new NotFoundException('Không có hồ sơ trong tài khoản của bạn');
      // Select latest effective reviewed revision BEFORE status/scope filters. Revocation
      // or a scope change must not resurrect an older approved revision.
      const rows = (
        await q.query(
          `SELECT * FROM (SELECT DISTINCT ON(record_id) * FROM identity_private.project_knowledge_revisions WHERE organization_id=$1 AND project_id=$2 AND status IN('approved','revoked') AND effective_from<=CURRENT_DATE ORDER BY record_id,revision DESC) latest WHERE status='approved' AND (effective_to IS NULL OR effective_to>=CURRENT_DATE) AND (mode='all' OR mode=$3) AND (subject_group IS NULL OR subject_group=$4) ORDER BY record_id LIMIT 201`,
          [c.organizationId, d.project_id, p.data.mode, p.data.group],
        )
      ).rows;
      if (rows.length > 200)
        throw new ConflictException(
          'Kho tri thức vượt phạm vi tìm kiếm; cần phân mục trước khi tiếp tục',
        );
      const chunks: KnowledgeCitation[] = [];
      for (const row of rows) {
        const r = this.view(row);
        if (sha(r.content) !== r.contentHash)
          throw new ConflictException('Nội dung tri thức không khớp dấu kiểm');
        // Fixed bounded chunks with overlap; deterministic and no remote embeddings.
        for (let start = 0, n = 1; start < r.content.length; start += 1000, n++)
          chunks.push({
            id: '',
            recordId: r.recordId,
            revisionId: r.id,
            revision: r.revision,
            title: r.title,
            sourceUrl: r.sourceUrl,
            sourceHash: r.sourceHash,
            contentHash: r.contentHash,
            legalBasis: r.legalBasis,
            excerpt: r.content.slice(start, start + 1200),
            chunk: n,
            mode: r.mode,
            group: r.group,
          });
      }
      return {
        items: retrieveKnowledge(p.data.query, chunks),
        strategy: 'project-approved-lexical-v1',
        scope: { mode: p.data.mode, group: p.data.group },
        notice:
          'Trích đoạn từ tài liệu chủ đầu tư duyệt; mã nguồn không tự xác nhận tính hợp pháp hoặc đầy đủ của nội dung.',
      };
    });
  }
}
