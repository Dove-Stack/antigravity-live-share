import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { PeerConnection } from "node-datachannel";

export interface VoiceManagerOptions {
  getClientId: () => string | undefined;
  getPeers: () => string[];
  send: (event: Record<string, unknown>) => void;
  onVoiceStateChanged?: (active: boolean, micEnabled: boolean) => void;
}

export interface MicStartResult {
  ok: boolean;
  error?: string;
}

type PeerTransportState = "signaling" | "open" | "closed";

interface VoicePeer {
  connection: PeerConnection;
  channel?: {
    raw: { sendMessage(data: string): unknown; close(): void };
    playback?: ChildProcess;
    decoder?: {
      decode(packet: Buffer): Buffer;
    };
  };
  state: PeerTransportState;
}

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const FRAME_SAMPLES = 960;
const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2;

function hasBinary(tool: string): boolean {
  const probe = spawnSync(tool, ["-version"], { stdio: "ignore" });
  return !probe.error;
}

function detectWindowsMicDevice(): string | undefined {
  const probe = spawnSync(
    "ffmpeg",
    ["-list_devices", "true", "-f", "dshow", "-i", "dummy"],
    { encoding: "utf-8" },
  );

  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
  const lines = output.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    if (/DirectShow audio devices/.test(lines[i])) {
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
    const device = detectWindowsMicDevice();

    if (!device) {
      return undefined;
    }

    return ["-f", "dshow", "-i", `audio=${device}`];
  }

  if (platform === "darwin") {
    return ["-f", "avfoundation", "-i", ":0"];
  }

  if (platform === "linux") {
    return ["-f", "pulse", "-i", "default"];
  }

  return undefined;
}

export class VoiceManager {
  private peers = new Map<string, VoicePeer>();
  private active = false;
  private micEnabled = false;

  private encoder: { encode(pcm: Buffer, frameSize: number): Buffer } | undefined;
  private capture?: ChildProcess;
  private pcmRemainder = Buffer.alloc(0);

  constructor(private readonly options: VoiceManagerOptions) {}

  isActive(): boolean {
    return this.active;
  }

  isMicEnabled(): boolean {
    return this.micEnabled;
  }

  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;

    for (const peerId of this.options.getPeers()) {
      this.addPeer(peerId);
    }

