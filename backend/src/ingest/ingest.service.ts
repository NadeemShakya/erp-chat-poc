import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

type IngestOpts = {
  tenantSchema: string; // e.g. tenant_power_electronics
  rebuild: boolean; // true = clear all rag docs/chunks first
};

@Injectable()
export class IngestService {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });

  private readonly region =
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    process.env.BEDROCK_REGION ||
    process.env.BEDROCK_AWS_REGION ||
    'ap-south-1';

  private readonly embedModel =
    process.env.BEDROCK_EMBED_MODEL || 'amazon.titan-embed-text-v2:0';

  private readonly bedrock = new BedrockRuntimeClient({ region: this.region });

  // -------------------- Helpers (copied from your mjs) --------------------
  private chunkText(text: string, maxChars = 1400, overlap = 200) {
    const cleaned = (text || '').replace(/\r\n/g, '\n').trim();
    if (!cleaned) return [];
    const chunks: string[] = [];
    let i = 0;
    while (i < cleaned.length) {
      const end = Math.min(cleaned.length, i + maxChars);
      chunks.push(cleaned.slice(i, end));
      if (end === cleaned.length) break;
      i = Math.max(0, end - overlap);
    }
    return chunks;
  }

  private toVectorLiteral(arr: number[]) {
    return '[' + arr.map((n) => Number(n).toFixed(8)).join(',') + ']';
  }

  private safeStr(v: any) {
    return v == null ? '' : String(v);
  }

  private distinctNonEmpty(lines: string[]) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const l of lines) {
      const s = (l || '').trim();
      if (!s) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  private assertSafeSchema(schema: string) {
    // Prevent SQL injection via schema name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      throw new Error(`Invalid tenantSchema: ${schema}`);
    }
  }

  // -------------------- Bedrock embeddings (copied from your mjs) --------------------
  private async titanEmbed(text: string): Promise<number[]> {
    const cmd = new InvokeModelCommand({
      modelId: this.embedModel,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ inputText: text }),
    });

    const res = await this.bedrock.send(cmd);
    const bodyStr = new TextDecoder().decode(res.body as Uint8Array);
    const body = JSON.parse(bodyStr);

    if (!body?.embedding || !Array.isArray(body.embedding)) {
      throw new Error(
        `Unexpected embedding response: ${JSON.stringify(body).slice(0, 500)}`,
      );
    }
    return body.embedding;
  }

  // -------------------- DB write ops (copied from your mjs) --------------------
  private async getOrUpsertDocument(params: {
    doc_type: 'product' | 'material';
    entity_table: string;
    entity_id: string;
    title: string;
    raw_text: string;
  }) {
    const { doc_type, entity_table, entity_id, title, raw_text } = params;

    const existing = await this.pool.query(
      `
      select id
      from public.rag_documents
      where doc_type = $1
        and (entity_table is not distinct from $2)
        and (entity_id is not distinct from $3)
      limit 1
      `,
      [doc_type, entity_table, entity_id],
    );

    if (existing.rows.length) {
      const id = existing.rows[0].id as number;
      await this.pool.query(
        `
        update public.rag_documents
        set title = $2,
            raw_text = $3,
            updated_at = now()
        where id = $1
        `,
        [id, title, raw_text],
      );
      return id;
    }

    const inserted = await this.pool.query(
      `
      insert into public.rag_documents (doc_type, entity_table, entity_id, title, raw_text, updated_at)
      values ($1,$2,$3,$4,$5,now())
      returning id
      `,
      [doc_type, entity_table, entity_id, title, raw_text],
    );
    return inserted.rows[0].id as number;
  }

  private async rebuildChunks(documentId: number, rawText: string) {
    await this.pool.query(
      `delete from public.rag_chunks where document_id = $1`,
      [documentId],
    );

    const chunks = this.chunkText(rawText);
    if (!chunks.length) return 0;

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx];
      const embedding = await this.titanEmbed(chunk);
      await this.pool.query(
        `
        insert into public.rag_chunks (document_id, chunk_index, chunk_text, embedding)
        values ($1,$2,$3,$4::vector)
        `,
        [documentId, idx, chunk, this.toVectorLiteral(embedding)],
      );
    }

    return chunks.length;
  }

  // -------------------- Main ingestion (API version of your mjs) --------------------
  async ingestProductsMaterials(opts: IngestOpts) {
    const { tenantSchema, rebuild } = opts;
    this.assertSafeSchema(tenantSchema);

    // sanity check rag tables
    const ragCheck = await this.pool.query(`
      select table_schema, table_name
      from information_schema.tables
      where table_name in ('rag_documents','rag_chunks')
      order by table_schema, table_name
    `);
    if (ragCheck.rows.length < 2) {
      throw new Error(
        `rag tables not found in DB. Found: ${JSON.stringify(ragCheck.rows)}. Create them in public.`,
      );
    }

    if (rebuild) {
      await this.pool.query(`delete from public.rag_chunks`);
      await this.pool.query(`delete from public.rag_documents`);
    }

    // -------------------- Load Materials --------------------
    const materialsRes = await this.pool.query(`
      select
        m.id,
        m.name,
        m.description,
        m.material_id,
        m.part_number,
        it.name as type_name,
        ic.name as category_name,
        uom.acronym as uom
      from ${tenantSchema}.materials m
      left join ${tenantSchema}.item_types it on it.id = m.type_id
      left join ${tenantSchema}.item_categories ic on ic.id = m.category_id
      left join ${tenantSchema}.unit_of_measures uom on uom.id = m.uom_id
      where m.deleted_at is null
    `);

    const materialAttrRes = await this.pool.query(`
      select
        ma.material_id,
        at.name as attribute_name,
        uom.acronym as uom,
        ma.value
      from ${tenantSchema}.material_attributes ma
      join ${tenantSchema}.attribute_types at on at.id = ma.attribute_id
      left join ${tenantSchema}.unit_of_measures uom on uom.id = ma.display_unit_of_measure_id
      where ma.deleted_at is null and at.deleted_at is null
    `);

    const materialAttrs = new Map<string, string[]>();
    for (const row of materialAttrRes.rows) {
      const mid = row.material_id as string;
      if (!materialAttrs.has(mid)) materialAttrs.set(mid, []);
      materialAttrs
        .get(mid)!
        .push(
          `- ${this.safeStr(row.attribute_name)}${row.uom ? ` (${row.uom})` : ''}: ${this.safeStr(row.value)}`,
        );
    }

    // -------------------- Load Products --------------------
    const productsRes = await this.pool.query(`
      select
        p.id,
        p.name,
        p.code,
        p.description,
        p.barcode,
        pt.name as product_type_name,
        m.id as master_material_id,
        m.name as master_material_name,
        m.part_number as master_material_part_number
      from ${tenantSchema}.products p
      left join ${tenantSchema}.product_types pt on pt.id = p.product_type_id
      left join ${tenantSchema}.materials m on m.id = p.material_id
      where p.deleted_at is null
    `);

    const productAttrRes = await this.pool.query(`
      select
        pa.product_id,
        at.name as attribute_name,
        uom.acronym as uom,
        pa.value
      from ${tenantSchema}.product_attributes pa
      join ${tenantSchema}.attribute_types at on at.id = pa.attribute_id
      left join ${tenantSchema}.unit_of_measures uom on uom.id = pa.display_unit_of_measure_id
      where pa.deleted_at is null and at.deleted_at is null
    `);

    const productAttrs = new Map<string, string[]>();
    for (const row of productAttrRes.rows) {
      const pid = row.product_id as string;
      if (!productAttrs.has(pid)) productAttrs.set(pid, []);
      productAttrs
        .get(pid)!
        .push(
          `- ${this.safeStr(row.attribute_name)}${row.uom ? ` (${row.uom})` : ''}: ${this.safeStr(row.value)}`,
        );
    }

    const componentsRes = await this.pool.query(`
      select
        pc.product_id,
        m.name as component_name,
        m.part_number as component_part_number,
        pc.quantity,
        pc.notes
      from ${tenantSchema}.product_components pc
      join ${tenantSchema}.materials m on m.id = pc.material_id
      where pc.deleted_at is null
    `);

    const productComps = new Map<string, string[]>();
    for (const row of componentsRes.rows) {
      const pid = row.product_id as string;
      if (!productComps.has(pid)) productComps.set(pid, []);
      const line =
        `- ${this.safeStr(row.component_name)}` +
        (row.component_part_number
          ? ` (Part#: ${row.component_part_number})`
          : '') +
        (row.quantity != null ? ` | Qty: ${row.quantity}` : '') +
        (row.notes ? ` | Notes: ${row.notes}` : '');
      productComps.get(pid)!.push(line);
    }

    // -------------------- Embed Materials --------------------
    let materialDocs = 0;
    let materialChunks = 0;

    for (const m of materialsRes.rows) {
      const attrs = this.distinctNonEmpty(materialAttrs.get(m.id) || []);
      const raw = [
        `Entity: Material`,
        `MaterialId: ${m.id}`,
        `Name: ${this.safeStr(m.name)}`,
        `Material Code: ${this.safeStr(m.material_id)}`,
        `Part Number: ${this.safeStr(m.part_number)}`,
        `Type: ${this.safeStr(m.type_name)}`,
        `Category: ${this.safeStr(m.category_name)}`,
        `UOM: ${this.safeStr(m.uom)}`,
        `Description: ${this.safeStr(m.description)}`,
        ``,
        `Attributes:`,
        attrs.length ? attrs.join('\n') : `- (none)`,
      ].join('\n');

      const docId = await this.getOrUpsertDocument({
        doc_type: 'material',
        entity_table: 'materials',
        entity_id: m.id,
        title: `Material: ${m.name || m.part_number || m.id}`,
        raw_text: raw,
      });

      const chunkCount = await this.rebuildChunks(docId, raw);
      materialDocs += 1;
      materialChunks += chunkCount;
    }

    // -------------------- Embed Products --------------------
    let productDocs = 0;
    let productChunks = 0;

    for (const p of productsRes.rows) {
      const attrs = this.distinctNonEmpty(productAttrs.get(p.id) || []);
      const comps = this.distinctNonEmpty(productComps.get(p.id) || []);

      const raw = [
        `Entity: Product`,
        `ProductId: ${p.id}`,
        `Name: ${this.safeStr(p.name)}`,
        `Code: ${this.safeStr(p.code)}`,
        `Barcode: ${this.safeStr(p.barcode)}`,
        `Product Type: ${this.safeStr(p.product_type_name)}`,
        `Description: ${this.safeStr(p.description)}`,
        ``,
        `Master Material:`,
        `- Name: ${this.safeStr(p.master_material_name)}`,
        `- Part Number: ${this.safeStr(p.master_material_part_number)}`,
        ``,
        `Attributes:`,
        attrs.length ? attrs.join('\n') : `- (none)`,
        ``,
        `Components (Materials used):`,
        comps.length ? comps.join('\n') : `- (none)`,
      ].join('\n');

      const docId = await this.getOrUpsertDocument({
        doc_type: 'product',
        entity_table: 'products',
        entity_id: p.id,
        title: `Product: ${p.name || p.code || p.id}`,
        raw_text: raw,
      });

      const chunkCount = await this.rebuildChunks(docId, raw);
      productDocs += 1;
      productChunks += chunkCount;
    }

    return {
      ok: true,
      tenantSchema,
      rebuild,
      awsRegion: this.region,
      embedModel: this.embedModel,
      counts: {
        materialsFound: materialsRes.rowCount,
        productsFound: productsRes.rowCount,
        materialDocs,
        materialChunks,
        productDocs,
        productChunks,
      },
    };
  }
}
