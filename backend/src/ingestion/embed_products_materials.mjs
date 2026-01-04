/**
 * Embed Products + Materials into pgvector (public.rag_documents / public.rag_chunks)
 *
 * Env required:
 * - DATABASE_URL
 * - AWS_REGION
 * Optional:
 * - BEDROCK_EMBED_MODEL (default amazon.titan-embed-text-v2:0)
 *
 * Run (inside backend container recommended):
 *   node ingestion/embed_products_materials.mjs
 */

import { Client } from 'pg';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const DATABASE_URL = process.env.DATABASE_URL;
const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const EMBED_MODEL =
  process.env.BEDROCK_EMBED_MODEL || 'amazon.titan-embed-text-v2:0';

// -------------------- Bedrock Embeddings --------------------
const bedrock = new BedrockRuntimeClient({ region: AWS_REGION });

async function titanEmbed(text) {
  const cmd = new InvokeModelCommand({
    modelId: EMBED_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputText: text }),
  });

  const res = await bedrock.send(cmd);
  const body = JSON.parse(new TextDecoder().decode(res.body));
  if (!body?.embedding || !Array.isArray(body.embedding)) {
    throw new Error(
      `Unexpected embedding response: ${JSON.stringify(body).slice(0, 500)}`,
    );
  }
  return body.embedding; // Titan v2 => 1024 floats by default
}

