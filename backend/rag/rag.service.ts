// rag.service.ts
import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { BedrockService } from '../bedrock/bedrock.service';

type RagRow = {
  chunk_id: number;
  doc_type: string;
  entity_table: string | null;
  entity_id: string | null;
  title: string;
  chunk_text: string;
};

@Injectable()
export class RagService {
  private pool = new Pool({ connectionString: process.env.DATABASE_URL });

  constructor(private readonly bedrock: BedrockService) {}

  private toVectorLiteral(arr: number[]) {
    return '[' + arr.map((n) => Number(n).toFixed(8)).join(',') + ']';
  }

  private extractNameHint(q: string): string | null {
    // crude but effective for POC:
    // "Product with name Refresh Tears?" -> "Refresh Tears"
    const m = q.match(/name\s+(.+?)\??$/i);
    if (m?.[1]) return m[1].trim().replace(/^["']|["']$/g, '');
    return null;
  }

  async searchLexical(query: string, limit = 8): Promise<RagRow[]> {
    const nameHint = this.extractNameHint(query) ?? query;
    // Search in raw_text (not chunk_text) so exact name always matches
    const res = await this.pool.query(
      `
      select
        rc.id as chunk_id,
        rd.doc_type,
        rd.entity_table,
        rd.entity_id,
        rd.title,
        rc.chunk_text
      from public.rag_documents rd
      join public.rag_chunks rc on rc.document_id = rd.id
      where rd.doc_type in ('product','material')
        and rd.raw_text ilike '%' || $1 || '%'
      limit $2
      `,
      [nameHint, limit],
    );
    return res.rows;
  }

  async searchVector(query: string, limit = 8): Promise<RagRow[]> {
    const emb = await this.bedrock.embed(query);

    // Pull more candidates, then re-rank to prefer product/material over schema/dictionary
    const res = await this.pool.query(
      `
      with ranked as (
        select
          rc.id as chunk_id,
          rd.doc_type,
          rd.entity_table,
          rd.entity_id,
          rd.title,
          rc.chunk_text,
          (rc.embedding <=> $1::vector) as dist
        from public.rag_chunks rc
        join public.rag_documents rd on rd.id = rc.document_id
        where rd.doc_type in ('product','material','schema','dictionary')
        order by dist
        limit 40
      )
      select chunk_id, doc_type, entity_table, entity_id, title, chunk_text
      from ranked
      order by
        case doc_type
          when 'product' then 1
          when 'material' then 2
          when 'dictionary' then 3
          when 'schema' then 4
          else 5
        end,
        dist
      limit $2
      `,
      [this.toVectorLiteral(emb), limit],
    );

    return res.rows;
  }

  async search(query: string, limit = 10) {
    const emb = await this.bedrock.embed(query);

    const res = await this.pool.query(
      `
      with ranked as (
        select
          rc.id as chunk_id,
          rd.doc_type,
          rd.entity_table,
          rd.entity_id,
          rd.title,
          rc.chunk_text,
          (rc.embedding <=> $1::vector) as dist
        from public.rag_chunks rc
        join public.rag_documents rd on rd.id = rc.document_id
        where rd.doc_type in ('product','material','schema','dictionary')
        order by dist
        limit 40
      )
      select chunk_id, doc_type, entity_table, entity_id, title, chunk_text
      from ranked
      order by
        case doc_type
          when 'product' then 1
          when 'material' then 2
          when 'dictionary' then 3
          when 'schema' then 4
          else 5
        end,
        dist
      limit $2
      `,
      [this.toVectorLiteral(emb), limit],
    );

    return res.rows;
  }

  // rag.service.ts (add near bottom)

  private looksLikeIdentifier(q: string) {
    const s = (q || '').trim();

    // barcode: mostly digits, may contain leading zeros
    const hasBarcode = /\bbarcode\b/i.test(s);
    const digitToken = s.match(/\b\d{4,}\b/); // 4+ digits
    const hasLikelyBarcode = hasBarcode && digitToken;

    // code-like tokens: contains hyphen or colon or mixed letters+digits
    const hasCodeWord = /\bcode\b/i.test(s);
    const codeToken = s.match(/\b[a-z0-9]+[-:][a-z0-9\/-]+\b/i);
    const hasLikelyCode = hasCodeWord || codeToken;

    // If question mentions barcode/code explicitly or contains strong code token, treat as identifier
    return Boolean(hasLikelyBarcode || hasLikelyCode);
  }

  private extractIdentifierTokens(q: string): string[] {
    const s = (q || '').trim();

    // Grab the number token (keeps leading zeros)
    const nums = Array.from(s.matchAll(/\b\d{4,}\b/g)).map((m) => m[0]);

    // Grab code-ish tokens (e.g. 89852-1423, PE: TX-..., HM-4567U8)
    const codes = Array.from(s.matchAll(/\b[a-z0-9]+[-:][a-z0-9\/-]+\b/gi)).map(
      (m) => m[0],
    );

    // Also keep the raw string (sometimes rewrite puts "Barcode: 09038")
    const out = [...new Set([...nums, ...codes, s])].filter(Boolean);

    return out.slice(0, 5); // keep small
  }

  async searchHybrid(query: string, limit = 10): Promise<RagRow[]> {
    // If it's identifier-like, lexical should dominate
    if (this.looksLikeIdentifier(query)) {
      const tokens = this.extractIdentifierTokens(query);

      // Run lexical for each token and merge
      const lexicalResults: RagRow[] = [];
      for (const t of tokens) {
        const rows = await this.searchLexical(t, limit);
        lexicalResults.push(...rows);
        if (lexicalResults.length >= limit) break;
      }

      // If lexical finds enough, return it first
      const dedup = new Map<number, RagRow>();
      for (const r of lexicalResults) dedup.set(Number(r.chunk_id), r);

      if (dedup.size >= Math.min(3, limit)) {
        return Array.from(dedup.values()).slice(0, limit);
      }

      // Otherwise combine lexical + vector (fallback)
      const vector = await this.searchVector(query, limit);
      for (const r of vector) dedup.set(Number(r.chunk_id), r);
      return Array.from(dedup.values()).slice(0, limit);
    }

    // Default: your current behavior (vector ranked)
    return this.search(query, limit);
  }
}
