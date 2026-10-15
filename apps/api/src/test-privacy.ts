import { randomUUID } from 'node:crypto';
import { Database } from './database';
import { PrivacyService } from './privacy-service';
import type { Citizen } from './phone-service';
/** Synthetic test personas explicitly accept a synthetic notice; never used by runtime/seed. */
export async function seedSyntheticPrivacy(db: Database, citizens: Citizen[]) {
  for (const org of [...new Set(citizens.map((c) => c.organizationId))]) {
    const id = randomUUID();
    await db.query(
      "INSERT INTO privacy_notices(id,organization_id,version,payload,content_hash,created_by,status,approved_by,approved_at) SELECT $1,$2,COALESCE(max(version),0)+1,'{}',$3,'SYNTHETIC TEST AUTHOR','approved','SYNTHETIC TEST REVIEWER',now() FROM privacy_notices WHERE organization_id=$2",
      [id, org, 'c'.repeat(64)],
    );
    for (const c of citizens.filter((c) => c.organizationId === org))
      await new PrivacyService(db).choose(c, {
        noticeId: id,
        contentHash: 'c'.repeat(64),
        accepted: true,
      });
  }
}
