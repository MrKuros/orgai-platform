import * as vscode from 'vscode';

export class OrgStatusBar {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
  }

  setConnected(orgName: string, roleName: string): void {
    this.item.text = `$(shield) ${orgName} · ${roleName}`;
    this.item.tooltip = 'OrgAI compliance active — click to reload policies';
    this.item.command = 'comply.reloadPolicies';
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  setStandalone(): void {
    this.item.text = `$(shield) Comply`;
    this.item.tooltip = 'Comply — local policies active';
    this.item.command = 'comply.openOnboarding';
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  setError(message: string): void {
    this.item.text = `$(warning) Comply`;
    this.item.tooltip = `Policy load failed: ${message}`;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
