import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { PromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { Injectable } from '@nestjs/common';
import { LangchainService } from 'src/ai/langchain.service';
import { AnswerSchema, type AnswerOutput } from 'src/ai/schemas';
import { RagService } from 'src/rag/rag.service';
import { z } from 'zod';

// Filter schema: only return ids of chunks that actually support the answer
const FilterSchema = z.object({
  keep_chunk_ids: z.array(z.number()).max(8).default([]),
});
type FilterOutput = z.infer<typeof FilterSchema>;

// Rewrite schema for RAG query
const RagQuerySchema = z.object({
  rag_query: z.string().min(1),
});
type RagQueryOutput = z.infer<typeof RagQuerySchema>;

type TraceOpts = {
  tags?: string[];
  metadata?: Record<string, any>;
};

@Injectable()
export class AgentService {
  constructor(
    private readonly lc: LangchainService,
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

  /**
   * RAG rewrite prompt
   */
  private rewritePrompt() {
    return new PromptTemplate({
      template: `
You are rewriting a user question into a compact search query for hybrid RAG over Product documents.

The RAG index includes ALL product fields ingested into raw_text, including:
- Entity: Product
- Name:
- Code:
- Barcode:
- Product Type:
- Description:
- Attributes lines like: "- <Attribute Name> (<Unit>): <Value>"

IMPORTANT INTERPRETATION RULE:
If the user asks "Have we built X?" or "Have we built X before?" interpret it as:
"Does our ERP have a Product record for X (by name/code/type/attributes)?"
So your rewrite should search for product records, not manufacturing history.

Rewrite rules:
- Output a short keyword/spec query (not a sentence).
- Prefer the raw_text field labels when possible: "Name:", "Code:", "Product Type:", "Attributes:".
- If the user mentions a specific named product (e.g. Himalayan Mango), include:
  - "Name: <name>" and also the plain name.
- If the user asks by type/category (e.g. Distribution Transformer), include:
  - "Product Type: <type>" and also the plain type.
- If numeric/unit appears, include common variants:
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
- Return ONLY JSON matching the schema (no markdown, no extra keys).
- Keep a chunk ONLY if it contains clear evidence relevant to the question.

EVIDENCE GATING (VERY IMPORTANT):

1) If the user question is a USE-CASE / SUITABILITY query (contains words like "for", "suitable", "applications", "engineered", "reliability", "recommended"):
   - Keep a chunk ONLY if at least one of these is true:
     a) The chunk's Description line is NON-EMPTY and contains at least ONE key idea from the question (case-insensitive).
     b) The chunk contains an Attributes line that matches a key idea from the question.
     c) The Product Type clearly matches the implied need (e.g., transformer categories when user is asking about industrial power equipment).
   - STRONG REJECTION:
     If Description is empty AND Attributes is "- (none)" (or empty), reject the chunk unless it matches by exact Name/Code requested in the question.

2) If the user asks for a SPECIFIC product by name/code/barcode:
   - Keep only direct matches (Name:/Code:/Barcode line match, case-insensitive).

3) If the user asks a BROAD category (e.g. "Do we have Transformers?"):
   - Keep chunks ONLY where the Name OR Product Type clearly contains that category word (case-insensitive).
   - Do NOT keep chunks that do not mention the category in Name or Product Type.

4) If the user asks to LIST / FIND / SHOW products with a constraint keyword/phrase X
   (examples: "List me all the Control Panel products", "products with water-based exterior wall", "products with frequency 200"):
   - Keep a chunk ONLY if the chunk contains the keyword/phrase X (case-insensitive) OR an obvious formatting variant,
     somewhere in ONE of these places:
     - Name:
     - Code:
     - Barcode:
     - Product Type:
     - Description:
     - Attributes lines (the lines starting with "- ")
   - STRONG REJECTION:
     If the chunk does NOT mention X anywhere in those fields, it is NOT evidence and must be rejected.

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

  private finalAnswerPromptV1() {
    return new PromptTemplate({
      template: `
You are an ERP assistant.

DEFINITION:
- "Do we have X?" / "Have we built X?" means: "Does our ERP have Product records matching X (by name/code/barcode/type/attributes)?"

You MUST use ONLY SOURCES and SQL_RESULT (SQL_RESULT is usually empty in this mode).

CLASSIFY THE QUESTION (pick exactly one):
C) DETAIL request: the user asks for attributes/specs/details of a specific product
   (examples: "attributes", "specs", "specifications", "properties", "details", "what are the attributes", "provide me the attributes").
D) LOOKUP / SHOW request: the user asks to retrieve or show a product record (NOT yes/no),
   (examples: "look up", "lookup", "find", "search", "show me", "get me", "pull up", "fetch", "can you check on this").
A) SPECIFIC existence check: the user provides a specific product name/code/barcode and asks if it exists
   (examples: "do we have", "is there", "have we built", "did we build", "exists", "is this a product we have").
B) BROAD category: the user asks for a category/type (e.g. "Do we have Transformers?").

PRIORITY:
- If it looks like a DETAIL request, ALWAYS treat it as C even if the product identifier is specific.
- Else if it looks like a LOOKUP / SHOW request, treat it as D (even if a code/name/barcode is provided).
- Otherwise choose A or B.

MATCHING GUIDANCE (IMPORTANT):
- Treat matches as case-insensitive.
- A "direct match" is when a source contains "Entity: Product" AND one of:
  - Name match: a line like "Name: <user name>"
  - Code match: a line like "Code: <user code>"
  - Barcode match: a line like "Barcode: <user barcode>"
- If the user gives a product name, a chunk containing a line "Name: <that name>" is a direct match.
- If the user gives a code, a chunk containing a line "Code: <that code>" is a direct match.
- If the user gives a barcode, a chunk containing a line "Barcode: <that barcode>" is a direct match.
- Never answer "No" or "I couldn’t find" when a direct match exists in SOURCES.

HOW TO ANSWER:

C) DETAIL REQUEST RULES (ATTRIBUTES/SPECS):
- First, identify the best matching Product record in SOURCES.
- Prefer a direct match by Name/Code/Barcode.
- If a direct match exists:
  - Answer must start with: "Here are the attributes for <Name> (Code: <Code>):"
    - If Code is empty, omit "(Code: ...)".
  - Then list ALL attribute lines found under "Attributes:" exactly as they appear in the source.
    - Only list lines that start with "- " under the Attributes section.
  - If the Attributes section is "- (none)" or empty:
    - Say: "No attributes are recorded for this product in the ERP."
  - Citations must include ONLY the chunk(s) you used (usually 1).
- If no direct match exists:
  - Answer must start with: "I don't know —"
  - Then say you couldn't find a product record matching the requested name/code/barcode in SOURCES.
  - If there are close matches, list up to 3 (Name + Code + Type).

D) LOOKUP / SHOW REQUEST RULES (RETRIEVE A RECORD):
- Identify the best matching Product record in SOURCES.
- Prefer a direct match by Name/Code/Barcode.
- If a direct match exists:
  - Do NOT start with "Yes" or "No".
  - Return the best match as a short record:
    "<Name> (Code: <Code>) — Type: <Product Type> — Barcode: <Barcode>"
    - If Code or Barcode is empty, omit that part.
  - Optionally include up to 2 extra helpful facts if present (examples: Primary Voltage, Secondary Voltage, Rated Power Capacity, Frequency, Vector Group, Cooling Method).
  - Citations must include ONLY the chunk(s) you referenced (usually 1).
