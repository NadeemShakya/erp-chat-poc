export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  response?: ChatResponse; // only for assistant messages
  createdAt: number;
};

export type ChatMatch = {
  chunk_id?: number;
  doc_type?: string;
  entity_table?: string | null;
  entity_id?: string | null;
  title?: string;
  chunk_text?: string;
};

export type ChatCitation = {
  chunk_id?: number;
  title?: string;
};

export type ChatResponse = {
  answer: string;

  matches: ChatMatch[];
  citations: ChatCitation[];

  grounded: boolean;
  confidence: number; // 0..1
  missing_data: string[];
  next_questions: string[];

  debug?: any;
};
