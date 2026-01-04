import { z } from 'zod';

export const AnswerSchema = z.object({
  answer: z.string(),
  matches: z
    .array(
      z.object({
        chunk_id: z.number().optional(),
        doc_type: z.string().optional(),
        entity_table: z.string().nullable().optional(),
        entity_id: z.string().nullable().optional(),
        title: z.string().optional(),
        chunk_text: z.string().optional(),
      }),
    )
    .default([]),
  citations: z
    .array(
      z.object({
        chunk_id: z.number().optional(),
        title: z.string().optional(),
      }),
    )
    .default([]),

  // Self-check fields
  grounded: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.3),
  missing_data: z.array(z.string()).default([]),
  next_questions: z.array(z.string()).default([]),
});

export type AnswerOutput = z.infer<typeof AnswerSchema>;
