// src/pages/ChatPage.tsx
import * as React from "react";
import type { ChatMessage, ChatResponse } from "@/types/chat";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { chatAsk, ingestProductsMaterials } from "@/lib/api";
import { DevToolsPanel } from "@/components/dev/DevToolsPanel";

const showDev =
  String(import.meta.env.VITE_SHOW_DEV_TOOLS ?? "false").toLowerCase() ===
  "true";

const ERP_BASE =
  import.meta.env.VITE_ERP_BASE_URL ||
  "http://power_electronics.localhost:3000";

function erpDetailUrl(entityTable: "products" | "materials", entityId: string) {
  if (entityTable === "products") {
    return `${ERP_BASE}/products/${entityId}`;
  }
  return `${ERP_BASE}/material-management/materials/${entityId}`;
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function formatRole(role: "user" | "assistant") {
  return role === "user" ? "You" : "Assistant";
}

function Bubble({
  role,
  children,
}: {
  role: "user" | "assistant";
  children: React.ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}

function Matches({ r }: { r: ChatResponse }) {
  if (!r.matches?.length) return null;

  return (
    <div className="mt-3">
      <div className="text-xs font-medium text-muted-foreground mb-2">
        Matches
      </div>

      <div className="flex flex-col gap-2">
        {r.matches.map((m) => {
          const href = erpDetailUrl(m.entity_table, m.entity_id);

          return (
            <a
              key={`${m.entity_table}:${m.entity_id}`}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="group rounded-xl border bg-background px-3 py-2 hover:bg-muted/40 transition"
              title="Open in ERP (new tab)"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{m.entity_table}</Badge>
                <span className="font-medium underline-offset-4 group-hover:underline">
                  {m.title}
                </span>
              </div>

              <div className="mt-1 text-xs text-muted-foreground break-all">
                ID: {m.entity_id}
              </div>

              {m.reason ? <div className="mt-1 text-xs">{m.reason}</div> : null}

              <div className="mt-2 text-[11px] text-muted-foreground">
                Open: <span className="font-mono">{href}</span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function Citations({ r }: { r: ChatResponse }) {
  if (!r.citations?.length) return null;

  return (
    <div className="mt-3">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm">
            Show citations ({r.citations.length})
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-2">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Citations
          </div>

          <div className="flex flex-col gap-2">
            {r.citations.map((c) => (
              <div
                key={c.chunk_id}
                className="rounded-xl border bg-background px-3 py-2"
              >
                <div className="text-xs">
                  <span className="font-mono">chunk_id: {c.chunk_id}</span>
                  <span className="mx-2 text-muted-foreground">•</span>
                  <span className="font-medium">{c.title}</span>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function DebugPanel({ r }: { r: ChatResponse }) {
  if (!r.debug) return null;
  return (
    <div className="mt-3">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm">
            Toggle debug
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <pre className="whitespace-pre-wrap break-words rounded-xl border bg-background p-3 text-xs">
            {JSON.stringify(r.debug, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export default function ChatPanel() {
  const [ingesting, setIngesting] = React.useState(false);
  const [ingestResult, setIngestResult] = React.useState<any>(null);
  const [ingestError, setIngestError] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>(() => [
    {
      id: uid(),
      role: "assistant",
      content:
        'Ask me about Products or Materials. Try: "How many products have Cooling Type ONAN?" or "Product with name Refresh Tears?"',
      createdAt: Date.now(),
    },
  ]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, loading]);

  async function onIngest() {
    if (ingesting) return;
    setIngestError(null);
    setIngestResult(null);
    setIngesting(true);
    try {
      const r = await ingestProductsMaterials({
        tenantSchema: "tenant_power_electronics",
        rebuild: true,
      });
      setIngestResult(r);

      // Optional: add a system message into chat
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: `✅ Ingestion complete. Products: ${r.source.products}, Materials: ${r.source.materials}.`,
          createdAt: Date.now(),
        },
      ]);
    } catch (e: any) {
      setIngestError(e?.message ?? "Ingestion failed");
    } finally {
      setIngesting(false);
    }
  }

  async function onSend() {
    const text = input.trim();
    if (!text || loading) return;

    setError(null);
    setInput("");

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };

    const assistantId = uid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "Thinking…",
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setLoading(true);

    try {
      const resp = await chatAsk(text);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: resp.answer || "(no answer)",
                response: resp,
              }
            : m
        )
      );
    } catch (e: any) {
      const msg = e?.message ?? "Something went wrong";
      setError(msg);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Sorry — I hit an error calling the API." }
            : m
        )
      );
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">ERP Chat POC</CardTitle>
          <div className="text-sm text-muted-foreground">
            RAG (Titan embeddings + pgvector) + Nova Lite (SQL + fuzzy)
          </div>
          <div className="text-xs text-muted-foreground">
            ERP links: <span className="font-mono">{ERP_BASE}</span>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <ScrollArea className="h-[65vh] w-full rounded-xl border bg-background p-4">
            <div className="flex flex-col gap-3">
              {messages.map((m) => (
                <div key={m.id} className="flex flex-col gap-2">
                  <div className="text-[11px] text-muted-foreground">
                    {formatRole(m.role)}
                  </div>

                  <Bubble role={m.role}>
                    <div className="whitespace-pre-wrap">{m.content}</div>

                    {m.role === "assistant" && m.response ? (
                      <>
                        <Separator className="my-3" />
                        <Matches r={m.response} />
                        <Citations r={m.response} />
                        <DebugPanel r={m.response} />
                      </>
                    ) : null}
                  </Bubble>
                </div>
              ))}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          {error ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder='Try: "Show components for product Refresh Tears"'
              className="min-h-[80px] resize-none rounded-2xl"
              disabled={loading}
            />
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Enter to send • Shift+Enter for newline
              </div>
              <Button onClick={onSend} disabled={loading || !input.trim()}>
                {loading ? "Sending..." : "Send"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick prompts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[
            "Product with name Refresh Tears?",
            "How many products have Cooling Type ONAN?",
            "Do we have radiator from Hyundai?",
            "List materials with part number containing HYD",
            "Show components for product Refresh Tears",
          ].map((p) => (
            <Button
              key={p}
              variant="secondary"
              className="rounded-2xl"
              onClick={() => setInput(p)}
            >
              {p}
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
