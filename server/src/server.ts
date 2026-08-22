import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

type AccessRole = "editor" | "readonly";

interface Client {
  id: string;
  socket: WebSocket;
  access: AccessRole | "pending";
}

interface Room {
  id: string;
  token: string;
  hostClientId: string | undefined;
  clients: Map<string, Client>;
  createdAt: number;
}

const rooms = new Map<string, Room>();

function generateId(bytes = 6): string {
  return randomBytes(bytes).toString("hex").toUpperCase();
}

function createRoom(): Room {
  const room: Room = {
    id: generateId(),
    token: generateId(16),
    hostClientId: undefined,
    clients: new Map(),
    createdAt: Date.now(),
  };

  rooms.set(room.id, room);

  return room;
}

function sendTo(client: Client, payload: Record<string, unknown>): void {
  if (client.socket.readyState === WebSocket.OPEN) {
    client.socket.send(JSON.stringify(payload));
  }
}

function broadcast(
  room: Room,
  payload: Record<string, unknown>,
  exceptId?: string,
): void {
  for (const client of room.clients.values()) {
    if (client.id !== exceptId && client.access !== "pending") {
      sendTo(client, payload);
    }
  }
}

function promoteFirstTrusted(room: Room): void {
  let fallback: Client | undefined;

  for (const client of room.clients.values()) {
    if (client.access === "editor") {
      room.hostClientId = client.id;
      return;
    }

    if (client.access !== "pending" && !fallback) {
      fallback = client;
    }
  }

  room.hostClientId = fallback?.id;
}

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        status: "ok",
        rooms: rooms.size,
      }),
    );

    return;
  }

  if (req.method === "POST" && req.url === "/rooms") {
    const room = createRoom();

    res.writeHead(201, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        id: room.id,
        token: room.token,
        createdAt: room.createdAt,
      }),
    );

    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

const websocketServer = new WebSocketServer({
  server: httpServer,
});

websocketServer.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", "http://localhost");

  const roomId = url.searchParams.get("room");
  const token = url.searchParams.get("token");

  if (!roomId) {
    socket.close(1008, "Room ID is required.");
    return;
  }

  const room = rooms.get(roomId);

  if (!room) {
    socket.close(1008, "Room does not exist.");
    return;
  }

  const trusted = typeof token === "string" && token === room.token;

  if (!trusted && !room.hostClientId) {
    socket.close(1008, "Room has no host to grant approval.");
    return;
  }

  const clientId = generateId(4);

  const client: Client = {
    id: clientId,
    socket,
    access: trusted ? "editor" : "pending",
  };

  room.clients.set(client.id, client);

  let isHost = false;

  if (trusted && !room.hostClientId) {
    room.hostClientId = client.id;
    isHost = true;
  }

  console.log(
    `Client ${client.id} reached room ${room.id} as ${client.access}`,
  );

  sendTo(client, {
    type: "connected",
    clientId: client.id,
    roomId: room.id,
    status: client.access === "pending" ? "pending" : "approved",
    role: client.access === "pending" ? undefined : client.access,
    isHost,
  });

  if (client.access !== "pending") {
    broadcast(room, {
      type: "peer.joined",
      clientId: client.id,
      roomId: room.id,
    }, client.id);
  } else {
    const host = room.clients.get(room.hostClientId ?? "");

    if (host) {
      sendTo(host, {
        type: "peer.request",
        clientId: client.id,
        roomId: room.id,
      });
    }
  }

  socket.on("message", (data) => {
    // Pending members cannot speak until approved.
    if (client.access === "pending") {
      return;
    }

    let parsed: { type?: unknown };

    try {
      parsed = JSON.parse(data.toString("utf-8"));
    } catch {
      sendTo(client, {
        type: "error",
        message: "Invalid JSON message.",
      });
      return;
    }

    const messageType =
      typeof parsed?.type === "string" ? parsed.type : undefined;

    if (messageType === "session.control") {
      handleControl(room, client, parsed as Record<string, unknown>);
      return;
    }

    if (
      client.access === "readonly" &&
      messageType &&
      messageType.startsWith("doc.")
    ) {
      // Read-only members cannot mutate shared documents.
      return;
    }

    broadcast(room, {
      type: "message",
      from: client.id,
      data: data.toString("utf-8"),
    }, client.id);
  });

  socket.on("close", () => {
    room.clients.delete(client.id);

    console.log(`Client ${client.id} left room ${room.id}`);

    if (client.access !== "pending") {
      broadcast(room, {
        type: "peer.left",
        clientId: client.id,
      });
    }

    if (room.hostClientId === client.id) {
      room.hostClientId = undefined;
      promoteFirstTrusted(room);

      const successor = room.clients.get(room.hostClientId ?? "");

      if (successor) {
        console.log(`Host moved to ${successor.id} in room ${room.id}`);
        sendTo(successor, { type: "session.host" });
        broadcast(room, {
          type: "peer.host",
          clientId: successor.id,
        }, successor.id);
      }
    }

    if (room.clients.size === 0) {
      rooms.delete(room.id);

      console.log(`Room ${room.id} removed`);
    }
  });
});

function handleControl(
  room: Room,
  sender: Client,
  payload: Record<string, unknown>,
): void {
  if (room.hostClientId !== sender.id) {
    return;
  }

  const action = String(payload.action ?? "");
  const target = room.clients.get(String(payload.target ?? ""));

  switch (action) {
    case "approve":
      if (target && target.access === "pending") {
        target.access = "editor";
        sendTo(target, { type: "session.approved", role: target.access });
        broadcast(room, {
          type: "peer.joined",
          clientId: target.id,
          roomId: room.id,
        }, target.id);
        console.log(`Client ${target.id} approved in room ${room.id}`);
      }
      break;

    case "deny":
      if (target && target.access === "pending") {
        console.log(`Client ${target.id} denied in room ${room.id}`);
        target.socket.close(1008, "Denied by host.");
      }
      break;

    case "role": {
      const role = String(payload.role ?? "");

      if (
        target &&
        target.access !== "pending" &&
        (role === "editor" || role === "readonly")
      ) {
        target.access = role;
        sendTo(target, { type: "session.role", role });
        broadcast(room, {
          type: "peer.role",
          clientId: target.id,
          role,
        }, target.id);
        console.log(`Client ${target.id} set to ${role} in room ${room.id}`);
      }
      break;
    }
  }
}

const PORT = Number(process.env.PORT ?? 3000);

httpServer.listen(PORT, () => {
  console.log(`Live Share server listening on http://localhost:${PORT}`);
});
