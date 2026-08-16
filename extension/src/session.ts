// import { randomBytes } from "crypto";

import { randomBytes } from "node:crypto";

export type SessionRole = "host" | "guest";

export interface LiveShareSession {
  id: string;
  createdAt: number;
  role: SessionRole;
}

export class SessionManager {
  private session: LiveShareSession | undefined;

  startSession(): LiveShareSession {
    const id = randomBytes(6).toString("hex").toUpperCase();

    this.session = {
      id,
      createdAt: Date.now(),
      role: "host",
    };

    return this.session;
  }

  joinSession(id: string): LiveShareSession {
    const normalized = id.trim().toUpperCase();

    if (!normalized) {
      throw new Error("Session ID cannot be empty.");
    }

    this.session = {
      id: normalized,
      createdAt: Date.now(),
      role: "guest",
    };

    return this.session;
  }

  getSession(): LiveShareSession | undefined {
    return this.session;
  }

  stopSession(): void {
    this.session = undefined;
  }

  private generateSessionId(): string {
    return randomBytes(6).toString("hex").toUpperCase();
  }
}
