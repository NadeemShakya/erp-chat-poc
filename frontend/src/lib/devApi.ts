const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function ingestProductsMaterials(payload: {
  tenantSchema?: string;
  rebuild?: boolean;
}) {
  const res = await fetch(`${API_BASE}/ingest/products-materials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await safeJson(res);
    throw new Error(
      `Ingest failed: HTTP ${res.status} - ${JSON.stringify(err)}`
    );
  }
  return safeJson(res);
}

export type EvalResponse = {
  total: number;
  grounded_true: number;
  low_confidence: number;
  results: Array<{
    question: string;
    grounded: boolean;
    confidence: number;
    missing_data: string[];
    answer: string;
  }>;
};

export async function runEval(): Promise<EvalResponse> {
  const res = await fetch(`${API_BASE}/eval`);
  if (!res.ok) {
    const err = await safeJson(res);
    throw new Error(`Eval failed: HTTP ${res.status} - ${JSON.stringify(err)}`);
  }
  return safeJson(res);
}
