import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

export interface PeerInfo {
  id: string;
  name: string;
}

export interface PanelState {
  sessionId: string;
  role: string;
  serverUrl: string;
  peers: PeerInfo[];
}

const USER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;

const BROADCAST_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export class SessionPanel {
  private panel: vscode.WebviewPanel | undefined;
  private state: PanelState | undefined;

  constructor(
    private readonly handlers: {
      onCopy: () => void;
      onLeave: () => void;
    },
  ) {}

  show(state: PanelState): void {
    this.state = state;

    if (this.panel) {
      this.panel.reveal();
      this.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "liveShare.session",
      "Live Share",
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );

    panel.webview.html = this.render(state);

    panel.onDidDispose(() => {
      this.panel = undefined;
    });

    panel.webview.onDidReceiveMessage((message) => {
      if (message?.type === "copy") {
        this.handlers.onCopy();
      }

      if (message?.type === "leave") {
        this.handlers.onLeave();
      }
    });

    this.panel = panel;
  }

  refresh(): void {
    if (this.panel && this.state) {
      this.panel.webview.html = this.render(this.state);
    }
  }

  setState(state: PanelState): void {
    this.state = state;
    this.refresh();
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.state = undefined;
  }

  private render(state: PanelState): string {
    const nonce = randomBytes(16).toString("hex");
    const peersMarkup =
      state.peers.length === 0
        ? `<p class="empty-peers">No peers connected yet — share the session ID to invite someone.</p>`
        : state.peers
            .map(
              (peer) => `
              <div class="peer-chip">
                <div class="mini-avatar">${USER_ICON}</div>
                <div class="peer-details">
                  <span class="peer-name">${escapeHtml(peer.name)}</span>
                  <span class="peer-id">${escapeHtml(peer.id)}</span>
                </div>
                <span class="peer-dot"></span>
              </div>`,
            )
            .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
    overflow: hidden;
  }
  body::before, body::after {
    content: '';
    position: fixed;
    border-radius: 50%;
    filter: blur(90px);
    z-index: 0;
  }
  body::before {
    width: 420px; height: 420px;
    background: rgba(37, 99, 235, 0.35);
    top: -120px; left: -80px;
  }
  body::after {
    width: 360px; height: 360px;
    background: rgba(147, 51, 234, 0.3);
    bottom: -100px; right: -60px;
  }
  .glass-card {
    position: relative;
    z-index: 10;
    width: 400px;
    border-radius: 40px;
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(28px) saturate(80%);
    -webkit-backdrop-filter: blur(28px) saturate(80%);
    border: 3px solid rgba(224, 224, 224, 0.2);
    box-shadow: inset 0px 0px 4px 2px rgba(255, 255, 255, 0.35);
    overflow: hidden;
  }
  .glass-card::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    background: linear-gradient(to left top, rgba(255,255,255,0.175) 0%, rgba(255,255,255,0) 50%);
    z-index: 1;
  }
  .glass-card::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    background: linear-gradient(to bottom, rgba(255,255,255,0.105) 0%, rgba(255,255,255,0) 100%);
    z-index: 1;
  }
  .card-content {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    padding: 24px;
    color: white;
    text-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .user-info { display: flex; align-items: center; gap: 12px; }
  .avatar {
    width: 40px; height: 40px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    border: 2px solid #3b82f6;
    display: flex; align-items: center; justify-content: center;
  }
  .avatar svg, .mini-avatar svg { width: 20px; height: 20px; color: #3b82f6; }
  .user-name { font-weight: 600; margin: 0; }
  .user-role { font-size: 12px; opacity: 0.7; margin: 0; }
  .notification-icon { width: 20px; height: 20px; opacity: 0.5; }
  .session-badge {
    display: inline-block;
    margin-top: 16px;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    background: ${state.role === "host" ? "rgba(34,197,94,0.25)" : "rgba(59,130,246,0.25)"};
    border: 1px solid ${state.role === "host" ? "rgba(34,197,94,0.5)" : "rgba(59,130,246,0.5)"};
  }
  .session-id {
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 2px;
    margin: 8px 0 4px 0;
  }
  .card-description {
    font-size: 14px;
    opacity: 0.7;
    margin: 0 0 16px 0;
  }
  .glass-button {
    width: 100%;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: white;
    padding: 8px 16px;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
    margin-bottom: 8px;
  }
  .glass-button:hover { background: rgba(255, 255, 255, 0.2); }
  .glass-button:focus {
    outline: none;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.4);
  }
  .glass-button.danger {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.35);
  }
  .glass-button.danger:hover { background: rgba(239, 68, 68, 0.3); }
  .peers-section { margin-top: 16px; }
  .peers-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    opacity: 0.6;
    margin: 0 0 8px 0;
  }
  .peer-chip {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    margin-bottom: 6px;
  }
  .mini-avatar {
    width: 28px; height: 28px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    border: 1.5px solid #38bdf8;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .mini-avatar svg { width: 14px; height: 14px; }
  .peer-details { display: flex; flex-direction: column; min-width: 0; }
  .peer-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .peer-id { font-size: 11px; opacity: 0.55; font-family: monospace; }
  .peer-dot {
    margin-left: auto;
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 6px #22c55e;
  }
  .empty-peers { font-size: 13px; opacity: 0.6; margin: 0; }
  .card-tip {
    font-size: 12px;
    text-align: center;
    color: #e0e6ed;
    opacity: 0.7;
    margin: 16px 0 0 0;
  }
</style>
</head>
<body>
  <div class="glass-card">
    <div class="card-content">
      <div class="card-header">
        <div class="user-info">
          <div class="avatar">${USER_ICON}</div>
          <div class="user-details">
            <p class="user-name">Live Share Session</p>
            <p class="user-role">${escapeHtml(state.serverUrl)}</p>
          </div>
        </div>
        <div class="avatar notification-icon">${BROADCAST_ICON}</div>
      </div>

      <div class="card-body">
        <span class="session-badge">${escapeHtml(state.role)}</span>
        <h3 class="session-id">${escapeHtml(state.sessionId)}</h3>
        <p class="card-description">Share this session ID so your teammate can join and start coding together.</p>
        <button class="glass-button" id="copy">Copy Session ID</button>
        <button class="glass-button danger" id="leave">Leave Session</button>
      </div>

      <div class="peers-section">
        <p class="peers-title">Connected Peers (${state.peers.length})</p>
        ${peersMarkup}
      </div>

      <p class="card-tip">Tip: cursors and selections of connected peers appear live in your editor.</p>
    </div>
  </div>

  <script nonce="${nonce}">
    const vsapi = acquireVsCodeApi();
    document.getElementById("copy").addEventListener("click", () => vsapi.postMessage({ type: "copy" }));
    document.getElementById("leave").addEventListener("click", () => vsapi.postMessage({ type: "leave" }));
  </script>
</body>
</html>`;
  }
}
