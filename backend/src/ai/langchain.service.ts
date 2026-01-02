import { Injectable } from '@nestjs/common';
import { ChatBedrockConverse } from '@langchain/aws';

@Injectable()
export class LangchainService {
  private readonly llm: ChatBedrockConverse;

  constructor() {
    const model = process.env.BEDROCK_LLM_MODEL;
    const region =
      process.env.BEDROCK_AWS_REGION ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION;

    this.llm = new ChatBedrockConverse({
      model: model ?? 'amazon.nova-lite-v1:0',
      region,
      temperature: 0,
      maxRetries: 2,
    });
  }

  get model() {
    return this.llm;
  }
}
