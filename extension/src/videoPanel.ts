import * as vscode from "vscode";
import { randomBytes } from "node:crypto";

const USER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;

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

export class VideoPanel {
  private panel: vscode.WebviewPanel | undefined;
  private knownPeers = new Set<string>();

  constructor(private readonly onClose: () => void) {}

  ensurePeer(peerId: string): void {
    if (this.panel && !this.knownPeers.has(peerId)) {
      this.knownPeers.add(peerId);
      this.render();
      return;
    }

    this.knownPeers.add(peerId);
  }

  removePeer(peerId: string): void {
    if (this.knownPeers.delete(peerId) && this.panel) {
      this.render();
    }
  }

  showFrame(peerId: string, jpeg: Buffer): void {
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;

    if (!this.panel) {
      this.create();
    }

    this.panel?.webview.postMessage({
      type: "frame",
      peer: peerId,
      url: dataUrl,
    });
  }

  close(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.knownPeers.clear();
  }

  private create(): void {
    const panel = vscode.window.createWebviewPanel(
      "liveShare.video",
      "Live Share Video",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true },
    );

    panel.onDidDispose(() => {
      this.panel = undefined;
      this.onClose();
    });

    this.panel = panel;
    this.render();
  }

  private render(): void {
    if (!this.panel) {
      return;
    }

    const nonce = randomBytes(16).toString("hex");
    const peersMarkup = Array.from(this.knownPeers)
      .map(
        (peerId) => `
        <div class="tile glass-tile" id="tile-${escapeHtml(peerId)}">
          <div class="tile-header">
            <div class="mini-avatar">${USER_ICON}</div>
            <span class="peer-name">${escapeHtml(peerId)}</span>
            <span class="live-dot"></span>
          </div>
          <img id="cam-${escapeHtml(peerId)}" alt="Live video from ${escapeHtml(peerId)}" />
          <p class="waiting">waiting for frames…</p>
        </div>`,
      )
      .join("");

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
    color: white;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
    align-content: start;
  }
  body::before, body::after {
    content: '';
    position: fixed;
    border-radius: 50%;
    filter: blur(90px);
    z-index: 0;
    pointer-events: none;
  }
  body::before {
    width: 380px; height: 380px;
    background: rgba(124, 58, 237, 0.3);
    top: -120px; left: -80px;
  }
  body::after {
    width: 320px; height: 320px;
    background: rgba(147, 51, 234, 0.25);
    bottom: -100px; right: -60px;
  }
  .glass-tile {
    position: relative;
    z-index: 10;
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(28px) saturate(80%);
    -webkit-backdrop-filter: blur(28px) saturate(80%);
    border: 2.5px solid rgba(224, 224, 224, 0.2);
    box-shadow: inset 0px 0px 4px 2px rgba(255, 255, 255, 0.35);
    overflow: hidden;
    padding: 14px;
  }
  .tile-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .mini-avatar {
    width: 26px; height: 26px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    border: 1.5px solid #38bdf8;
    display: flex; align-items: center; justify-content: center;
  }
  .mini-avatar svg { width: 13px; height: 13px; color: #38bdf8; }
  .peer-name { font-size: 12px; font-weight: 700; font-family: monospace; letter-spacing: 1px; }
  .live-dot {
    margin-left: auto;
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #ef4444;
    box-shadow: 0 0 6px #ef4444;
  }
  img {
    width: 100%;
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.35);
    aspect-ratio: 16 / 9;
    object-fit: contain;
    display: block;
  }
  .waiting {
    font-size: 11px;
    opacity: 0.6;
    text-align: center;
    margin: 8px 0 0 0;
  }
</style>
</head>
<body>
  ${peersMarkup || '<p class="waiting">No video peers yet.</p>'}
  <script nonce="${nonce}">
    window.addEventListener("message", (event) => {
      const message = event.data;
      if ((message || {}).type !== "frame") return;
      const img = document.getElementById("cam-" + message.peer);
      const tile = document.getElementById("tile-" + message.peer);
      if (img) {
        img.src = message.url;
        if (tile) {
          const wait = tile.querySelector(".waiting");
          if (wait) wait.remove();
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
