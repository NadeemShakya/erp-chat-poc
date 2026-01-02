export type ChatMatch = {
  entity_table: "products" | "materials";
  entity_id: string;
  title: string;
  reason: string;
};

export type ChatCitation = {
  chunk_id: number;
  title: string;
};

export type ChatResponse = {
  answer: string;
  matches: ChatMatch[];
  citations: ChatCitation[];
  debug?: any;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  response?: ChatResponse; // only for assistant messages
  createdAt: number;
};
