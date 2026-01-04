import { Body, Controller, Post } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  async ask(@Body() body: { message: string }) {
    return this.chat.ask(body.message);
  }
}
