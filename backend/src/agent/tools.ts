import { DynamicStructuredTool } from '@langchain/core/tools';
import { RagService } from 'rag/rag.service';
import { SqlService } from 'sql/sql.service';
import { z } from 'zod';

export function makeSqlTool(sql: SqlService) {
  return new DynamicStructuredTool({
    name: 'sql_query',
    description:
      'Run a READ-ONLY SQL query against the ERP database. Use ONLY SELECT queries. Never modify data. Prefer counting, filtering, grouping.',
    schema: z.object({
      query: z.string().min(1),
    }),
    func: async ({ query }) => {
      // Guardrails: block destructive keywords
      const q = query.trim().toLowerCase();
      const banned = [
        'insert ',
        'update ',
        'delete ',
        'drop ',
        'alter ',
        'truncate ',
        'create ',
      ];
      if (!q.startsWith('select') || banned.some((k) => q.includes(k))) {
        return JSON.stringify({
          ok: false,
          error: 'Only SELECT queries are allowed.',
        });
      }

      // Optional: prevent massive scans in POC
      // (you said return all rows now, so keep this off for now)
      const rows = await sql.query(query);
      return JSON.stringify({ ok: true, rows });
    },
  });
}

export function makeRagTool(rag: RagService) {
  return new DynamicStructuredTool({
    name: 'rag_search',
    description:
      'Semantic search over embedded ERP docs (products/materials). Use when SQL is hard or when user asks fuzzy questions.',
    schema: z.object({
      query: z.string().min(1),
      k: z.number().int().min(1).max(25).default(10),
    }),
    func: async ({ query, k }) => {
      const matches = await rag.search(query, k); // expects your existing rag method
      // matches should include chunk_text + ids + titles
      return JSON.stringify({ ok: true, matches });
    },
  });
}
