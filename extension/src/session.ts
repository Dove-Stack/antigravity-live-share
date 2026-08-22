export type SessionRole = "host" | "guest";

export interface LiveShareSession {
  id: string;
  createdAt: number;
  role: SessionRole;
  token?: string;
}

export class SessionManager {
  private session: LiveShareSession | undefined;

  startSession(id: string, token: string): LiveShareSession {
    this.session = {
      id,
      createdAt: Date.now(),
      role: "host",
      token,
    };

    return this.session;
  }

  joinSession(id: string, token?: string): LiveShareSession {
    const normalized = id.trim().toUpperCase();

    if (!normalized) {
      throw new Error("Session ID cannot be empty.");
    }

    this.session = {
      id: normalized,
      createdAt: Date.now(),
      role: "guest",
      token,
    };

    return this.session;
  }

  getSession(): LiveShareSession | undefined {
    return this.session;
  }

  stopSession(): void {
    this.session = undefined;
  }
}