- If no direct match exists:
  - Do NOT start with "Yes" or "No".
  - Say: "I couldn’t find a product matching <X>."
  - If there are close matches in SOURCES, say: "Closest matches I found:" and list up to 3 (Name + Code + Type).
  - If unsure due to ambiguity, say "I don't know" and explain what is missing.

A) SPECIFIC EXISTENCE CHECK RULES:
- If SOURCES contains a direct match Product record by Name/Code/Barcode:
  - Answer must start with: "Yes —"
  - Then show the best match as a short record:
    "<Name> (Code: <Code>) — Type: <Product Type> — Barcode: <Barcode>"
    - If Code or Barcode is empty, omit that part.
  - Optionally include 1 extra supporting detail if helpful, but keep it concise.
  - Citations must include ONLY the chunk(s) you referenced (usually 1).
- If no direct match:
  - Answer must start with: "No —"
  - If there are close matches in SOURCES, say: "Closest matches I found:" and list up to 3 (Name + Code + Type).
  - Set grounded=true only if SOURCES actually support the "No" (i.e. no direct match appears in SOURCES).
  - If unsure due to ambiguity, say "I don't know" and explain what is missing.

B) BROAD CATEGORY RULES:
- If at least one matching Product exists in SOURCES, answer "Yes" and provide up to 5 examples:
  "<Name> (Code: <Code>) — Type: <Product Type>"
