const WebSocket = require("ws");
const results = [];
const check = (name, cond) => {
  results.push([name, !!cond]);
  console.log((cond ? "  ok " : "FAIL ") + name);
};

const connect = (room, token) =>
  new Promise((resolve) => {
    const url = `ws://localhost:3000/?room=${room}` + (token ? `&token=${token}` : "");
    const ws = new WebSocket(url);
    const inbox = [];
    ws.on("message", (d) => inbox.push(JSON.parse(d.toString())));
    ws.on("open", () => resolve({ ws, inbox }));
    ws.on("close", (code, reason) => inbox.push({ type: "__closed", code, reason: reason.toString() }));
  });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (inbox, type) => [...inbox].reverse().find((m) => m.type === type);

(async () => {
  const created = await (await fetch("http://localhost:3000/rooms", { method: "POST" })).json();
  check("room created with token", created.id && created.token);

  const host = await connect(created.id, created.token);
  await wait(200);
  const hConn = last(host.inbox, "connected");
  check("host approved with isHost", hConn && hConn.status === "approved" && hConn.isHost === true);

  // GuestA: no token → pending, host sees request
  const a = await connect(created.id, null);
  await wait(200);
  check("guestA pending", last(a.inbox, "connected")?.status === "pending");
  check("host got peer.request", last(host.inbox, "peer.request")?.clientId === last(a.inbox, "connected").clientId);

  // Pending guest speaks → host must NOT hear it
  a.ws.send(JSON.stringify({ type: "doc.update", path: "x", update: "zz" }));
  await wait(200);
  check("pending messages dropped", !host.inbox.some((m) => m.type === "message"));

  // Approve A
  host.ws.send(JSON.stringify({ type: "session.control", action: "approve", target: hConn ? last(a.inbox, "connected").clientId : "" }));
  await wait(200);
  check("guestA approved", last(a.inbox, "session.approved")?.role === "editor");
  check("peer.joined broadcast for A", last(host.inbox, "peer.joined")?.clientId === last(a.inbox, "connected").clientId);

  // A as editor: doc.update relays to host
  a.ws.send(JSON.stringify({ type: "doc.update", path: "x.ts", update: "abc" }));
  await wait(200);
  check("editor doc.update relayed", host.inbox.some((m) => m.type === "message"));

  // Demote A to readonly → doc.update now dropped server-side
  host.ws.send(JSON.stringify({ type: "session.control", action: "role", target: last(a.inbox, "connected").clientId, role: "readonly" }));
  await wait(200);
  check("guestA set readonly", last(a.inbox, "session.role")?.role === "readonly");
  const before = host.inbox.filter((m) => m.type === "message").length;
  a.ws.send(JSON.stringify({ type: "doc.update", path: "x.ts", update: "nope" }));
  await wait(200);
  check("readonly doc.update dropped", host.inbox.filter((m) => m.type === "message").length === before);

  // GuestB with valid token → instant approved fast path
  const b = await connect(created.id, created.token);
  await wait(200);
  check("token guest fast-approved", last(b.inbox, "connected")?.status === "approved");

  // GuestC denied by host
  const c = await connect(created.id, null);
  await wait(200);
  const cId = last(c.inbox, "connected").clientId;
  host.ws.send(JSON.stringify({ type: "session.control", action: "deny", target: cId }));
  await wait(200);
  const closed = c.inbox.find((m) => m.type === "__closed");
  check("denied guest closed 1008", closed && closed.code === 1008);

  // Host leaves → hostship transfers to B
  host.ws.close();
  await wait(300);
  check("hostship transferred to B", last(b.inbox, "session.host")?.type === "session.host");

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  [a, b, c].forEach((p) => p.ws.close());
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
