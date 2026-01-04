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
    'Check whether our system contains a product with the following specifications: Primary Voltage: 11 kV, Secondary Voltage: IEC 60076 compliant, Insulation Class: 220',
    'Customer looking for a Transformer of Primary Voltage around 30KV and Secondary Voltage around 10KV. Do we have any similar product to this?',
    'Can you provide me with the details of a Product named TX-3150-33/11-ONAN Power Transformer?',
    'Look up for product with code: PE: TX-3151-55/12',
    'Do we have a product with code PE: TX-3150-33/11-ONAN in our system?',
    'Look up for product with code: PE: TX-3151-55/12',
    'Customer has issue with cracked walls and algae. Do we any product that can help with her issues?',
    'Customer has issue with cracked walls and algae. Do we any product that can help with her issues?',
    'List all the Control Panel products',
    'Today a customer came up. She only had a barcode which was 57458. She wanted our help to know if this is a product we had sold to her. Can you check?',
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
