import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

interface Client {
  id: string;
  socket: WebSocket;
}

interface Room {
  id: string;
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
    clients: new Map(),
    createdAt: Date.now(),
  };

  rooms.set(room.id, room);

  return room;
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

  if (!roomId) {
    socket.close(1008, "Room ID is required.");
    return;
  }

  const room = rooms.get(roomId);

  if (!room) {
    socket.close(1008, "Room does not exist.");
    return;
  }

  const clientId = generateId(4);
  const client: Client = { id: clientId, socket };

  room.clients.set(client.id, client);

  console.log(`Client ${client.id} joined room ${room.id}`);

  socket.send(
    JSON.stringify({
      type: "connected",
      clientId: client.id,
      roomId: room.id,
    }),
  );

  for (const other of room.clients.values()) {
    if (other.id === client.id) {
      continue;
    }

    if (other.socket.readyState === WebSocket.OPEN) {
      other.socket.send(
        JSON.stringify({
          type: "peer.joined",
          clientId: client.id,
          roomId: room.id,
        }),
      );
    }
  }

  socket.on("message", (data) => {
    let payload: unknown;

    try {
      payload = JSON.parse(data.toString("utf-8"));
    } catch {
      socket.send(
        JSON.stringify({
          type: "error",
          message: "Invalid JSON message.",
        }),
      );
      return;
    }

    const message = JSON.stringify(payload);

    for (const other of room.clients.values()) {
      if (other.id !== clientId && other.socket.readyState === WebSocket.OPEN) {
        other.socket.send(
          JSON.stringify({
            type: "message",
            from: client.id,
            data: message,
          }),
        );
      }
    }
  });

  socket.on("close", () => {
    room.clients.delete(client.id);

    console.log(`Client ${client.id} left room ${room.id}`);

    for (const other of room.clients.values()) {
      if (other.socket.readyState === WebSocket.OPEN) {
        other.socket.send(
          JSON.stringify({
            type: "peer.left",
            clientId: client.id,
          }),
        );
      }
    }

    if (room.clients.size === 0) {
      rooms.delete(room.id);

      console.log(`Room ${room.id} removed`);
    }
  });
});

const PORT = Number(process.env.PORT ?? 3000);

httpServer.listen(PORT, () => {
  console.log(`Live Share server listening on http://localhost:${PORT}`);
});
