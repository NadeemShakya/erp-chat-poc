// src/pages/ChatPage.tsx
import type { ChatMessage, ChatResponse } from "@/types/chat";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { chatAsk } from "@/lib/api";

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

function clamp01(n: number) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function prettyConf(n: unknown) {
  const v = typeof n === "number" ? clamp01(n) : null;
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}

function Bubble({
  role,
  children,
  onClick,
  selected,
}: {
  role: "user" | "assistant";
  children: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        onClick={onClick}
        role={onClick ? "button" : undefined}
        className={[
          "max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
          onClick ? "cursor-pointer" : "",
          selected && !isUser ? "ring-2 ring-primary/40" : "",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}

function MatchRow({ m }: { m: ChatResponse["matches"][number] }) {
  if (!m.entity_table || !m.entity_id) {
    return (
      <div className="block px-3 py-2 hover:bg-muted/40 transition">
        <div className="font-semibold text-sm mb-2">
          {m.title || "(no title)"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          <span className="font-mono break-all">No ERP link available</span>
        </div>
      </div>
    );
  }

  const href = erpDetailUrl(
    m.entity_table as "products" | "materials",
    m.entity_id
  );

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="block px-3 py-2 hover:bg-muted/40 transition"
      title="Open in ERP (new tab)"
    >
      <div className="flex items-center gap-2 min-w-0 mb-2">
        <Badge variant="secondary">{m.entity_table}</Badge>
        <div className="font-semibold text-sm">{m.title}</div>
      </div>

      <div className="mt-1 text-xs text-muted-foreground">
        <span className="font-mono break-all">ID: {m.entity_id}</span>
      </div>
    </a>
  );
}

function DetailsPanel({
  selected,
}: {
  selected: { messageId: string; response: ChatResponse } | null;
}) {
  if (!selected) {
    return (
      <div className="h-full rounded-2xl border bg-background p-4">
        <div className="text-sm font-medium">Answer details</div>
        <div className="mt-2 text-sm text-muted-foreground">
          Click an assistant message to see matches, citations, and debug info.
        </div>
      </div>
    );
  }

  const r = selected.response;

  return (
    <div className="h-full rounded-2xl border bg-background">
      <div className="border-b p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-medium">Answer details</div>
            <div className="mt-1 text-xs text-muted-foreground break-all">
              Selected message:{" "}
              <span className="font-mono">{selected.messageId}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <Badge variant={r.grounded ? "default" : "secondary"}>
              grounded: {r.grounded ? "true" : "false"}
            </Badge>
            <Badge variant="secondary">
              confidence: {prettyConf(r.confidence)}
            </Badge>
          </div>
        </div>
      </div>

      <ScrollArea className="h-[55vh] md:h-[65vh] p-4">
        <div className="space-y-4 px-1">
          {/* Matches */}
          <div>
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                Matches ({r.matches?.length ?? 0})
              </div>
            </div>

            {r.matches?.length ? (
              <div className="mt-2 rounded-lg border bg-background divide-y">
                {r.matches.map((m) => (
                  <MatchRow key={`${m.entity_table}:${m.entity_id}`} m={m} />
                ))}
              </div>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">
                No matches returned.
              </div>
            )}
          </div>

          <Separator />

          {/* Citations */}
          <div>
            <div className="text-xs font-medium text-muted-foreground">
              Citations ({r.citations?.length ?? 0})
            </div>

            {r.citations?.length ? (
              <div className="mt-2 flex flex-col gap-2">
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
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">
                No citations.
              </div>
            )}
          </div>

          {/* Debug */}
          {r.debug ? (
            <>
              <Separator />
              <div>
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
            </>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = React.useState<ChatMessage[]>(() => [
    {
      id: uid(),
      role: "assistant",
      content:
        'Ask me about Products. Try: "Do we have a transformer for industrial applications, engineered for high reliability?" or "Look up for Transformer TX-1188"',
      createdAt: Date.now(),
    },
  ]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Track selected assistant message for right panel
  const [selected, setSelected] = React.useState<{
    messageId: string;
    response: ChatResponse;
  } | null>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, loading]);

  // If no selected item yet, auto-select the latest assistant response.
  React.useEffect(() => {
    if (selected) return;
    const last = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.response) as
      | (ChatMessage & { response: ChatResponse })
      | undefined;

    if (last?.response) {
      setSelected({ messageId: last.id, response: last.response });
    }
  }, [messages, selected]);

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

      // Auto-select the fresh response in the details panel
      setSelected({ messageId: assistantId, response: resp });
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
      // Focus input again
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  function clearChat() {
    setMessages([
      {
        id: uid(),
        role: "assistant",
        content:
          'Ask me about Products. Try: "Do we have a 3 phase transformer?" or "Look up for product with code: PE: TX-3150-33/11-ONAN"',
        createdAt: Date.now(),
      },
    ]);
    setSelected(null);
    setError(null);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function copyLastAnswer() {
    const last = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.response) as
      | (ChatMessage & { response: ChatResponse })
      | undefined;

    const text = last?.response?.answer ?? last?.content;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }

  const quickPrompts = [
    "Do we have Transformers?",
    "Do we have a 3 phased transformer?",
    "Do we have Himalayan Mango?",
    "Look up for product with code: PE: TX-3150-33/11-ONAN",
    "Customer is asking if the product with barcode: 09038 is a product we have. Can you check on this?",
    "List all the Control Panel products",
  ];

  return (
    <div className="mx-auto w-full max-w-6xl p-4">
      <div className="flex flex-col gap-4">
        {/* Header */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="text-lg">ERP Chat POC</CardTitle>
                <div className="mt-1 text-sm text-muted-foreground">
                  RAG (Titan embeddings + pgvector) • Agent-only • PDO duel
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  ERP links: <span className="font-mono">{ERP_BASE}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={copyLastAnswer}>
                  Copy last answer
                </Button>
                <Button variant="outline" onClick={clearChat}>
                  Clear chat
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Main layout: chat + details */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_360px]">
          {/* Chat */}
          <Card className="rounded-2xl">
            <CardContent className="flex flex-col gap-3 pt-6">
              <ScrollArea className="h-[65vh] w-full rounded-xl border bg-background p-5">
                <div className="flex flex-col gap-3 px-1">
                  {messages.map((m) => {
                    const isSelected =
                      m.role === "assistant" &&
                      !!m.response &&
                      selected?.messageId === m.id;

                    return (
                      <div key={m.id} className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[11px] text-muted-foreground">
                            {formatRole(m.role)}
                          </div>
                        </div>

                        <Bubble
                          role={m.role}
                          selected={isSelected}
                          onClick={
                            m.role === "assistant" && m.response
                              ? () =>
                                  setSelected({
                                    messageId: m.id,
                                    response: m.response as ChatResponse,
                                  })
                              : undefined
                          }
                        >
                          <div className="whitespace-pre-wrap">{m.content}</div>
                        </Bubble>
                      </div>
                    );
                  })}
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
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder='Try: "Do we have a product for industrial applications, engineered for high reliability?"'
                  className="min-h-[84px] resize-none rounded-2xl"
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

          {/* Details */}
          <DetailsPanel selected={selected} />
        </div>

        {/* Quick prompts */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quick prompts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {quickPrompts.map((p) => (
              <Button
                key={p}
                variant="secondary"
                className="rounded-2xl"
                onClick={() => {
                  setInput(p);
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
              >
                {p}
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
