export class Notifier {
  async notifyAssignee(ticket: { id: number; assignee?: string }) {
    if (!ticket.assignee) return;
    await fetch('https://hooks.example.com/notify', {
      method: 'POST',
      body: JSON.stringify({ ticket: ticket.id, to: ticket.assignee }),
    });
  }
}
