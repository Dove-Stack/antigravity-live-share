import * as vscode from "vscode";
import { SessionManager } from "./session";

const sessionManager = new SessionManager();

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

      const session = sessionManager.startSession();

      vscode.window.showInformationMessage(`
        Live Share Session Started. 
        
        ID: ${session.id}
        
        Role: ${session.role}
      `);
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

      sessionManager.stopSession();

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

      vscode.window.showInformationMessage(
        `Joined Live Share session: ${session.id}`,
      );
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
  sessionManager.stopSession();
}
