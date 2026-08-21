import * as vscode from "vscode";
import {
  ConnectionOptions,
  LiveShareConnection,
  ServerEvent,
  createRoom,
} from "./connection";
import { SessionManager } from "./session";

const sessionManager = new SessionManager();

let connection: LiveShareConnection | undefined;

function getServerUrl(): string {
  return vscode.workspace
    .getConfiguration("liveShare")
    .get<string>("serverUrl", "http://localhost:3000");
}

function handleServerEvent(event: ServerEvent): void {
  switch (event.type) {
    case "peer.joined":
      vscode.window.showInformationMessage("Live Share: a peer joined the session.");
      break;
    case "peer.left":
      vscode.window.showInformationMessage("Live Share: a peer left the session.");
      break;
  }
}

function handleConnectionClosed(code: number, reason: string): void {
  connection = undefined;

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

  context.subscriptions.push(
    startSession,
    stopSession,
    showSession,
    joinSession,
  );
}

export function deactivate() {
  teardown();
}
