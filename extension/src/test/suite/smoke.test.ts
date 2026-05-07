import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Comply extension smoke test', () => {
  test('commands are registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('comply.openChat'));
    assert.ok(commands.includes('comply.reloadPolicies'));
    assert.ok(commands.includes('comply.setApiKey'));
    assert.ok(commands.includes('comply.clearApiKey'));
    assert.ok(commands.includes('comply.openOnboarding'));
  });
});

