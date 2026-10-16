// Static inventory of SQL issued by the API runtime (apps/api/src, excluding tests).
// Used to derive and verify least-privilege grants for the runtime database role.
// Pure source analysis: no database connection, no network, no secrets.
import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceDir = join(root, 'apps/api/src');
const methods = new Set(['query', 'exec']);

const MAX_VARIANTS = 16;
const cross = (a, b) => {
  const out = [];
  for (const x of a) for (const y of b) out.push(x + y);
  return [...new Set(out)].slice(0, MAX_VARIANTS);
};

/**
 * All statically knowable string values of an expression. Conditional fragments expand to every
 * branch; an unknown operand inside a `+` chain counts as empty and marks the result partial.
 */
function variants(node, constants, state) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) return variants(node.expression, constants, state);
  if (ts.isConditionalExpression(node)) {
    const a = variants(node.whenTrue, constants, state);
    const b = variants(node.whenFalse, constants, state);
    return a && b ? [...new Set([...a, ...b])].slice(0, MAX_VARIANTS) : undefined;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    let left = variants(node.left, constants, state);
    let right = variants(node.right, constants, state);
    if (!left && !right) return undefined;
    if (!left || !right) state.partial = true;
    return cross(left ?? [''], right ?? ['']);
  }
  if (ts.isIdentifier(node) && constants.has(node.text)) return constants.get(node.text);
  if (ts.isTemplateExpression(node)) {
    let out = [node.head.text];
    for (const span of node.templateSpans) {
      const value = variants(span.expression, constants, state);
      if (!value) return undefined;
      out = cross(cross(out, value), [span.literal.text]);
    }
    return out;
  }
  return undefined;
}

/** `const NAME = '...'` strings anywhere in the file; ambiguous names are dropped. */
function collectConstants(file) {
  const constants = new Map();
  const ambiguous = new Set();
  const visit = (node) => {
    if (ts.isVariableDeclarationList(node) && node.flags & ts.NodeFlags.Const)
      for (const d of node.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const value = variants(d.initializer, constants, {});
        if (!value) continue;
        if (constants.has(d.name.text)) ambiguous.add(d.name.text);
        constants.set(d.name.text, value);
      }
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const name of ambiguous) constants.delete(name);
  return constants;
}

