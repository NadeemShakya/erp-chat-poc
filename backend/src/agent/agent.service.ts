import { Injectable } from '@nestjs/common';
import { PromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { z } from 'zod';

import { LangchainService } from 'src/ai/langchain.service';
import { AnswerSchema, type AnswerOutput } from 'src/ai/schemas';
import { SqlService } from 'sql/sql.service';
import { RagService } from 'rag/rag.service';

const PlanSchema = z.object({
  steps: z
    .array(
      z.object({
        tool: z.enum(['sql', 'rag']),
        input: z.string().min(1),
        why: z.string().optional(),
      }),
    )
    .min(1)
    .max(6),
});

type PlanOutput = z.infer<typeof PlanSchema>;

// Filter schema: only return ids of chunks that actually support the answer
const FilterSchema = z.object({
  keep_chunk_ids: z.array(z.number()).max(8).default([]),
});

type FilterOutput = z.infer<typeof FilterSchema>;

@Injectable()
export class AgentService {
  constructor(
    private readonly lc: LangchainService,
    private readonly sql: SqlService,
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

  private planPrompt() {
    // NOTE: avoid `{` `}` examples unless escaped as `{{` `}}` because PromptTemplate uses f-string style.
    return new PromptTemplate({
      template: `
You are an ERP assistant. You can use TWO tools, executed by the system:
- sql: for exact counts/lists/filters/aggregations (READ ONLY)
- rag: for fuzzy/semantic lookup on embedded Product/Material documents

CRITICAL DB RULES:
- Products table: products
- Product code column: products.code
- Materials table: materials
- Material code: materials.material_id
- IDs are UUIDs. If user gives something like "PN-xxxx" it's likely products.code, not products.id.
- Product attributes are in product_attributes joined with attribute_types on pa.attribute_id = at.id.

SQL RULES:
- Output ONE statement only.
- Only SELECT/WITH.
- Always filter deleted rows: where <table>.deleted_at is null

TASK:
Given the user question, output a plan of 1 to 3 steps.
Use sql when you need exact numbers/lists.
Use rag when you need fuzzy match / descriptions / finding entity IDs by name/code.

IMPORTANT OUTPUT RULES:
- Return ONLY valid JSON for this schema (no markdown, no code fences, no extra keys):
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

    // 1) PLAN
    const planParser = StructuredOutputParser.fromZodSchema(PlanSchema);
    const planChain = RunnableSequence.from([
      this.planPrompt(),
      llm,
      planParser,
    ]);

    const plan: PlanOutput = await planChain.invoke({
      question: message,
      format_instructions: planParser.getFormatInstructions(),
    });

    // 2) EXECUTE
    let sqlResult: any[] = [];
    let matches: any[] = [];

    console.log('Agent plan:', plan);

    for (const step of plan.steps) {
      if (step.tool === 'sql') {
        try {
          const res = await this.sql.query(step.input);
          sqlResult = res.rows ?? [];
        } catch (e: any) {
          sqlResult = [
            {
              sql_error: String(e?.message ?? e),
              attempted_sql: step.input,
            },
          ];
        }
      }

      if (step.tool === 'rag') {
        matches = await this.rag.search(step.input, 10);
      }
    }

    // 2.5) FILTER the matches to only relevant chunks
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

      // Safety fallback: if the filter keeps nothing, keep top 1
      if (!filteredMatches.length) filteredMatches = matches.slice(0, 1);
    }

    // 3) FINAL ANSWER (strict JSON)
    const answerParser = StructuredOutputParser.fromZodSchema(AnswerSchema);
    const answerChain = RunnableSequence.from([
      this.finalAnswerPrompt(),
      llm,
      answerParser,
    ]);

    const final = await answerChain.invoke({
      question: message,
      sql_result: this.safeJsonStringify(sqlResult),
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