// -------------------- Helpers --------------------
function chunkText(text, maxChars = 1400, overlap = 200) {
  // Simple character-based chunking (good enough for POC)
  const cleaned = (text || '').replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  const chunks = [];
  let i = 0;
  while (i < cleaned.length) {
    const end = Math.min(cleaned.length, i + maxChars);
    chunks.push(cleaned.slice(i, end));
    if (end === cleaned.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks;
}

function toVectorLiteral(arr) {
  // pgvector accepts '[0.1,0.2,...]'::vector
  // keep a reasonable precision to avoid huge SQL strings
  return '[' + arr.map((n) => Number(n).toFixed(8)).join(',') + ']';
}

function safeStr(v) {
  return v == null ? '' : String(v);
}

function distinctNonEmpty(lines) {
  const seen = new Set();
  const out = [];
  for (const l of lines) {
    const s = (l || '').trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// -------------------- DB write ops --------------------
async function getOrUpsertDocument(
  db,
  { doc_type, entity_table, entity_id, title, raw_text },
) {
  // Since you don't have a UNIQUE constraint, we do a manual "upsert":
  // - if exists, update and return id
  // - else insert and return id
  const existing = await db.query(
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
    const id = existing.rows[0].id;
    await db.query(
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

  const inserted = await db.query(
    `
    insert into public.rag_documents (doc_type, entity_table, entity_id, title, raw_text, updated_at)
    values ($1,$2,$3,$4,$5,now())
    returning id
    `,
    [doc_type, entity_table, entity_id, title, raw_text],
  );
  return inserted.rows[0].id;
}

async function rebuildChunks(db, documentId, rawText) {
  await db.query(`delete from public.rag_chunks where document_id = $1`, [
    documentId,
  ]);

  const chunks = chunkText(rawText);
  if (!chunks.length) return 0;

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    const embedding = await titanEmbed(chunk);

    await db.query(
      `
      insert into public.rag_chunks (document_id, chunk_index, chunk_text, embedding)
      values ($1,$2,$3,$4::vector)
      `,
      [documentId, idx, chunk, toVectorLiteral(embedding)],
    );
  }
  return chunks.length;
}

// -------------------- Main ingestion --------------------
async function main() {
  if (!DATABASE_URL) throw new Error('Missing DATABASE_URL');
  console.log('Starting embedding ingestion…');
  console.log(`AWS_REGION=${AWS_REGION}`);
  console.log(`EMBED_MODEL=${EMBED_MODEL}`);

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  // Optional sanity: ensure rag tables exist in public
  const ragCheck = await db.query(`
    select table_schema, table_name
    from information_schema.tables
    where table_name in ('rag_documents','rag_chunks')
    order by table_schema, table_name
  `);
  if (ragCheck.rows.length < 2) {
    throw new Error(
      `rag tables not found. Found: ${JSON.stringify(ragCheck.rows)}. Did you create them in public?`,
    );
  }

  // -------------------- Load Materials --------------------
  const materialsRes = await db.query(`
    select
      m.id,
      m.name,
      m.description,
      m.material_id,
      m.part_number,
      it.name as type_name,
      ic.name as category_name,
      uom.acronym as uom
    from materials m
    left join item_types it on it.id = m.type_id
    left join item_categories ic on ic.id = m.category_id
    left join unit_of_measures uom on uom.id = m.uom_id
    where m.deleted_at is null
  `);

  const materialAttrRes = await db.query(`
    select
      ma.material_id,
      at.name as attribute_name,
      uom.acronym as uom,
      ma.value
    from material_attributes ma
    join attribute_types at on at.id = ma.attribute_id
    left join unit_of_measures uom on uom.id = ma.display_unit_of_measure_id
    where ma.deleted_at is null and at.deleted_at is null
  `);

  const materialAttrs = new Map(); // material_id -> string[]
  for (const row of materialAttrRes.rows) {
    const mid = row.material_id;
    if (!materialAttrs.has(mid)) materialAttrs.set(mid, []);
    materialAttrs
      .get(mid)
      .push(
        `- ${safeStr(row.attribute_name)}${row.uom ? ` (${row.uom})` : ''}: ${safeStr(row.value)}`,
      );
  }

  // -------------------- Load Products --------------------
  const productsRes = await db.query(`
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
    from products p
    left join product_types pt on pt.id = p.product_type_id
    left join materials m on m.id = p.material_id
    where p.deleted_at is null
  `);

  const productAttrRes = await db.query(`
    select
      pa.product_id,
      at.name as attribute_name,
      uom.acronym as uom,
      pa.value
    from product_attributes pa
    join attribute_types at on at.id = pa.attribute_id
    left join unit_of_measures uom on uom.id = pa.display_unit_of_measure_id
    where pa.deleted_at is null and at.deleted_at is null
  `);

  const productAttrs = new Map(); // product_id -> string[]
  for (const row of productAttrRes.rows) {
    const pid = row.product_id;
    if (!productAttrs.has(pid)) productAttrs.set(pid, []);
    productAttrs
      .get(pid)
      .push(
        `- ${safeStr(row.attribute_name)}${row.uom ? ` (${row.uom})` : ''}: ${safeStr(row.value)}`,
      );
  }

  const componentsRes = await db.query(`
    select
      pc.product_id,
      m.name as component_name,
      m.part_number as component_part_number,
      pc.quantity,
      pc.notes
    from product_components pc
    join materials m on m.id = pc.material_id
    where pc.deleted_at is null
  `);

  const productComps = new Map(); // product_id -> string[]
  for (const row of componentsRes.rows) {
    const pid = row.product_id;
    if (!productComps.has(pid)) productComps.set(pid, []);
    const line =
      `- ${safeStr(row.component_name)}` +
      (row.component_part_number
        ? ` (Part#: ${row.component_part_number})`
        : '') +
      (row.quantity != null ? ` | Qty: ${row.quantity}` : '') +
      (row.notes ? ` | Notes: ${row.notes}` : '');
    productComps.get(pid).push(line);
  }

  // -------------------- Embed Materials --------------------
  console.log(`Materials found: ${materialsRes.rowCount}`);
  let materialDocs = 0;
  let materialChunks = 0;

  for (const m of materialsRes.rows) {
    const attrs = distinctNonEmpty(materialAttrs.get(m.id) || []);
    const raw = [
      `Entity: Material`,
      `MaterialId: ${m.id}`,
      `Name: ${safeStr(m.name)}`,
      `Material Code: ${safeStr(m.material_id)}`,
      `Part Number: ${safeStr(m.part_number)}`,
      `Type: ${safeStr(m.type_name)}`,
      `Category: ${safeStr(m.category_name)}`,
      `UOM: ${safeStr(m.uom)}`,
      `Description: ${safeStr(m.description)}`,
      ``,
      `Attributes:`,
      attrs.length ? attrs.join('\n') : `- (none)`,
    ].join('\n');

    const docId = await getOrUpsertDocument(db, {
      doc_type: 'material',
      entity_table: 'materials',
      entity_id: m.id,
      title: `Material: ${m.name || m.part_number || m.id}`,
      raw_text: raw,
    });

    const chunkCount = await rebuildChunks(db, docId, raw);
    materialDocs += 1;
    materialChunks += chunkCount;

    if (materialDocs % 25 === 0) {
      console.log(
        `Embedded materials: ${materialDocs}/${materialsRes.rowCount} (chunks so far: ${materialChunks})`,
      );
    }
  }

  // -------------------- Embed Products --------------------
  console.log(`Products found: ${productsRes.rowCount}`);
  let productDocs = 0;
  let productChunks = 0;

  for (const p of productsRes.rows) {
    const attrs = distinctNonEmpty(productAttrs.get(p.id) || []);
    const comps = distinctNonEmpty(productComps.get(p.id) || []);

    const raw = [
      `Entity: Product`,
      `ProductId: ${p.id}`,
      `Name: ${safeStr(p.name)}`,
      `Code: ${safeStr(p.code)}`,
      `Barcode: ${safeStr(p.barcode)}`,
      `Product Type: ${safeStr(p.product_type_name)}`,
      `Description: ${safeStr(p.description)}`,
      ``,
      `Master Material:`,
      `- Name: ${safeStr(p.master_material_name)}`,
      `- Part Number: ${safeStr(p.master_material_part_number)}`,
      ``,
      `Attributes:`,
      attrs.length ? attrs.join('\n') : `- (none)`,
      ``,
      `Components (Materials used):`,
      comps.length ? comps.join('\n') : `- (none)`,
    ].join('\n');

    const docId = await getOrUpsertDocument(db, {
      doc_type: 'product',
      entity_table: 'products',
      entity_id: p.id,
      title: `Product: ${p.name || p.code || p.id}`,
      raw_text: raw,
    });

    const chunkCount = await rebuildChunks(db, docId, raw);
    productDocs += 1;
    productChunks += chunkCount;

    if (productDocs % 25 === 0) {
      console.log(
        `Embedded products: ${productDocs}/${productsRes.rowCount} (chunks so far: ${productChunks})`,
      );
    }
  }

  console.log('✅ Embedding complete.');
  console.log(`Materials docs=${materialDocs}, chunks=${materialChunks}`);
  console.log(`Products  docs=${productDocs}, chunks=${productChunks}`);

  await db.end();
}

main().catch((err) => {
  console.error('❌ Ingestion failed:', err);
  process.exit(1);
});
