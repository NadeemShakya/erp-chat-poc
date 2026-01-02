// backend/src/common/sql-guard.ts

/**
 * Very small POC SQL guard:
 * - Only allow SELECT / WITH (read-only)
 * - Disallow multiple statements
 * - Block dangerous keywords
 */
export function assertReadOnlySql(sql: string) {
  if (!sql || typeof sql !== 'string') throw new Error('SQL is empty');

  const trimmed = sql.trim();

  // Block multiple statements (allow a single trailing semicolon)
  const noTrailing = trimmed.endsWith(';') ? trimmed.slice(0, -1) : trimmed;
  if (noTrailing.includes(';')) {
    throw new Error('Multiple SQL statements are not allowed');
  }

  const lower = noTrailing.toLowerCase();

  // Must start with select/with
  if (!(lower.startsWith('select') || lower.startsWith('with'))) {
    throw new Error('Only SELECT/WITH queries are allowed');
  }

  // Block write / DDL / admin / copy / call (match whole words)
  const forbiddenWords = [
    'insert',
    'update',
    'delete',
    'drop',
    'alter',
    'truncate',
    'create',
    'grant',
    'revoke',
    'vacuum',
    'analyze',
    'refresh',
    'copy',
    'call',
    'execute',
    'listen',
    'notify',
  ];

  for (const kw of forbiddenWords) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(noTrailing)) {
      throw new Error(`Forbidden keyword in SQL: ${kw}`);
    }
  }

  // Block special dangerous functions explicitly (not word-boundary dependent)
  const forbiddenSnippets = [
    'pg_read_file',
    'pg_write_file',
    'pg_execute_server_program',
  ];
  for (const s of forbiddenSnippets) {
    if (lower.includes(s)) {
      throw new Error(`Forbidden keyword in SQL: ${s}`);
    }
  }

  // Block SET/RESET/DO as statements (avoid false positives like deleted_at)
  // Match beginning-of-statement or whitespace + keyword + whitespace
  const forbiddenStmt = /\b(set|reset|do)\b\s+/i;
  if (forbiddenStmt.test(noTrailing)) {
    // but allow "offset" etc; this targets actual statement-ish usage
    throw new Error(`Forbidden keyword in SQL: set/reset/do`);
  }
}
