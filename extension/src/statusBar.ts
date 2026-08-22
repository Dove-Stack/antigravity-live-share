import * as vscode from "vscode";
import { PeerInfo } from "./panel";

export class SessionStatusBar {
  private readonly item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );

  private sessionId = "";
  private role = "";
  private peers: PeerInfo[] = [];
  private voice = false;
  private video = false;
  private pending = false;

  activate(sessionId: string, role: string): void {
    this.sessionId = sessionId;
    this.role = role;
    this.peers = [];

    this.item.command = "liveShare.showPanel";
    this.item.tooltip = new vscode.MarkdownString(
      `**Live Share active**\n\nSession: \`${sessionId}\`\nRole: ${role}\n\nClick to open the session panel.`,
    );

    this.render();
    this.item.show();
  }

  setPeers(peers: PeerInfo[]): void {
    this.peers = peers;
    this.render();

    this.item.tooltip = new vscode.MarkdownString(
      [
        `**Live Share active**`,
        ``,
        `Session: \`${this.sessionId}\``,
        `Role: ${this.role}`,
        ``,
        peers.length === 0
          ? `_No peers connected._`
          : `**Peers**\n${peers.map((peer) => `- ${peer.name} (\`${peer.id}\`)`).join("\n")}`,
        ``,
        `Click to open the session panel.`,
      ].join("\n"),
    );
  }

  setVoice(enabled: boolean): void {
    this.voice = enabled;
    this.render();
  }

  setVideo(enabled: boolean): void {
    this.video = enabled;
    this.render();
  }

  setPending(pending: boolean): void {
    this.pending = pending;
    this.render();
  }

  deactivate(): void {
    this.item.hide();
    this.sessionId = "";
    this.role = "";
    this.peers = [];
    this.voice = false;
    this.video = false;
    this.pending = false;
  }

  private render(): void {
    const label =
      this.peers.length === 1 ? "1 peer" : `${this.peers.length} peers`;

    const mediaLabel = `${this.voice ? " $(mic)" : ""}${
      this.video ? " $(video)" : ""
    }`;

    const pendingLabel = this.pending ? " $(clock) pending" : "";

    this.item.text = `$(broadcast) Live Share · $(person) ${label}${mediaLabel}${pendingLabel}`;
    this.item.backgroundColor = this.pending
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : this.peers.length > 0
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;
  }
}
