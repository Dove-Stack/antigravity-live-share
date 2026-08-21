import * as vscode from "vscode";
import {
  ConnectionOptions,
  LiveShareConnection,
  ServerEvent,
  createRoom,
} from "./connection";
import { PresenceManager } from "./presence";
import { PanelState, PeerInfo, SessionPanel } from "./panel";
import { SessionManager } from "./session";
import { SyncManager } from "./sync";
import { VideoManager } from "./video";
import { VideoPanel } from "./videoPanel";
import { VoiceManager } from "./voice";
import { SessionStatusBar } from "./statusBar";

const sessionManager = new SessionManager();
const statusBar = new SessionStatusBar();
const peerNames = new Map<string, string>();

let connection: LiveShareConnection | undefined;
let presence: PresenceManager | undefined;
let sync: SyncManager | undefined;
let voice: VoiceManager | undefined;
let video: VideoManager | undefined;
let videoPanel: VideoPanel | undefined;
let myClientId: string | undefined;

const panel = new SessionPanel({
  onCopy: () => {
    const session = sessionManager.getSession();

    if (session) {
      void vscode.env.clipboard.writeText(session.id);
      vscode.window.showInformationMessage(
        `Session ${session.id} copied to clipboard.`,
      );
    }
  },
  onLeave: () => {
    vscode.commands.executeCommand("liveShare.stopSession");
  },
});

function currentState(): PanelState | undefined {
  const session = sessionManager.getSession();

  if (!session) {
    return undefined;
  }

  const peers: PeerInfo[] = Array.from(peerNames.entries()).map(
    ([id, name]) => ({ id, name }),
  );

  return {
    sessionId: session.id,
    role: session.role,
    serverUrl: getServerUrl(),
    peers,
  };
}

function refreshUi(): void {
  const peers: PeerInfo[] = Array.from(peerNames.entries()).map(
    ([id, name]) => ({ id, name }),
  );

  statusBar.setPeers(peers);

  const state = currentState();

  if (state) {
    panel.setState(state);
  }
}

function setPeerName(clientId: string, name: string): void {
  if (!name) {
    return;
  }

  if (peerNames.get(clientId) !== name) {
    peerNames.set(clientId, name);
    refreshUi();
  }
}

function removePeer(clientId: string): void {
  if (peerNames.delete(clientId)) {
    presence?.removePeer(clientId);
    refreshUi();
  }
}

function getServerUrl(): string {
  return vscode.workspace
    .getConfiguration("liveShare")
    .get<string>("serverUrl", "http://localhost:3000");
}

function handleServerEvent(event: ServerEvent): void {
  switch (event.type) {
    case "connected":
      myClientId =
        typeof event.clientId === "string" ? event.clientId : undefined;

      presence = new PresenceManager(() => connection);
      presence.start();

      sync = new SyncManager(
        () => connection,
        sessionManager.getSession()?.role === "host",
      );
      sync.start();

      voice?.stop();

      voice = new VoiceManager({
        getClientId: () => myClientId,
        getPeers: () => Array.from(peerNames.keys()),
        send: (relayEvent) => connection?.send(relayEvent),
        onVoiceStateChanged: (active, micEnabled) => {
          statusBar.setVoice(active && micEnabled);
        },
      });

      video?.stop();
      videoPanel?.close();
      videoPanel = undefined;

      video = new VideoManager({
        getClientId: () => myClientId,
        getPeers: () => Array.from(peerNames.keys()),
        send: (relayEvent) => connection?.send(relayEvent),
        onFrame: (peerId, jpeg) => {
          videoPanel?.ensurePeer(peerId);
          videoPanel?.showFrame(peerId, jpeg);
        },
        onVideoStateChanged: (active) => {
          statusBar.setVideo(active);
        },
      });

      connection?.send({
        type: "presence.hello",
        name: process.env.USERNAME || process.env.USER || "peer",
      });
      break;
    case "message": {
      const from = typeof event.from === "string" ? event.from : "";

      if (from && typeof event.data === "string") {
        try {
          const payload = JSON.parse(event.data);

          if (
            typeof payload?.type === "string" &&
            payload.type.startsWith("voice.")
          ) {
            voice?.handleRelay(from, payload);
            break;
          }

          if (
            typeof payload?.type === "string" &&
            payload.type.startsWith("video.")
          ) {
            video?.handleRelay(from, payload);
            break;
          }

          if (
            payload?.type === "doc.state" ||
            payload?.type === "doc.update"
          ) {
            sync?.handleRelay(from, payload);
            break;
          }

          if (payload?.type === "presence.hello") {
            setPeerName(from, String(payload.name ?? "guest"));
            break;
          }

          if (payload?.type === "presence.cursor") {
            setPeerName(from, String(payload.name ?? "guest"));
          }

          presence?.handleMessage(from, payload);
        } catch {
          // Ignore malformed relayed payloads.
        }
      }
      break;
    }
    case "peer.joined": {
      const clientId =
        typeof event.clientId === "string" ? event.clientId : "";

      if (clientId && !peerNames.has(clientId)) {
        peerNames.set(clientId, "guest");
        voice?.addPeer(clientId);
        video?.addPeer(clientId);
        refreshUi();
      }

      vscode.window.showInformationMessage("Live Share: a peer joined the session.");
      break;
    }
    case "peer.left": {
      const clientId =
        typeof event.clientId === "string" ? event.clientId : "";

      if (clientId) {
        removePeer(clientId);
        voice?.removePeer(clientId);
        video?.removePeer(clientId);
        videoPanel?.removePeer(clientId);
      }

      vscode.window.showInformationMessage("Live Share: a peer left the session.");
      break;
    }
  }
}

