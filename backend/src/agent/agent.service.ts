import { Injectable } from '@nestjs/common';
import { PromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { z } from 'zod';

import { LangchainService } from 'src/ai/langchain.service';
import { AnswerSchema, type AnswerOutput } from 'src/ai/schemas';
import { SqlService } from 'sql/sql.service';
import { RagService } from 'rag/rag.service';

// (Keep your existing PlanSchema if you want, but we won't use it in this mode)

// Filter schema: only return ids of chunks that actually support the answer
const FilterSchema = z.object({
  keep_chunk_ids: z.array(z.number()).max(8).default([]),
});
type FilterOutput = z.infer<typeof FilterSchema>;

// ✅ NEW: rewrite schema for RAG query
const RagQuerySchema = z.object({
  rag_query: z.string().min(1),
});
type RagQueryOutput = z.infer<typeof RagQuerySchema>;

@Injectable()
export class AgentService {
  constructor(
    private readonly lc: LangchainService,
    private readonly sql: SqlService, // unused for now, ok to keep
    private readonly rag: RagService,
  ) {}

  private buildSourcesText(matches: any[]) {
    if (!matches?.length) return '';
    return matches
      .map((m, i) => {
        const header = `# Source ${i + 1} (chunk_id=${m.chunk_id}, title=${m.title})`;
        const body = m.chunk_text ?? '';
        return `${header}\n${body}`;
      })
      .join('\n\n');
  }

  private safeJsonStringify(obj: any) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  // ✅ NEW: RAG rewrite prompt (f-string safe: no unescaped { } examples)
  private rewritePrompt() {
    return new PromptTemplate({
      template: `
You are rewriting a user question into a compact search query for hybrid RAG over Product documents.

The RAG index includes ALL product fields ingested into raw_text, including:
- product name
- product code
- barcode
- product type
- description
- attributes (attribute name + value + unit)

Rewrite rules:
- Output a short keyword/spec query (not a sentence).
- Include key entity/type words (e.g. transformer, insulation material).
- If a numeric/unit value appears, include common variants:
  - 11kV -> "11kV" OR "11 kV" OR "11 kilovolt" OR "11000 V"
  - 200 Hz -> "200 Hz" OR "200Hz" OR "200 Hertz"
- If the user implies an attribute, add likely attribute label words:
  - "11kV transformer" -> include "Primary Voltage" and "Voltage"
  - "frequency 200" -> include "Frequency"

Return ONLY valid JSON matching this schema:
{format_instructions}

User question:
<<<{question}>>>
`,
      inputVariables: ['question', 'format_instructions'],
    });
  }

  private filterPrompt() {
    return new PromptTemplate({
      template: `
You are filtering retrieval results for an ERP assistant.

Goal:
Select ONLY the chunks that directly support answering the user question.
Reject chunks that are unrelated, generic, or do not mention relevant properties.

Rules:
- Keep at most 8 chunk_ids.
- Keep a chunk ONLY if it contains clear evidence relevant to the question.
- Return ONLY JSON matching the schema.
- No markdown, no code fences, no extra keys.

User question:
<<<{question}>>>

Candidate sources:
<<<{sources}>>>

Return JSON:
{format_instructions}
`,
      inputVariables: ['question', 'sources', 'format_instructions'],
    });
  }

  private finalAnswerPrompt() {
    return new PromptTemplate({
      template: `
You are an ERP assistant.

Use ONLY the information in SQL_RESULT and SOURCES.
If you cannot answer, say you don't know.

STRICT OUTPUT RULES:
- Return ONLY valid JSON matching the schema (no markdown, no code fences, no <thinking>, no JSON schema).
- Do NOT include "$schema" or "properties" keys.

User question:
<<<{question}>>>

SQL_RESULT:
<<<{sql_result}>>>

SOURCES:
<<<{sources}>>>

Return ONLY JSON in this schema:
{format_instructions}
`,
      inputVariables: [
        'question',
        'sql_result',
        'sources',
        'format_instructions',
      ],
    });
  }

  async run(message: string): Promise<AnswerOutput> {
    const llm = this.lc.model;

    // 1) ✅ REWRITE query for RAG (with safe fallback)
    let ragQuery = message;
    try {
      const rewriteParser =
        StructuredOutputParser.fromZodSchema(RagQuerySchema);
      const rewriteChain = RunnableSequence.from([
        this.rewritePrompt(),
        llm,
        rewriteParser,
      ]);

      const rewritten: RagQueryOutput = await rewriteChain.invoke({
        question: message,
        format_instructions: rewriteParser.getFormatInstructions(),
      });

      ragQuery = rewritten?.rag_query?.trim() || message;
    } catch (e) {
      // fallback to raw user message
      ragQuery = message;
    }

    // 2) ALWAYS RAG with the rewritten query
    const matches = await this.rag.search(ragQuery, 10);

    // 3) FILTER the matches
    let filteredMatches = matches;

    if (matches?.length) {
      const filterParser = StructuredOutputParser.fromZodSchema(FilterSchema);
      const filterChain = RunnableSequence.from([
        this.filterPrompt(),
        llm,
        filterParser,
      ]);

      const filter: FilterOutput = await filterChain.invoke({
        question: message,
        sources: this.buildSourcesText(matches),
        format_instructions: filterParser.getFormatInstructions(),
      });

      const keep = new Set<number>((filter.keep_chunk_ids ?? []).map(Number));
      filteredMatches = matches.filter((m) => keep.has(Number(m.chunk_id)));

      if (!filteredMatches.length) filteredMatches = matches.slice(0, 1);
    }

    // 4) FINAL ANSWER
    const answerParser = StructuredOutputParser.fromZodSchema(AnswerSchema);
    const answerChain = RunnableSequence.from([
      this.finalAnswerPrompt(),
      llm,
      answerParser,
    ]);

    const final = await answerChain.invoke({
      question: message,
      sql_result: this.safeJsonStringify([]), // no SQL in this mode
      sources: this.buildSourcesText(filteredMatches),
      format_instructions: answerParser.getFormatInstructions(),
    });

    const safeCitations = (filteredMatches ?? []).map((m) => ({
      chunk_id: m.chunk_id,
      title: m.title,
    }));

    return {
      ...final,
      matches: filteredMatches,
      citations: final.citations?.length ? safeCitations : [],
    };
  }
}
