import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { PeerConnection } from "node-datachannel";

export interface VideoManagerOptions {
  getClientId: () => string | undefined;
  getPeers: () => string[];
  send: (event: Record<string, unknown>) => void;
  onFrame?: (peerId: string, jpeg: Buffer) => void;
  onVideoStateChanged?: (active: boolean) => void;
}

export interface CameraStartResult {
  ok: boolean;
  error?: string;
}

type PeerTransportState = "signaling" | "open" | "closed";

const FRAME_WIDTH = 640;
const FPS = 10;

interface IncomingFrame {
  total: number;
  chunks: Map<number, string>;
}

interface VideoPeer {
  connection: PeerConnection;
  channel?: {
    raw: { sendMessage(data: string): unknown; close(): void };
  };
  incoming: Map<number, IncomingFrame>;
  nextFrameId: number;
  state: PeerTransportState;
}

function hasBinary(tool: string): boolean {
  const probe = spawnSync(tool, ["-version"], { stdio: "ignore" });
  return !probe.error;
}

function detectWindowsCameraDevice(): string | undefined {
  const probe = spawnSync(
    "ffmpeg",
    ["-list_devices", "true", "-f", "dshow", "-i", "dummy"],
    { encoding: "utf-8" },
  );

  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
  const lines = output.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    if (/DirectShow video devices/.test(lines[i])) {
      const match = /"([^"]+)"/.exec(lines[i + 1] ?? "");

      if (match) {
        return match[1];
      }
    }
  }

  return undefined;
}

function buildCaptureArgs(platform: NodeJS.Platform): string[] | undefined {
  if (platform === "win32") {
    const device = detectWindowsCameraDevice();

    if (!device) {
      return undefined;
    }

    return ["-f", "dshow", "-i", `video=${device}`];
  }

  if (platform === "darwin") {
    return ["-f", "avfoundation", "-i", "0"];
  }

  if (platform === "linux") {
    return ["-f", "v4l2", "-i", "/dev/video0"];
  }

  return undefined;
}

export class VideoManager {
  private peers = new Map<string, VideoPeer>();
  private active = false;
  private camera?: ChildProcess;
  private streamRemainder = Buffer.alloc(0);

  constructor(private readonly options: VideoManagerOptions) {}

  isActive(): boolean {
    return this.active;
  }

  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;

    for (const peerId of this.options.getPeers()) {
      this.addPeer(peerId);
    }

