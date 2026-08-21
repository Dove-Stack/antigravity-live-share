import * as vscode from "vscode";
import * as path from "node:path";

export function toRelativePath(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);

  if (!folder) {
    return uri.fsPath;
  }

  return vscode.workspace.asRelativePath(uri, false).split(path.sep).join("/");
}

export function findDocumentsByPath(relativePath: string): vscode.TextDocument[] {
  return vscode.workspace.textDocuments.filter(
    (document) => toRelativePath(document.uri) === relativePath,
  );
}
