import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
await test('embedded PostgreSQL executes migration, constraints and non-superuser RLS', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(await readFile('db/migrations/001_foundation.sql', 'utf8'));
    await db.exec(await readFile('db/migrations/002_admin_and_phone_auth.sql', 'utf8'));
    await db.exec(await readFile('db/migrations/003_preparation_workflow.sql', 'utf8'));
    await db.exec(await readFile('db/migrations/004_assistance.sql', 'utf8'));
    await db.exec(await readFile('db/migrations/005_partner_workspace.sql', 'utf8'));
    await db.exec(await readFile('db/migrations/006_campaign_project_guard.sql', 'utf8'));
    await db.exec(await readFile('db/fixtures/seed.sql', 'utf8'));
    const scope = async (
      project = '20000000-0000-4000-8000-000000000001',
      owner = '30000000-0000-4000-8000-000000000001',
    ) => {
      await db.exec('BEGIN; SET LOCAL ROLE noxh_runtime;');
      await db.query(
        "SELECT set_config('app.organization_id',$1,true),set_config('app.project_id',$2,true),set_config('app.user_id',$3,true)",
        ['10000000-0000-4000-8000-000000000001', project, owner],
      );
    };
    await t.test('owner can read scoped dossier', async () => {
      await scope();
      assert.equal((await db.query('SELECT * FROM prep_dossiers')).rows.length, 1);
      await db.exec('ROLLBACK');
    });
    await t.test('guessed dossier UUID cannot cross owner', async () => {
      await scope(undefined, '30000000-0000-4000-8000-000000000099');
      assert.equal(
        (
          await db.query(
            "SELECT * FROM prep_dossiers WHERE id='40000000-0000-4000-8000-000000000001'",
          )
        ).rows.length,
        0,
      );
      await db.exec('ROLLBACK');
    });
    await t.test('same owner cannot cross project', async () => {
      await scope('20000000-0000-4000-8000-000000000002');
      assert.equal((await db.query('SELECT * FROM prep_dossiers')).rows.length, 0);
      await db.exec('ROLLBACK');
    });
    await t.test('missing transaction scopes deny read', async () => {
      await db.exec('BEGIN; SET LOCAL ROLE noxh_runtime;');
      assert.equal((await db.query('SELECT * FROM prep_dossiers')).rows.length, 0);
      await db.exec('ROLLBACK');
    });
    await t.test('cross-project write rejected by RLS', async () => {
      await scope();
      await assert.rejects(
        db.query(
          "INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES('40000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001')",
        ),
        (e) => e.code === '42501',
      );
      await db.exec('ROLLBACK');
    });
    await t.test(
      'composite FK rejects cross-organization relationship even for privileged writer',
      async () => {
        await db.exec(
          "BEGIN; INSERT INTO organizations(id,name) VALUES('10000000-0000-4000-8000-000000000002','Other synthetic org');",
        );
        await assert.rejects(
          db.query(
            "INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES('40000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001')",
          ),
          (e) => e.code === '23503',
        );
        await db.exec('ROLLBACK');
      },
    );
  } finally {
    await db.close();
  }
});
