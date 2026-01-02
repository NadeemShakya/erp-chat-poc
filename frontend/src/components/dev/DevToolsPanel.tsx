import * as React from "react";
import {
  ingestProductsMaterials,
  runEval,
  type EvalResponse,
} from "@/lib/devApi";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
      {message}
    </div>
  );
}

export function DevToolsPanel() {
  const [tenantSchema, setTenantSchema] = React.useState(
    "tenant_power_electronics"
  );
  const [rebuild, setRebuild] = React.useState(true);

  const [ingesting, setIngesting] = React.useState(false);
  const [ingestErr, setIngestErr] = React.useState<string | null>(null);
  const [ingestRes, setIngestRes] = React.useState<any>(null);

  const [evaling, setEvaling] = React.useState(false);
  const [evalErr, setEvalErr] = React.useState<string | null>(null);
  const [evalRes, setEvalRes] = React.useState<EvalResponse | null>(null);

  async function onIngest() {
    setIngestErr(null);
    setIngestRes(null);
    setIngesting(true);
    try {
      const r = await ingestProductsMaterials({ tenantSchema, rebuild });
      setIngestRes(r);
    } catch (e: any) {
      setIngestErr(e?.message ?? "Ingest failed");
    } finally {
      setIngesting(false);
    }
  }

  async function onEval() {
    setEvalErr(null);
    setEvalRes(null);
    setEvaling(true);
    try {
      const r = await runEval();
      setEvalRes(r);
    } catch (e: any) {
      setEvalErr(e?.message ?? "Eval failed");
    } finally {
      setEvaling(false);
    }
  }

  return (
    <Card className="rounded-2xl border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">DEV Tools</CardTitle>
        <div className="text-sm text-muted-foreground">
          Run ingestion (embeddings) + evaluation suite (10 questions).
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {/* Ingest */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Ingest</Badge>
            <Badge variant="outline">POST /ingest/products-materials</Badge>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label className="text-xs">Tenant schema</Label>
              <Input
                value={tenantSchema}
                onChange={(e) => setTenantSchema(e.target.value)}
                placeholder="tenant_power_electronics"
              />
            </div>

            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={rebuild} onCheckedChange={setRebuild} />
                <Label className="text-xs">Rebuild</Label>
              </div>
              <div className="text-xs text-muted-foreground">
                Clears and re-embeds{" "}
                <span className="font-mono">public.rag_*</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={onIngest} disabled={ingesting}>
              {ingesting ? "Ingesting..." : "Run Ingest"}
            </Button>
          </div>

          {ingestErr ? <ErrorBox message={ingestErr} /> : null}

          {ingestRes ? (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button size="sm" variant="outline">
                  View ingest output
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <pre className="whitespace-pre-wrap break-words rounded-xl border bg-background p-3 text-xs">
                  {JSON.stringify(ingestRes, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>

        <Separator />

        {/* Eval */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Eval</Badge>
            <Badge variant="outline">GET /eval</Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={onEval} disabled={evaling}>
              {evaling ? "Running..." : "Run Eval (10 Qs)"}
            </Button>

            {evalRes ? (
              <div className="text-xs text-muted-foreground">
                grounded:{" "}
                <span className="font-medium">
                  {evalRes.grounded_true}/{evalRes.total}
                </span>{" "}
                • low confidence:{" "}
                <span className="font-medium">{evalRes.low_confidence}</span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                Runs your fixed regression suite and shows grounded/confidence.
              </div>
            )}
          </div>

          {evalErr ? <ErrorBox message={evalErr} /> : null}

          {evalRes ? (
            <div className="flex flex-col gap-2">
              {evalRes.results.map((r, idx) => (
                <div key={idx} className="rounded-xl border bg-background p-3">
                  <div className="text-sm font-medium">{r.question}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={r.grounded ? "default" : "secondary"}>
                      grounded: {String(r.grounded)}
                    </Badge>
                    <Badge variant="outline">
                      confidence: {Number(r.confidence ?? 0).toFixed(2)}
                    </Badge>
                    {r.missing_data?.length ? (
                      <Badge variant="secondary">
                        missing: {r.missing_data.length}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-2 whitespace-pre-wrap text-sm">
                    {r.answer}
                  </div>

                  {r.missing_data?.length ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Missing: {r.missing_data.join("; ")}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
