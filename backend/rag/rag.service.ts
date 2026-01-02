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
}
