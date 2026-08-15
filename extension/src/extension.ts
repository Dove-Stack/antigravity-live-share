import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const startSession = vscode.commands.registerCommand(
    "liveShare.startSession",
    () => {
      vscode.window.showInformationMessage(
        "Antigravity Live Share: Session started!",
      );
    },
  );
  context.subscriptions.push(startSession);
}

export function deactivate() {}