- If none match, answer "No" and briefly say you couldn’t find products matching that category in SOURCES.
- If more than 5 match, say: "Showing a few examples."

GROUNDING & CITATIONS:
- grounded=true ONLY if your answer is directly supported by the specific Product chunks you cite.
- citations MUST include ONLY the chunks you actually used in the answer (ideally 1–3, never all matches).
- If you list multiple examples, cite the chunks for those examples only.

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

  private finalAnswerPromptV2() {
    return new PromptTemplate({
      template: `
You are an ERP assistant.

Use ONLY SOURCES and SQL_RESULT.

Follow the same classification + rules as V1, BUT:
- For BROAD category or LIST requests: if there are matches in SOURCES, always show 2–5 examples.
- Never answer "No" if any source contains a direct match for the requested Name/Code/Barcode.
- If the user asks to list/show/find, do not begin with "Yes/No" — present results directly.

Return ONLY valid JSON matching the schema.
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

  private extractDirectMatchSignals(question: string, sourcesText: string) {
    const codeLike = question
      .match(/code\s*[:\-]?\s*([A-Za-z0-9:\/\-\s]+)$/i)?.[1]
      ?.trim();
    const barcodeLike = question
      .match(/barcode\s*[:\-]?\s*([0-9A-Za-z\-]+)\b/i)?.[1]
      ?.trim();

    const hasCodeInSources = codeLike
      ? sourcesText.toLowerCase().includes(`code: ${codeLike.toLowerCase()}`)
      : false;

    const hasBarcodeInSources = barcodeLike
      ? sourcesText
          .toLowerCase()
          .includes(`barcode: ${barcodeLike.toLowerCase()}`)
      : false;

    const possibleName =
      question.match(/do we have\s+(.+?)\??$/i)?.[1]?.trim() ||
      question.match(/have we built\s+(.+?)\??$/i)?.[1]?.trim() ||
      question.match(/product named\s+(.+?)\??$/i)?.[1]?.trim();

    const hasNameInSources = possibleName
      ? sourcesText
          .toLowerCase()
          .includes(`name: ${possibleName.toLowerCase()}`)
      : false;

    return { hasCodeInSources, hasBarcodeInSources, hasNameInSources };
  }

  private scoreAnswer(params: {
    out: any; // AnswerOutput
    filteredMatches: any[];
    sourcesText: string;
    question: string;
  }) {
    const { out, filteredMatches, sourcesText, question } = params;

    let score = 0;
    if (!out || typeof out.answer !== 'string') return -999;

    if (out.grounded === true) score += 3;
    else score -= 1;

    const conf = typeof out.confidence === 'number' ? out.confidence : 0;
    if (conf >= 0.9 && out.grounded !== true) score -= 2;
    if (conf >= 0.7) score += 1;

    const matchIds = new Set(
      (filteredMatches ?? []).map((m) => String(m.chunk_id)),
    );
    const citedIds = (out.citations ?? []).map((c: any) => String(c.chunk_id));
    const invalidCites = citedIds.filter((id: string) => !matchIds.has(id));

    if (invalidCites.length) score -= 5;
    else if (citedIds.length) score += 1;

    const ansLower = out.answer.toLowerCase();
    const saysNo =
      ansLower.startsWith('no') || ansLower.includes('couldn’t find');
    const signals = this.extractDirectMatchSignals(question, sourcesText);

    if (
      saysNo &&
      (signals.hasCodeInSources ||
        signals.hasBarcodeInSources ||
        signals.hasNameInSources)
    ) {
      score -= 10;
    }

    if (
      !saysNo &&
      (signals.hasCodeInSources ||
        signals.hasBarcodeInSources ||
        signals.hasNameInSources)
    ) {
      score += 1;
    }

    return score;
  }

  async run(message: string, trace?: TraceOpts): Promise<AnswerOutput> {
    const llm = this.lc.model;

    // Shared LangSmith context (tags + metadata)
    const baseRunConfig = {
      tags: ['erp-poc', 'agent', 'rag', 'pdo', ...(trace?.tags ?? [])],
      metadata: {
        app: 'erp-chat-poc',
        mode: 'agent-rag-only',
        ...(trace?.metadata ?? {}),
      },
    };

    // 1) REWRITE query for RAG (with safe fallback)
    let ragQuery = message;
    try {
      const rewriteParser =
        StructuredOutputParser.fromZodSchema(RagQuerySchema);
      const rewriteChain = RunnableSequence.from([
        this.rewritePrompt(),
        llm,
        rewriteParser,
      ]);

      const rewritten: RagQueryOutput = await rewriteChain.invoke(
        {
          question: message,
          format_instructions: rewriteParser.getFormatInstructions(),
        },
        {
          ...baseRunConfig,
          runName: 'rewrite_rag_query',
          tags: [...baseRunConfig.tags, 'rewrite'],
        },
      );

      ragQuery = rewritten?.rag_query?.trim() || message;
    } catch {
      ragQuery = message;
    }

    // 2) ALWAYS RAG with the rewritten query
    const matches = await this.rag.searchHybrid(ragQuery, 10);

    // 3) FILTER the matches
    let filteredMatches = matches;

    if (matches?.length) {
      const filterParser = StructuredOutputParser.fromZodSchema(FilterSchema);
      const filterChain = RunnableSequence.from([
        this.filterPrompt(),
        llm,
        filterParser,
      ]);

      const filter: FilterOutput = await filterChain.invoke(
        {
          question: message,
          sources: this.buildSourcesText(matches),
          format_instructions: filterParser.getFormatInstructions(),
        },
        {
          ...baseRunConfig,
          runName: 'filter_rag_matches',
          tags: [...baseRunConfig.tags, 'filter'],
          metadata: {
            ...baseRunConfig.metadata,
            ragQuery,
            candidates: matches.length,
          },
        },
      );

      const keep = new Set<number>((filter.keep_chunk_ids ?? []).map(Number));
      filteredMatches = matches.filter((m) => keep.has(Number(m.chunk_id)));

      const isIdentifierQuery =
        /barcode|code|look up|lookup|find|search|show me/i.test(message);

      if (!filteredMatches.length) {
        filteredMatches = isIdentifierQuery ? [] : matches.slice(0, 1);
      }
    }

    // 4) FINAL ANSWER (PDO duel)
    const answerParser = StructuredOutputParser.fromZodSchema(AnswerSchema);

    const sourcesText = this.buildSourcesText(filteredMatches);
    const sqlResultText = this.safeJsonStringify([]);

    const chainV1 = RunnableSequence.from([
      this.finalAnswerPromptV1(),
      llm,
      answerParser,
    ]);
    const chainV2 = RunnableSequence.from([
      this.finalAnswerPromptV2(),
      llm,
      answerParser,
    ]);

    const [out1, out2] = await Promise.all([
      chainV1.invoke(
        {
          question: message,
          sql_result: sqlResultText,
          sources: sourcesText,
          format_instructions: answerParser.getFormatInstructions(),
        },
        {
          ...baseRunConfig,
          runName: 'final_answer_v1',
          tags: [...baseRunConfig.tags, 'final', 'v1'],
          metadata: {
            ...baseRunConfig.metadata,
            ragQuery,
            filtered: filteredMatches.length,
          },
        },
      ),
      chainV2.invoke(
        {
          question: message,
          sql_result: sqlResultText,
          sources: sourcesText,
          format_instructions: answerParser.getFormatInstructions(),
        },
        {
          ...baseRunConfig,
          runName: 'final_answer_v2',
          tags: [...baseRunConfig.tags, 'final', 'v2'],
          metadata: {
            ...baseRunConfig.metadata,
            ragQuery,
            filtered: filteredMatches.length,
          },
        },
      ),
    ]);

    const score1 = this.scoreAnswer({
      out: out1,
      filteredMatches,
      sourcesText,
      question: message,
    });
    const score2 = this.scoreAnswer({
      out: out2,
      filteredMatches,
      sourcesText,
      question: message,
    });

    const winner =
      score2 > score1
        ? { out: out2, version: 'v2', score: score2 }
        : { out: out1, version: 'v1', score: score1 };

    console.log('PDO duel:', {
      question: message,
      score1,
      score2,
      winner: winner.version,
    });

    const safeCitations = (filteredMatches ?? []).map((m) => ({
      chunk_id: m.chunk_id,
      title: m.title,
    }));

    return {
      ...winner.out,
      matches: filteredMatches,
      citations: winner.out.citations?.length ? safeCitations : [],
    };
  }
}
