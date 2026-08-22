import * as vscode from "vscode";
import * as Y from "yjs";
import { LiveShareConnection } from "./connection";
import { findDocumentsByPath, toRelativePath } from "./workspacePaths";

const MAX_INITIAL_BYTES = 512 * 1024;

interface SyncEvent {
  type: string;
  path?: unknown;
  state?: unknown;
  update?: unknown;
}

interface DocEntry {
  doc: Y.Doc;
  text: Y.Text;
  lastContent: string;
  sentStateVector: Uint8Array;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

export class SyncManager {
  private entries = new Map<string, DocEntry>();
  private applyingRemote = false;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly getConnection: () => LiveShareConnection | undefined,
    private readonly isHost: boolean,
    private canSend: boolean = true,
  ) {}

  setCanSend(enabled: boolean): void {
    this.canSend = enabled;
  }

  start(): void {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.onLocalChange(event.document);
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        this.reconcileDocument(document);
      }),
    );

    if (this.isHost) {
      this.broadcastInitialStates();
    }
  }

  stop(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.disposables = [];
    this.entries.clear();
  }

  handleRelay(from: string, payload: unknown): void {
    const event = payload as SyncEvent;

    if (event?.type === "doc.state" || event?.type === "doc.update") {
      const path = typeof event.path === "string" ? event.path : "";
      const raw =
        typeof event.state === "string"
          ? event.state
          : typeof event.update === "string"
            ? event.update
            : "";

      if (path && raw && from) {
        this.applyRemote(path, fromBase64(raw));
      }
    }
  }

  private broadcastInitialStates(): void {
    const connection = this.getConnection();

    if (!connection) {
      return;
    }

    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme !== "file") {
        continue;
      }

      const content = document.getText();

      if (content.length > MAX_INITIAL_BYTES) {
        continue;
      }

      const relativePath = toRelativePath(document.uri);

      if (this.entries.has(relativePath)) {
        continue;
      }

      const entry = this.createEntry(content);

      this.entries.set(relativePath, entry);

      connection.send({
        type: "doc.state",
        path: relativePath,
        state: toBase64(Y.encodeStateAsUpdate(entry.doc)),
      });
    }
  }

  private createEntry(content: string): DocEntry {
    const doc = new Y.Doc();
    const text = doc.getText("content");

    doc.transact(() => {
      if (content.length > 0) {
        text.insert(0, content);
      }
    });

    return {
      doc,
      text,
      lastContent: content,
      sentStateVector: Y.encodeStateVector(doc),
    };
  }

  private onLocalChange(document: vscode.TextDocument): void {
    if (this.applyingRemote || !this.canSend) {
      return;
    }

    if (document.uri.scheme !== "file") {
      return;
    }

    const relativePath = toRelativePath(document.uri);
    let entry = this.entries.get(relativePath);

    if (!entry) {
      if (!this.isHost) {
        return;
      }

      entry = this.createEntry(document.getText());
      this.entries.set(relativePath, entry);
    }

    const newContent = document.getText();

    if (newContent === entry.lastContent) {
      return;
    }

    this.applyDiffToYText(entry, entry.lastContent, newContent);
    entry.lastContent = newContent;

    const connection = this.getConnection();

    if (!connection) {
      return;
    }

    const update = Y.encodeStateAsUpdate(entry.doc, entry.sentStateVector);

    if (update.length <= 2) {
      return;
    }

    entry.sentStateVector = Y.encodeStateVector(entry.doc);

    connection.send({
      type: "doc.update",
      path: relativePath,
      update: toBase64(update),
    });
  }

  private applyRemote(path: string, update: Uint8Array): void {
    let entry = this.entries.get(path);

    if (!entry) {
      if (this.isHost) {
        return;
      }

      entry = this.createEntry("");
      this.entries.set(path, entry);
    }

    Y.applyUpdate(entry.doc, update);
    entry.sentStateVector = Y.encodeStateVector(entry.doc);

    const target = entry.text.toString();
    entry.lastContent = target;

    for (const document of findDocumentsByPath(path)) {
      this.reconcileDocument(document, target);
    }
  }

  private reconcileDocument(
    document: vscode.TextDocument,
    targetOverride?: string,
  ): void {
    const relativePath = toRelativePath(document.uri);
    const entry = this.entries.get(relativePath);

    if (!entry) {
      return;
    }

    const target = targetOverride ?? entry.text.toString();

    if (document.getText() === target) {
      return;
    }

    const current = document.getText();

    let prefix = 0;
    const min = Math.min(current.length, target.length);

    while (prefix < min && current[prefix] === target[prefix]) {
      prefix += 1;
    }

    let endCurrent = current.length;
    let endTarget = target.length;

    while (
      endCurrent > prefix &&
      endTarget > prefix &&
      current[endCurrent - 1] === target[endTarget - 1]
    ) {
      endCurrent -= 1;
      endTarget -= 1;
    }

    const edit = new vscode.WorkspaceEdit();

    edit.replace(
      document.uri,
      new vscode.Range(
        document.positionAt(prefix),
        document.positionAt(endCurrent),
      ),
      target.slice(prefix, endTarget),
    );

    this.applyingRemote = true;

    void vscode.workspace.applyEdit(edit).then(() => {
      this.applyingRemote = false;
      entry!.lastContent = document.getText();
    });
  }

  private applyDiffToYText(
    entry: DocEntry,
    oldContent: string,
    newContent: string,
  ): void {
    let prefix = 0;
    const min = Math.min(oldContent.length, newContent.length);

    while (prefix < min && oldContent[prefix] === newContent[prefix]) {
      prefix += 1;
    }

    let endOld = oldContent.length;
    let endNew = newContent.length;

    while (
      endOld > prefix &&
      endNew > prefix &&
      oldContent[endOld - 1] === newContent[endNew - 1]
    ) {
      endOld -= 1;
      endNew -= 1;
    }

    entry.doc.transact(() => {
      if (endOld > prefix) {
        entry.text.delete(prefix, endOld - prefix);
      }

      if (endNew > prefix) {
        entry.text.insert(prefix, newContent.slice(prefix, endNew));
      }
    });
  }
}