    this.options.onVideoStateChanged?.(true);
  }

  stop(): void {
    if (!this.active) {
      return;
    }

    this.stopCamera();
    this.active = false;

    for (const [peerId, peer] of this.peers) {
      try {
        peer.connection.close();
      } catch {
        // Closing a dead connection is harmless.
      }

      this.closeChannel(peer);
      this.peers.delete(peerId);
    }

    this.options.onVideoStateChanged?.(false);
  }

  addPeer(peerId: string): void {
    const myId = this.options.getClientId();

    if (!this.active || !myId || peerId === myId || this.peers.has(peerId)) {
      return;
    }

    this.ensurePeer(peerId, myId < peerId);
  }

  removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);

    if (!peer) {
      return;
    }

    try {
      peer.connection.close();
    } catch {
      // Already gone.
    }

    this.closeChannel(peer);
    this.peers.delete(peerId);
  }

  handleRelay(from: string, payload: Record<string, unknown>): void {
    if (!this.active) {
      return;
    }

    const myId = this.options.getClientId();
    const to = typeof payload.to === "string" ? payload.to : "";

    if (!myId || to !== myId || from === myId) {
      return;
    }

    const type = String(payload.type ?? "");

    switch (type) {
      case "video.offer":
        this.acceptOffer(from, String(payload.sdp ?? ""));
        break;
      case "video.answer":
        this.peers.get(from)?.connection.setRemoteDescription(
          String(payload.sdp ?? ""),
          "answer",
        );
        break;
      case "video.ice":
        this.peers
          .get(from)
          ?.connection.addRemoteCandidate(String(payload.candidate ?? ""), from);
        break;
    }
  }

  enableCamera(): CameraStartResult {
    if (this.camera) {
      return { ok: true };
    }

    if (!hasBinary("ffmpeg")) {
      return {
        ok: false,
        error: "ffmpeg not found on PATH — install FFmpeg to share your camera.",
      };
    }

    const captureArgs = buildCaptureArgs(process.platform);

    if (!captureArgs) {
      return {
        ok: false,
        error: `Camera capture is not supported on ${process.platform}.`,
      };
    }

    try {
      this.camera = spawn("ffmpeg", [
        ...captureArgs,
        "-vf",
        `scale=${FRAME_WIDTH}:-2`,
        "-r",
        String(FPS),
        "-q:v",
        "7",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-",
      ]);
    } catch (error) {
      return {
        ok: false,
        error: `Could not start camera capture: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    this.camera.stdout?.on("data", (chunk: Buffer) => {
      this.pumpStream(Buffer.from(chunk));
    });

    this.camera.on("error", () => {
      this.stopCamera();
    });

    return { ok: true };
  }

  stopCamera(): void {
    if (this.camera) {
      try {
        this.camera.kill();
      } catch {
        // Process already exited.
      }
    }

    this.camera = undefined;
    this.streamRemainder = Buffer.alloc(0);
  }

  private acceptOffer(from: string, sdp: string): void {
    if (!sdp) {
      return;
    }

    const peer = this.ensurePeer(from, false);

    peer.connection.setRemoteDescription(sdp, "offer");
  }

  private ensurePeer(peerId: string, initiator: boolean): VideoPeer {
    const existing = this.peers.get(peerId);

    if (existing) {
      return existing;
    }

    const connection = new PeerConnection(`video-${peerId}`, {
      iceServers: [],
    });

    const peer: VideoPeer = {
      connection,
      incoming: new Map(),
      nextFrameId: 0,
      state: "signaling",
    };

    connection.onLocalDescription((sdp: string, type: string) => {
      this.options.send({
        type: type === "offer" ? "video.offer" : "video.answer",
        to: peerId,
        sdp,
      });
    });

    connection.onLocalCandidate((candidate: string) => {
      this.options.send({
        type: "video.ice",
        to: peerId,
        candidate,
      });
    });

    connection.onDataChannel((channel) => {
      this.wireChannel(peerId, peer, channel);
    });

    if (initiator) {
      const channel = connection.createDataChannel("video");
      this.wireChannel(peerId, peer, channel);
    }

    this.peers.set(peerId, peer);

    return peer;
  }

  private wireChannel(
    peerId: string,
    peer: VideoPeer,
    channel: {
      onOpen(cb: () => void): unknown;
      onMessage(cb: (data: unknown) => void): unknown;
      onClosed(cb: () => void): unknown;
      sendMessage(data: string): unknown;
      close(): void;
    },
  ): void {
    peer.channel = { raw: channel };

    channel.onOpen(() => {
      peer.state = "open";
    });

    channel.onClosed(() => {
      peer.state = "closed";
    });

    channel.onMessage((data) => {
      const text =
        typeof data === "string"
          ? data
          : Buffer.from(data as ArrayBuffer).toString("utf-8");

      this.acceptChunk(peerId, peer, text);
    });
  }

  private pumpStream(chunk: Buffer): void {
    let combined = Buffer.concat([this.streamRemainder, chunk]);

    let start = combined.indexOf(Buffer.from([0xff, 0xd8]));

    while (start !== -1) {
      const end = combined.indexOf(
        Buffer.from([0xff, 0xd9]),
        start + 2,
      );

      if (end === -1) {
        break;
      }

      const jpeg = combined.subarray(start, end + 2);

      this.broadcastFrame(Buffer.from(jpeg));

      combined = combined.subarray(end + 2);
      start = combined.indexOf(Buffer.from([0xff, 0xd8]));
    }

    this.streamRemainder = Buffer.from(combined);
  }

  private broadcastFrame(jpeg: Buffer): void {
    const payload = jpeg.toString("base64");
    const CHUNK_SIZE = 16 * 1024;
    const total = Math.max(1, Math.ceil(payload.length / CHUNK_SIZE));

    for (const peer of this.peers.values()) {
      if (peer.state !== "open" || !peer.channel) {
        continue;
      }

      const frameId = peer.nextFrameId;
      peer.nextFrameId = (peer.nextFrameId + 1) % 0xffff;

      for (let index = 0; index < total; index += 1) {
        const chunkPayload = {
          i: frameId,
          n: index,
          t: total,
          d: payload.substr(index * CHUNK_SIZE, CHUNK_SIZE),
        };

        try {
          peer.channel.raw.sendMessage(JSON.stringify(chunkPayload));
        } catch {
          // A dropped chunk loses one frame, not the session.
          break;
        }
      }
    }
  }

  private acceptChunk(
    peerId: string,
    peer: VideoPeer,
    text: string,
  ): void {
    let parsed: { i: number; n: number; t: number; d: string };

    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    if (
      typeof parsed?.i !== "number" ||
      typeof parsed?.n !== "number" ||
      typeof parsed?.t !== "number" ||
      typeof parsed?.d !== "string"
    ) {
      return;
    }

    let frame = peer.incoming.get(parsed.i);

    if (!frame) {
      frame = { total: parsed.t, chunks: new Map() };
      peer.incoming.set(parsed.i, frame);
    }

    frame.chunks.set(parsed.n, parsed.d);

    if (frame.chunks.size < frame.total) {
      return;
    }

    const payload = Array.from({ length: frame.total }, (_, index) =>
      frame!.chunks.get(index) ?? "",
    ).join("");

    peer.incoming.delete(parsed.i);

    for (const staleId of peer.incoming.keys()) {
      if (staleId < parsed.i - 8) {
        peer.incoming.delete(staleId);
      }
    }

    try {
      const jpeg = Buffer.from(payload, "base64");

      if (jpeg.length > 4) {
        this.options.onFrame?.(peerId, jpeg);
      }
    } catch {
      // Corrupt assembly — drop the frame.
    }
  }

  private closeChannel(peer: VideoPeer): void {
    if (peer.channel) {
      try {
        peer.channel.raw.close();
      } catch {
        // Channel may already be closed.
      }
    }
  }
}
