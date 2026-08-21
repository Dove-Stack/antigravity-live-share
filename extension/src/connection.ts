import WebSocket from "ws";

export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

export interface ConnectionOptions {
  serverUrl: string;
  sessionId: string;
  onEvent: (event: ServerEvent) => void;
  onClosed: (code: number, reason: string) => void;
}

const RECONNECT_DELAY_MS = 3000;
const FATAL_CLOSE_CODES = new Set([1000, 1008]);

export async function createRoom(serverUrl: string): Promise<string> {
  const base = serverUrl.replace(/\/+$/, "");

  const response = await fetch(`${base}/rooms`, { method: "POST" });

  if (!response.ok) {
    throw new Error(`Server responded with ${response.status}`);
  }

  const body = (await response.json()) as { id?: string };

  if (!body.id) {
    throw new Error("Server response did not include a room ID.");
  }

  return body.id;
}

export class LiveShareConnection {
  private socket: WebSocket | undefined;
  private stopped = true;

  constructor(private readonly options: ConnectionOptions) {}

  open(): Promise<void> {
    this.stopped = false;

    return this.connect();
  }

  send(event: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
    }
  }

  close(): void {
    this.stopped = true;
    this.socket?.close(1000);
    this.socket = undefined;
  }

  private connect(): Promise<void> {
    const { serverUrl, sessionId, onEvent, onClosed } = this.options;

    return new Promise((resolve, reject) => {
      const base = serverUrl.replace(/\/+$/, "");
      const wsUrl = `${base.replace(/^http/, "ws")}/?room=${encodeURIComponent(sessionId)}`;
      const socket = new WebSocket(wsUrl);
      let settled = false;

      socket.on("open", () => {
        settled = true;
        this.socket = socket;
        resolve();
      });

      socket.on("message", (data) => {
        try {
          onEvent(JSON.parse(data.toString("utf-8")));
        } catch {
          // Malformed frames are ignored; the server validates payloads.
        }
      });

      socket.on("close", (code, reason) => {
        this.socket = undefined;
        const detail = reason.toString();

        if (!settled) {
          settled = true;
          reject(new Error(detail || `Connection closed (code ${code}).`));
          return;
        }

        if (this.stopped || FATAL_CLOSE_CODES.has(code)) {
          onClosed(code, detail);
          return;
        }

        setTimeout(() => {
          if (!this.stopped) {
            this.connect().catch(() => {});
          }
        }, RECONNECT_DELAY_MS);
      });

      socket.on("error", (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });
  }
}
