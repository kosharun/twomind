import type { TicketRepository } from './ticket.repository';
import { Notifier } from '../notify/notifier';
import { EventBus } from '@nestjs/cqrs';
import { TicketNotFoundError } from './errors';

export type Status = 'TODO' | 'IN_PROGRESS' | 'DONE';

export class TicketService {
  constructor(
    private readonly repo: TicketRepository,
    private readonly notifier: Notifier,
    private readonly events: EventBus,
  ) {}

  async changeStatus(ticketId: number, status: Status) {
    const ticket = await this.validateTicket(ticketId);

    switch (status) {
      case 'TODO':
        ticket.startedAt = null;
        break;
      case 'IN_PROGRESS':
        ticket.startedAt = new Date();
        await this.notifier.notifyAssignee(ticket);
        break;
      case 'DONE':
        ticket.closedAt = new Date();
        this.events.publish({ type: 'ticket.done', id: ticket.id });
        break;
    }

    ticket.status = status;
    return this.repo.save(ticket);
  }

  private async validateTicket(id: number) {
    const ticket = await this.repo.findById(id);
    if (!ticket) {
      throw new TicketNotFoundError('Ticket does not exist');
    }
    return ticket;
  }
}
