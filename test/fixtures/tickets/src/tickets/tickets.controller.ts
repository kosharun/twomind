import { Body, Controller, Param, Patch } from '@nestjs/common';
import { TicketService, type Status } from './ticket.service';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketService) {}

  @Patch(':id/status')
  changeStatus(@Param('id') id: string, @Body() body: { status: Status }) {
    return this.tickets.changeStatus(Number(id), body.status);
  }
}
