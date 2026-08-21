import * as vscode from "vscode";

export class SessionStatusBar {
  private readonly item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );

  private sessionId = "";
  private role = "";
  private peers = 0;

  activate(sessionId: string, role: string): void {
    this.sessionId = sessionId;
    this.role = role;
    this.peers = 0;

    this.item.command = "liveShare.showSession";
    this.item.tooltip = new vscode.MarkdownString(
      `**Live Share active**\n\nSession: \`${sessionId}\`\nRole: ${role}\n\nClick to copy the session ID.`,
    );

    this.render();
    this.item.show();
  }

  peerJoined(): void {
    this.peers += 1;
    this.render();
  }

  peerLeft(): void {
    this.peers = Math.max(0, this.peers - 1);
    this.render();
  }

  deactivate(): void {
    this.item.hide();
    this.sessionId = "";
    this.role = "";
    this.peers = 0;
  }

  private render(): void {
    const peersLabel =
      this.peers === 1 ? "1 peer" : `${this.peers} peers`;

    this.item.text = `$(broadcast) ${this.role}: ${this.sessionId} ($(person) ${peersLabel})`;
  }
}
