import { Pool } from 'pg';

export interface Ticket {
  id: number;
  status: string;
  assignee?: string;
  startedAt: Date | null;
  closedAt?: Date;
}

export interface TicketRepository {
  findById(id: number): Promise<Ticket | null>;
  save(ticket: Ticket): Promise<Ticket>;
}

export class SqlTicketRepository implements TicketRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: number) {
    const result = await this.pool.query('SELECT * FROM tickets WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async save(ticket: Ticket) {
    await this.pool.query('UPDATE tickets SET status = $1 WHERE id = $2', [ticket.status, ticket.id]);
    return ticket;
  }
}
