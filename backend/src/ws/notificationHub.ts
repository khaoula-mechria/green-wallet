import type { WebSocket } from "ws";

export interface NotificationMessage {
  type: string;
  data: unknown;
  timestamp: number;
}

/** Simple in-memory pub/sub for pushing real-time events (new trades,
 * completed purchases) to connected household clients over WebSocket.
 * Not persisted — a reconnecting client re-syncs via the REST API. */
export class NotificationHub {
  private readonly subscribers = new Map<string, Set<WebSocket>>();

  subscribe(householdId: string, socket: WebSocket): void {
    if (!this.subscribers.has(householdId)) this.subscribers.set(householdId, new Set());
    this.subscribers.get(householdId)!.add(socket);
    socket.on("close", () => this.subscribers.get(householdId)?.delete(socket));
  }

  notify(householdId: string, type: string, data: unknown): void {
    const sockets = this.subscribers.get(householdId);
    if (!sockets) return;
    const message: NotificationMessage = { type, data, timestamp: Date.now() };
    const payload = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
}