export async function sqlInventory() {
  const files = (await readdir(sourceDir))
    .filter(
      (n) =>
        n.endsWith('.ts') &&
        !/\.test\.ts$/.test(n) &&
        !['test-privacy.ts', 'test-runtime-role.ts'].includes(n),
    )
    .sort();
  const statements = [];
  const dynamic = [];
  for (const name of files) {
    const path = join(sourceDir, name);
    const text = await readFile(path, 'utf8');
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true);
    const constants = collectConstants(file);
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        methods.has(node.expression.name.text) &&
        node.arguments.length
      ) {
        const location = `${relative(root, path)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        const state = { partial: false };
        const values = variants(node.arguments[0], constants, state);
        if (!values) dynamic.push({ location });
        else
          for (const value of values)
            if (/^\s*(WITH|SELECT|INSERT|UPDATE|DELETE)\b/i.test(value))
              statements.push({ location, sql: value.trim(), partial: state.partial });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return { statements, dynamic };
}

const ident = String.raw`((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)`;
const normalize = (name) => {
  const clean = name.replaceAll('"', '').toLowerCase();
  return clean.includes('.') ? clean : 'public.' + clean;
};

/** Table-level privileges a statement needs. Conservative superset; verified against PostgreSQL. */
export function requiredPrivileges(sql) {
  const s = sql.replace(/--[^\n]*/g, ' ').replace(/'(?:[^']|'')*'/g, "''");
  const needs = [];
  const add = (table, privilege) => needs.push([normalize(table), privilege]);
  const cteNames = new Set(
    [
      ...s.matchAll(
        new RegExp(
          String.raw`(?:WITH|,)\s*(?:RECURSIVE\s+)?${ident}\s+AS\s*(?:NOT\s+)?(?:MATERIALIZED\s+)?\(`,
          'gi',
        ),
      ),
    ].map((m) => normalize(m[1])),
  );
  for (const m of s.matchAll(new RegExp(String.raw`\bINSERT\s+INTO\s+${ident}`, 'gi'))) {
    add(m[1], 'INSERT');
    if (/\bON\s+CONFLICT\b[\s\S]*?\bDO\s+UPDATE\b/i.test(s)) add(m[1], 'UPDATE');
    if (/\bON\s+CONFLICT\b/i.test(s) || /\bRETURNING\b/i.test(s)) add(m[1], 'SELECT');
  }
  for (const m of s.matchAll(
    new RegExp(String.raw`\bUPDATE\s+${ident}(?:\s+(?:AS\s+)?[a-z_][a-z0-9_]*)?\s+SET\b`, 'gi'),
  )) {
    add(m[1], 'UPDATE');
    add(m[1], 'SELECT');
  }
  for (const m of s.matchAll(new RegExp(String.raw`\bDELETE\s+FROM\s+${ident}`, 'gi'))) {
    add(m[1], 'DELETE');
    add(m[1], 'SELECT');
  }
  for (const m of s.matchAll(new RegExp(String.raw`\b(?:FROM|JOIN|USING)\s+${ident}`, 'gi'))) {
    const before = s.slice(Math.max(0, m.index - 12), m.index);
    if (/(?:DELETE|DISTINCT)\s*$/i.test(before)) continue;
    if (/^(?:new|old)\./i.test(m[1])) continue;
    // System catalogs are readable by every role; they are not application tables.
    if (/^(?:"?pg_catalog"?\.|"?information_schema"?\.)?"?pg_/i.test(m[1])) continue;
    const name = m[1].toLowerCase();
    if (
      [
        'lateral',
        'unnest',
        'jsonb_array_elements',
        'jsonb_to_recordset',
        'generate_series',
        'jsonb_each',
        'jsonb_array_elements_text',
        'regexp_split_to_table',
        'json_array_elements',
        'string_to_array',
        'select',
      ].includes(name)
    )
      continue;
    if (cteNames.has(normalize(m[1]))) continue;
    // Function calls such as FROM unnest($1) are not tables.
    const after = s.slice(m.index + m[0].length).trimStart();
    if (after.startsWith('(')) continue;
    add(m[1], 'SELECT');
  }
  if (/\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b|\bFOR\s+(?:KEY\s+)?SHARE\b/i.test(s)) {
    const locked = [
      ...s.matchAll(
        /\bFOR\s+(?:NO\s+KEY\s+UPDATE|UPDATE|KEY\s+SHARE|SHARE)(?:\s+OF\s+([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*))?/gi,
      ),
    ];
    const aliases = new Map();
    for (const m of s.matchAll(
      new RegExp(String.raw`\b(?:FROM|JOIN)\s+${ident}(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?`, 'gi'),
    )) {
      if (cteNames.has(normalize(m[1]))) continue;
      aliases.set((m[2] ?? m[1].split('.').pop()).toLowerCase(), m[1]);
      aliases.set(m[1].split('.').pop().toLowerCase(), m[1]);
    }
    for (const m of locked) {
      const targets = m[1]
        ? m[1].split(',').map((x) => aliases.get(x.trim().toLowerCase()) ?? x.trim())
        : [...new Set(aliases.values())];
      for (const t of targets) add(t, 'UPDATE');
    }
  }
  return needs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { statements, dynamic } = await sqlInventory();
  const matrix = {};
  for (const { sql } of statements)
    for (const [table, privilege] of requiredPrivileges(sql)) {
      matrix[table] ??= new Set();
      matrix[table].add(privilege);
    }
  const out = Object.fromEntries(
    Object.entries(matrix)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, p]) => [t, [...p].sort()]),
  );
  console.log(
    JSON.stringify(
      { statements: statements.length, dynamic: dynamic.length, privileges: out },
      null,
      2,
    ),
  );
  if (process.argv.includes('--dynamic')) for (const d of dynamic) console.error(d.location);
}