    this.emitState();
  }

  stop(): void {
    if (!this.active && !this.micEnabled) {
      return;
    }

    this.disableMic();
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

    this.emitState();
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
      case "voice.offer":
        this.acceptOffer(from, String(payload.sdp ?? ""));
        break;
      case "voice.answer":
        this.peers.get(from)?.connection.setRemoteDescription(
          String(payload.sdp ?? ""),
          "answer",
        );
        break;
      case "voice.ice":
        this.peers
          .get(from)
          ?.connection.addRemoteCandidate(String(payload.candidate ?? ""), from);
        break;
    }
  }

  enableMic(): MicStartResult {
    if (this.micEnabled) {
      return { ok: true };
    }

    if (!hasBinary("ffmpeg") || !hasBinary("ffplay")) {
      return {
        ok: false,
        error:
          "ffmpeg/ffplay not found on PATH — install FFmpeg to capture and play voice audio.",
      };
    }

    const captureArgs = buildCaptureArgs(process.platform);

    if (!captureArgs) {
      return {
        ok: false,
        error: `Microphone capture is not supported on ${process.platform}.`,
      };
    }

    const OpusScript = require("opusscript");

    this.encoder = this.ensureEncoder();

    try {
      this.capture = spawn("ffmpeg", [
        ...captureArgs,
        "-ar",
        String(SAMPLE_RATE),
        "-ac",
        String(CHANNELS),
        "-sample_fmt",
        "s16",
        "-f",
        "s16le",
        "-",
      ]);
    } catch (error) {
      return {
        ok: false,
        error: `Could not start microphone capture: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    this.micEnabled = true;

    this.capture.stdout?.on("data", (chunk: Buffer) => {
      this.pumpPcm(Buffer.from(chunk));
    });

    this.capture.on("error", () => {
      this.disableMic();
    });

    this.emitState();

    return { ok: true };
  }

  disableMic(): void {
    this.micEnabled = false;

    if (this.capture) {
      try {
        this.capture.kill();
      } catch {
        // Process already exited.
      }
    }

    this.capture = undefined;
    this.pcmRemainder = Buffer.alloc(0);

    for (const peer of this.peers.values()) {
      this.stopPlayback(peer);
    }

    this.emitState();
  }

  private emitState(): void {
    this.options.onVoiceStateChanged?.(this.active, this.micEnabled);
  }

  private acceptOffer(from: string, sdp: string): void {
    if (!sdp) {
      return;
    }

    const peer = this.ensurePeer(from, false);

    peer.connection.setRemoteDescription(sdp, "offer");
  }

  private ensurePeer(peerId: string, initiator: boolean): VoicePeer {
    const existing = this.peers.get(peerId);

    if (existing) {
      return existing;
    }

    const connection = new PeerConnection(`voice-${peerId}`, {
      iceServers: [],
    });

    const peer: VoicePeer = { connection, state: "signaling" };

    connection.onLocalDescription((sdp: string, type: string) => {
      this.options.send({
        type: type === "offer" ? "voice.offer" : "voice.answer",
        to: peerId,
        sdp,
      });
    });

    connection.onLocalCandidate((candidate: string) => {
      this.options.send({
        type: "voice.ice",
        to: peerId,
        candidate,
      });
    });

    connection.onDataChannel((channel) => {
      this.wireChannel(peerId, peer, channel);
    });

    if (initiator) {
      const channel = connection.createDataChannel("voice");
      this.wireChannel(peerId, peer, channel);
    }

    this.peers.set(peerId, peer);

    return peer;
  }

  private wireChannel(
    peerId: string,
    peer: VoicePeer,
    channel: {
      onOpen(cb: () => void): unknown;
      onMessage(cb: (data: unknown) => void): unknown;
      onClosed(cb: () => void): unknown;
      sendMessage(data: string): unknown;
      close(): void;
    },
  ): void {
    peer.channel = {
      raw: channel,
    };

    channel.onOpen(() => {
      peer.state = "open";
    });

    channel.onClosed(() => {
      peer.state = "closed";
      this.stopPlayback(peer);
    });

    channel.onMessage((data) => {
      const packet =
        typeof data === "string"
          ? Buffer.from(data, "base64")
          : Buffer.from(data as ArrayBuffer);

      this.playPacket(peer, packet);
    });
  }

  private ensureEncoder(): { encode(pcm: Buffer, frameSize: number): Buffer } {
    if (!this.encoder) {
      const OpusScript = require("opusscript");

      this.encoder = new OpusScript(
        SAMPLE_RATE,
        CHANNELS,
        OpusScript.Application.VOIP,
      ) as { encode(pcm: Buffer, frameSize: number): Buffer };
    }

    return this.encoder;
  }

  private pumpPcm(chunk: Buffer): void {
    const combined = Buffer.concat([this.pcmRemainder, chunk]);

    for (
      let offset = 0;
      offset + FRAME_BYTES <= combined.length;
      offset += FRAME_BYTES
    ) {
      const frame = combined.subarray(offset, offset + FRAME_BYTES);
      const encoded = this.ensureEncoder().encode(Buffer.from(frame), FRAME_SAMPLES);

      if (!encoded || encoded.length === 0) {
        continue;
      }
      this.broadcast(encoded.toString("base64"));
    }

    this.pcmRemainder = Buffer.from(
      combined.subarray(combined.length - (combined.length % FRAME_BYTES)),
    );
  }

  private broadcast(packetB64: string): void {
    for (const peer of this.peers.values()) {
      if (peer.state === "open" && peer.channel) {
        try {
          peer.channel.raw.sendMessage(packetB64);
        } catch {
          // A dropped frame beats a dropped session.
        }
      }
    }
  }

  private playPacket(peer: VoicePeer, packet: Buffer): void {
    const OpusScript = require("opusscript");

    if (!peer.channel) {
      return;
    }

    peer.channel.decoder = new OpusScript(
      SAMPLE_RATE,
      CHANNELS,
      OpusScript.Application.VOIP,
    ) as { decode(packet: Buffer): Buffer };

    const decoder = peer.channel.decoder;

    let pcm: Buffer;

    try {
      pcm = decoder.decode(packet);
    } catch {
      return;
    }

    if (!pcm || pcm.length === 0) {
      return;
    }

    if (!peer.channel.playback || peer.channel.playback.exitCode !== null) {
      peer.channel.playback = spawn("ffplay", [
        "-autoexit",
        "-nodisp",
        "-loglevel",
        "quiet",
        "-f",
        "s16le",
        "-ar",
        String(SAMPLE_RATE),
        "-ac",
        String(CHANNELS),
        "-i",
        "-",
      ]);

      peer.channel.playback.stdin?.on("error", () => {
        // Receiver closed the pipe; drop audio silently.
      });
    }

    try {
      peer.channel.playback.stdin?.write(pcm);
    } catch {
      // Pipe backpressure or teardown — skip this frame.
    }
  }

  private stopPlayback(peer: VoicePeer): void {
    const playback = peer.channel?.playback;

    if (playback && playback.exitCode === null) {
      try {
        playback.kill();
      } catch {
        // Already gone.
      }
    }

    if (peer.channel) {
      peer.channel.playback = undefined;
    }
  }

  private closeChannel(peer: VoicePeer): void {
    this.stopPlayback(peer);

    if (peer.channel) {
      try {
        peer.channel.raw.close();
      } catch {
        // Channel may already be closed.
      }
    }
  }
}