function handleConnectionClosed(code: number, reason: string): void {
  connection = undefined;
  presence?.stop();
  presence = undefined;
  sync?.stop();
  sync = undefined;
  voice?.stop();
  voice = undefined;
  video?.stop();
  video = undefined;
  videoPanel?.close();
  videoPanel = undefined;
  myClientId = undefined;
  statusBar.deactivate();
  panel.dispose();

  const detail = reason || `close code ${code}`;

  vscode.window.showWarningMessage(`Live Share session disconnected (${detail}).`);
}

async function openConnection(sessionId: string): Promise<void> {
  const options: ConnectionOptions = {
    serverUrl: getServerUrl(),
    sessionId,
    onEvent: handleServerEvent,
    onClosed: handleConnectionClosed,
  };

  connection = new LiveShareConnection(options);

  await connection.open();
}

function teardown(): void {
  connection?.close();
  connection = undefined;
  presence?.stop();
  presence = undefined;
  sync?.stop();
  sync = undefined;
  voice?.stop();
  voice = undefined;
  video?.stop();
  video = undefined;
  videoPanel?.close();
  videoPanel = undefined;
  myClientId = undefined;
  statusBar.deactivate();
  panel.dispose();
  peerNames.clear();
  sessionManager.stopSession();
}

export function activate(context: vscode.ExtensionContext) {
  const startSession = vscode.commands.registerCommand(
    "liveShare.startSession",
    async () => {
      const existingSession = sessionManager.getSession();

      if (existingSession) {
        vscode.window.showInformationMessage(
          `Live Share session already active: ${existingSession.id}`,
        );
        return;
      }

      let roomId: string;

      try {
        roomId = await createRoom(getServerUrl());
      } catch (error) {
        vscode.window.showErrorMessage(
          `Live Share: could not create a session on the server. ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }

      const session = sessionManager.startSession(roomId);

      try {
        await openConnection(session.id);

        statusBar.activate(session.id, session.role);
        panel.show(currentState()!);

        vscode.window.showInformationMessage(
          `Live Share Session Started. ID: ${session.id} Role: ${session.role}`,
        );
      } catch (error) {
        teardown();

        vscode.window.showErrorMessage(
          `Live Share: session created (${session.id}) but connection failed. ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  );

  const stopSession = vscode.commands.registerCommand(
    "liveShare.stopSession",
    () => {
      const existingSession = sessionManager.getSession();

      if (!existingSession) {
        vscode.window.showInformationMessage(
          "There is no active Live Share Session",
        );
        return;
      }

      const sessionId = existingSession.id;

      teardown();

      vscode.window.showInformationMessage(
        `Live Share session stopped: ${sessionId}`,
      );
    },
  );

  const showSession = vscode.commands.registerCommand(
    "liveShare.showSession",
    async () => {
      const session = sessionManager.getSession();

      if (!session) {
        vscode.window.showInformationMessage(
          "There is no active Live Share session.",
        );
        return;
      }

      await vscode.env.clipboard.writeText(session.id);

      vscode.window.showInformationMessage(
        `Session ${session.id} copied to clipboard.`,
      );
    },
  );

  const joinSession = vscode.commands.registerCommand(
    "liveShare.joinSession",
    async () => {
      const existingSession = sessionManager.getSession();

      if (existingSession) {
        vscode.window.showWarningMessage(
          `You already have an active Live Share session: ${existingSession.id}`,
        );
        return;
      }

      const sessionId = await vscode.window.showInputBox({
        title: "Join Live Share Session",
        prompt: "Enter the Live Share session ID",
        placeHolder: "Example: 6AD7D62F3EE7",
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value.trim()) {
            return "Session ID is required";
          }
          return undefined;
        },
      });

      if (!sessionId) {
        return;
      }

      const session = sessionManager.joinSession(sessionId);

      try {
        await openConnection(session.id);

        statusBar.activate(session.id, session.role);
        panel.show(currentState()!);

        vscode.window.showInformationMessage(
          `Joined Live Share session: ${session.id}`,
        );
      } catch (error) {
        teardown();

        vscode.window.showErrorMessage(
          `Live Share: could not join session ${session.id}. Check the session ID and server URL. ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  );

  const showPanel = vscode.commands.registerCommand(
    "liveShare.showPanel",
    () => {
      const state = currentState();

      if (!state) {
        vscode.window.showInformationMessage(
          "There is no active Live Share session.",
        );
        return;
      }

      panel.show(state);
    },
  );

  const toggleVoice = vscode.commands.registerCommand(
    "liveShare.toggleVoice",
    () => {
      const session = sessionManager.getSession();

      if (!session) {
        vscode.window.showInformationMessage(
          "Start or join a Live Share session before enabling voice chat.",
        );
        return;
      }

      if (!voice) {
        vscode.window.showWarningMessage(
          "Voice chat is unavailable — there is no active connection.",
        );
        return;
      }

      if (voice.isMicEnabled()) {
        voice.stop();
        vscode.window.showInformationMessage("Voice chat ended.");
        return;
      }

      voice.start();

      const result = voice.enableMic();

      if (result.ok) {
        vscode.window.showInformationMessage(
          "Voice chat on — your microphone is shared with peers.",
        );
      } else {
        vscode.window.showWarningMessage(
          `Voice signaling active, but audio is unavailable. ${result.error}`,
        );
      }
    },
  );

  const toggleVideo = vscode.commands.registerCommand(
    "liveShare.toggleVideo",
    () => {
      const session = sessionManager.getSession();

      if (!session) {
        vscode.window.showInformationMessage(
          "Start or join a Live Share session before enabling video.",
        );
        return;
      }

      if (!video) {
        vscode.window.showWarningMessage(
          "Video is unavailable — there is no active connection.",
        );
        return;
      }

      if (video.isActive()) {
        video.stop();
        videoPanel?.close();
        videoPanel = undefined;
        vscode.window.showInformationMessage("Live video stopped.");
        return;
      }

      video.start();

      const result = video.enableCamera();

      if (result.ok) {
        videoPanel = new VideoPanel(() => {
          // Panel closed by the user — keep the mesh, stop the camera.
          video?.stopCamera();
        });

        for (const peerId of peerNames.keys()) {
          videoPanel.ensurePeer(peerId);
        }

        vscode.window.showInformationMessage(
          "Live video on — your camera is shared with peers.",
        );
      } else {
        vscode.window.showWarningMessage(
          `Video signaling active, but no camera available. ${result.error}`,
        );
      }
    },
  );

  const selectionChange = vscode.window.onDidChangeTextEditorSelection(() => {
    presence?.queueSend();
  });

  context.subscriptions.push(
    startSession,
    stopSession,
    showSession,
    joinSession,
    showPanel,
    toggleVoice,
    toggleVideo,
    selectionChange,
  );
}

export function deactivate() {
  teardown();
}
