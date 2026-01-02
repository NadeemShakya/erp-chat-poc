import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ChatService } from 'chat/chat.service';

@Controller('eval')
export class EvalController {
  constructor(private readonly chat: ChatService) {}

  private ensureDev() {
    if (String(process.env.DEV_MODE ?? 'false').toLowerCase() !== 'true') {
      throw new ServiceUnavailableException('DEV_MODE is off.');
    }
  }

  private readonly questions = [
    'How many transformers are 500 kVA?',
    'How many products have cooling type ONAN?',
    'Have we built a transformer product with Radiator from Hyundai?',
    'How long does it normally take for us to build a transformer with 1000kVA?',
    'List low-voltage transformers in inventory',
    'How many quotations are pending currently?',
    'What assets do we have?',
    'How many customers do we have and with whom have we done the most deals?',
    'List low-voltage transformers in inventory',
    'Show me the BOM for Product XYZ',
  ];

  @Get()
  async run() {
    this.ensureDev();

    const results = [];
    let groundedTrue = 0;
    let lowConfidence = 0;

    for (const q of this.questions) {
      const out = await this.chat.ask(q);
      if (out.grounded) groundedTrue++;
      if ((out.confidence ?? 0) < 0.5) lowConfidence++;

      results.push({
        question: q,
        grounded: out.grounded,
        confidence: out.confidence,
        missing_data: out.missing_data ?? [],
        answer: out.answer,
      });
    }

    return {
      total: this.questions.length,
      grounded_true: groundedTrue,
      low_confidence: lowConfidence,
      results,
    };
  }
}
