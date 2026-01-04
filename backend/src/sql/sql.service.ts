import { Injectable } from '@nestjs/common';
import { assertReadOnlySql } from 'common/sql-guard';
import { Pool } from 'pg';

@Injectable()
export class SqlService {
  private readonly tenantSchema =
    process.env.TENANT_SCHEMA?.trim() || 'tenant_power_electronics';

  private pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });

  constructor() {
    this.pool.on('connect', (client) => {
      const schema = this.safeIdent(this.tenantSchema);
      client.query(`set search_path to ${schema}, public;`).catch(() => {});
      client
        .query(`set application_name = 'erp_chat_poc_backend';`)
        .catch(() => {});
    });
  }

  private safeIdent(name: string) {
    const trimmed = (name || '').trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
      throw new Error(`Invalid TENANT_SCHEMA "${name}"`);
    }
    return `"${trimmed}"`;
  }

  private normalizeSql(sql: string) {
    let out = sql;

    // Fix common hallucinated column names
    out = out.replace(/\bpa\.attribute_type_id\b/gi, 'pa.attribute_id');
    out = out.replace(
      /\bproduct_attributes\.attribute_type_id\b/gi,
      'product_attributes.attribute_id',
    );

    // Some models invent this too
    out = out.replace(/\bpa\.attributeTypeId\b/gi, 'pa.attribute_id');

    return out;
  }

  async query(sql: string) {
    assertReadOnlySql(sql);

    // ✅ auto-repair model hallucinations
    sql = this.normalizeSql(sql);

    const client = await this.pool.connect();
    try {
      await client.query(`set statement_timeout = '8000ms';`);
      const schema = this.safeIdent(this.tenantSchema);
      await client.query(`set search_path to ${schema}, public;`);

      const res = await client.query(sql);

      return {
        rowCount: res.rowCount,
        rows: res.rows,
        fields: res.fields?.map((f) => f.name) ?? [],
      };
    } finally {
      client.release();
    }
  }
}
