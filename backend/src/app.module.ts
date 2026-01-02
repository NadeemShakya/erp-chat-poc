import { Module } from '@nestjs/common';
import { BedrockService } from 'bedrock/bedrock.service';
import { ChatController } from 'chat/chat.controller';
import { ChatService } from 'chat/chat.service';
import { RagService } from 'rag/rag.service';
import { SqlService } from 'sql/sql.service';
import { AgentService } from './agent/agent.service';
import { LangchainService } from './ai/langchain.service';
import { EvalController } from './eval/eval.controller';
import { IngestController } from './ingest/ingest.controller';
import { IngestService } from './ingest/ingest.service';

@Module({
  controllers: [ChatController, IngestController, EvalController],
  providers: [
    BedrockService,
    RagService,
    SqlService,
    ChatService,
    LangchainService,
    IngestService,
    AgentService,
  ],
})
export class AppModule {}
