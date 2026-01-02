import { Injectable } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

@Injectable()
export class BedrockService {
  private client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

  async embed(text: string): Promise<number[]> {
    const cmd = new InvokeModelCommand({
      modelId:
        process.env.BEDROCK_EMBED_MODEL || 'amazon.titan-embed-text-v2:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ inputText: text }),
    });

    const res = await this.client.send(cmd);
    const body = JSON.parse(new TextDecoder().decode(res.body));
    return body.embedding;
  }

  async nova(prompt: string): Promise<string> {
    const cmd = new InvokeModelCommand({
      modelId: process.env.BEDROCK_LLM_MODEL || 'amazon.nova-lite-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [{ text: prompt }], // ✅ IMPORTANT: array, not string
          },
        ],
      }),
    });

    const res = await this.client.send(cmd);
    const body = JSON.parse(new TextDecoder().decode(res.body));

    // Nova commonly returns output.message.content as an array of blocks
    const text =
      body?.output?.message?.content
        ?.map((b: any) => b?.text)
        .filter(Boolean)
        .join('') ??
      body?.message?.content
        ?.map((b: any) => b?.text)
        .filter(Boolean)
        .join('') ??
      body?.outputText;

    if (!text) {
      throw new Error(
        'Unexpected Nova response: ' + JSON.stringify(body).slice(0, 800),
      );
    }
    return text;
  }
}
