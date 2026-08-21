import * as vscode from "vscode";
import { LiveShareConnection } from "./connection";
import { toRelativePath } from "./workspacePaths";

const SEND_INTERVAL_MS = 150;
const COLORS = [
  "#3b82f6",
  "#22c55e",
  "#eab308",
  "#ec4899",
  "#a855f7",
  "#f97316",
];

interface CursorEvent {
  type: "presence.cursor";
  name: string;
  path: string;
  selections: { anchor: number; head: number }[];
}

interface PeerPresence {
  decoration: vscode.TextEditorDecorationType;
  path?: string;
}

export class PresenceManager {
  private peers = new Map<string, PeerPresence>();
  private timer: NodeJS.Timeout | undefined;
  private pending = false;

  constructor(
    private readonly getConnection: () => LiveShareConnection | undefined,
  ) {}

  start(): void {
    this.stop();

    this.timer = setInterval(() => this.flush(), SEND_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = undefined;

    for (const peer of this.peers.values()) {
      peer.decoration.dispose();
    }

    this.peers.clear();
  }

  queueSend(): void {
    this.pending = true;
  }

  removePeer(clientId: string): void {
    const peer = this.peers.get(clientId);

    if (!peer) {
      return;
    }

    this.clearDecorations(peer);
    peer.decoration.dispose();
    this.peers.delete(clientId);
  }

  handleMessage(from: string, payload: unknown): void {
    const event = payload as CursorEvent;

    if (event?.type !== "presence.cursor" || !Array.isArray(event.selections)) {
      return;
    }

    let peer = this.peers.get(from);

    if (!peer) {
      peer = {
        decoration: this.createDecoration(event.name || "peer", from),
      };
      this.peers.set(from, peer);
    }

    for (const editor of vscode.window.visibleTextEditors) {
      const editorPath = toRelativePath(editor.document.uri);
      const matches = editorPath === event.path;

      if (peer.path && editorPath === peer.path && !matches) {
        editor.setDecorations(peer.decoration, []);
      }

      if (!matches) {
        continue;
      }

      const decorations: vscode.DecorationOptions[] = [];

      for (const selection of event.selections) {
        const anchor = editor.document.positionAt(selection.anchor);
        const active = editor.document.positionAt(selection.head);

        let range: vscode.Range;

        if (selection.anchor === selection.head) {
          const endOffset = Math.min(
            selection.head + 1,
            editor.document.getText().length,
          );

          if (endOffset <= selection.head) {
            continue;
          }

          range = new vscode.Range(anchor, editor.document.positionAt(endOffset));
        } else {
          range = new vscode.Range(anchor, active);
        }

        decorations.push({
          range,
          hoverMessage: new vscode.MarkdownString(`**${event.name || "peer"}**`),
        });
      }

      editor.setDecorations(peer.decoration, decorations);
    }

    peer.path = event.path;
  }

  private clearDecorations(peer: PeerPresence): void {
    if (!peer.path) {
      return;
    }

    for (const editor of vscode.window.visibleTextEditors) {
      if (toRelativePath(editor.document.uri) === peer.path) {
        editor.setDecorations(peer.decoration, []);
      }
    }
  }

  private createDecoration(name: string, clientId: string) {
    const color = COLORS[this.hashColor(clientId)];

    return vscode.window.createTextEditorDecorationType({
      backgroundColor: `${color}22`,
      borderColor: color,
      borderWidth: "1px",
      borderStyle: "solid",
      borderRadius: "2px",
      overviewRulerColor: color,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
  }

  private hashColor(clientId: string): number {
    let hash = 0;

    for (const char of clientId) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }

    return hash % COLORS.length;
  }

  private flush(): void {
    if (!this.pending) {
      return;
    }

    this.pending = false;

    const connection = this.getConnection();
    const editor = vscode.window.activeTextEditor;

    if (!connection || !editor) {
      return;
    }

    const event: CursorEvent = {
      type: "presence.cursor",
      name: process.env.USERNAME || process.env.USER || "peer",
      path: toRelativePath(editor.document.uri),
      selections: editor.selections.map((selection) => ({
        anchor: editor.document.offsetAt(selection.anchor),
        head: editor.document.offsetAt(selection.active),
      })),
    };

    connection.send(event as unknown as Record<string, unknown>);
  }
}
