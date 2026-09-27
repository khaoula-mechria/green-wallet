import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { WebSocketServer } from "ws";
import { verifyToken } from "../middleware/auth.js";
import type { NotificationHub } from "./notificationHub.js";

export const WS_PATH = "/ws";

function reject(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * Authenticated notification socket: `ws://<host>/ws?token=<jwt>`.
 * The JWT is verified during the HTTP upgrade — before any connection is
 * accepted — and the subscription is always for the token's own household,
 * so one household can never listen to another's trade notifications.
 * (Browsers can't set headers on a WebSocket, hence the query parameter;
 * keep access logs from recording query strings on this path.)
 */
export function attachWebSocketServer(httpServer: Server, hub: NotificationHub): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", "http://localhost");
    if (url.pathname !== WS_PATH) return reject(socket, "404 Not Found");

    const auth = verifyToken(url.searchParams.get("token"));
    if (!auth) return reject(socket, "401 Unauthorized");

    wss.handleUpgrade(request, socket, head, (ws) => {
      hub.subscribe(auth.householdId, ws);
      wss.emit("connection", ws, request);
    });
  });

  return wss;
}
