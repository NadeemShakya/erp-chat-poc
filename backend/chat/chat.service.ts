import { Injectable } from '@nestjs/common';
import { AgentService } from 'src/agent/agent.service';
import { type AnswerOutput } from '../src/ai/schemas';

@Injectable()
export class ChatService {
  constructor(private readonly agent: AgentService) {}

  async ask(message: string): Promise<AnswerOutput> {
    // Hard requirement: agent-only mode.
    // This prevents silent fallbacks and confusion.
    const useLangchain =
      String(process.env.USE_LANGCHAIN ?? 'true').toLowerCase() === 'true';
    const useAgent =
      String(process.env.USE_AGENT ?? 'true').toLowerCase() === 'true';

    if (!useLangchain || !useAgent) {
      throw new Error(
        `Misconfiguration: This build expects USE_LANGCHAIN=true and USE_AGENT=true. Got USE_LANGCHAIN=${useLangchain} USE_AGENT=${useAgent}`,
      );
    }

    return this.agent.run(message);
  }
}
