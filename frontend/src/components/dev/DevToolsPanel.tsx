import {
  ingestProductsMaterials,
  runEval,
  type EvalResponse,
} from "@/lib/devApi";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
      {message}
    </div>
  );
}

function InfoBox({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

function clamp01(n: number) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function prettyPct(n: unknown) {
  const v = typeof n === "number" ? clamp01(n) : null;
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
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

  const ingestOk = !!ingestRes && !ingestErr;
  const evalOk = !!evalRes && !evalErr;

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-base">Developer tools</CardTitle>
            <div className="mt-1 text-sm text-muted-foreground">
              Ingest embeddings + run the regression eval suite.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">DEV_MODE</Badge>
            <Badge variant="outline">Ingest + Eval</Badge>
            {ingesting ? <Badge>ingesting…</Badge> : null}
            {evaling ? <Badge>evaluating…</Badge> : null}
            {ingestOk ? <Badge variant="secondary">ingest ok</Badge> : null}
            {evalOk ? <Badge variant="secondary">eval ok</Badge> : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <Tabs defaultValue="ingest">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="ingest">Ingest</TabsTrigger>
            <TabsTrigger value="eval">Eval</TabsTrigger>
          </TabsList>

          {/* INGEST */}
          <TabsContent value="ingest" className="mt-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Ingest</Badge>
                <Badge variant="outline">POST /ingest/products-materials</Badge>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label className="text-xs">Tenant schema</Label>
                  <Input
                    value={tenantSchema}
                    onChange={(e) => setTenantSchema(e.target.value)}
                    placeholder="tenant_power_electronics"
                    disabled={ingesting}
                  />
                  <div className="text-xs text-muted-foreground">
                    Schema that contains your ERP tables.
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-xs">Rebuild embeddings</Label>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={rebuild}
                      onCheckedChange={setRebuild}
                      disabled={ingesting}
                    />
                    <div className="text-sm">
                      {rebuild ? "On" : "Off"}
                      <span className="mx-2 text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">
                        clears + re-embeds{" "}
                        <span className="font-mono">public.rag_*</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={onIngest} disabled={ingesting}>
                  {ingesting ? "Ingesting..." : "Run Ingest"}
                </Button>

                <InfoBox title="What this does">
                  Reads products/materials from the tenant schema, builds
                  documents/chunks, embeds with Titan, stores in pgvector.
                </InfoBox>
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
          </TabsContent>

          {/* EVAL */}
          <TabsContent value="eval" className="mt-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Eval</Badge>
                <Badge variant="outline">GET /eval</Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={onEval} disabled={evaling}>
                  {evaling ? "Running..." : "Run Eval"}
                </Button>

                {evalRes ? (
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      grounded: {evalRes.grounded_true}/{evalRes.total}
                    </Badge>
                    <Badge variant="secondary">
                      low confidence: {evalRes.low_confidence}
                    </Badge>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    Runs your fixed regression suite and reports
                    grounded/confidence.
                  </div>
                )}
              </div>

              {evalErr ? <ErrorBox message={evalErr} /> : null}

              {evalRes ? (
                <>
                  <Separator />

                  <div className="grid gap-3 md:grid-cols-3">
                    <InfoBox title="Total questions">{evalRes.total}</InfoBox>
                    <InfoBox title="Grounded true">
                      {evalRes.grounded_true}/{evalRes.total}
                    </InfoBox>
                    <InfoBox title="Low confidence">
                      {evalRes.low_confidence}
                    </InfoBox>
                  </div>

                  <Separator />

                  <div className="flex flex-col gap-2">
                    {evalRes.results.map((r, idx) => (
                      <Collapsible key={idx}>
                        <div className="rounded-2xl border bg-background p-3">
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div className="text-sm font-medium">
                              {r.question}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant={r.grounded ? "default" : "secondary"}
                              >
                                grounded: {String(r.grounded)}
                              </Badge>
                              <Badge variant="outline">
                                confidence: {prettyPct(r.confidence)}
                              </Badge>
                              {r.missing_data?.length ? (
                                <Badge variant="secondary">
                                  missing: {r.missing_data.length}
                                </Badge>
                              ) : null}

                              <CollapsibleTrigger asChild>
                                <Button size="sm" variant="outline">
                                  Details
                                </Button>
                              </CollapsibleTrigger>
                            </div>
                          </div>

                          <CollapsibleContent className="mt-3">
                            <div className="whitespace-pre-wrap text-sm">
                              {r.answer}
                            </div>

                            {r.missing_data?.length ? (
                              <div className="mt-2 text-xs text-muted-foreground">
                                Missing: {r.missing_data.join("; ")}
                              </div>
                            ) : null}
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
