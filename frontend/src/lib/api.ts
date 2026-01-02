import type { ChatResponse } from "@/types/chat";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export type IngestResponse = {
  tenantSchema: string;
  rebuild: boolean;
  source: { products: number; materials: number };
  embedded: {
    productDocs: number;
    productChunks: number;
    materialDocs: number;
    materialChunks: number;
  };
};

export async function ingestProductsMaterials(opts?: {
  tenantSchema?: string;
  rebuild?: boolean;
}): Promise<IngestResponse> {
  const res = await fetch(`${API_BASE}/ingest/products-materials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantSchema: opts?.tenantSchema || "tenant_power_electronics",
      rebuild: opts?.rebuild ?? true,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt || "Request failed"}`);
  }

  return res.json();
}

export async function chatAsk(message: string): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt || "Request failed"}`);
  }

  return res.json();
}
