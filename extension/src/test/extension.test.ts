import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import Mocha from 'mocha';
import { PolicyEngine } from '../policyEngine';
import { Evaluator } from '../evaluator';

/**
 * E2E Test Runner
 * VS Code launches this file and calls the run() function.
 */
export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true
  });

  const testsRoot = path.resolve(__dirname);
  const testFile = path.join(testsRoot, 'extension.test.js');
  
  // Clear require cache for the test file so that Mocha can re-load it
  // and execute the suite() and test() globals.
  delete require.cache[testFile];
  mocha.addFile(testFile);

  return new Promise((resolve, reject) => {
    try {
      mocha.run(failures => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}

/**
 * E2E Test Suite
 * These tests only execute when Mocha loads this file and provides the TDD globals.
 */
if (typeof suite !== 'undefined') {
  suite('Extension E2E Test Suite', () => {

    suiteSetup(async () => {
      const ext = vscode.extensions.getExtension('orgai.comply');
      if (ext) {
        await ext.activate();
      }
    });

    test('Test 1: comply.reloadPolicies command is registered after activation', async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('comply.reloadPolicies'), 'Command not registered');
    });

    test('Test 2: policy engine has loaded at least one role after activation', async () => {
      const extensionPath = path.resolve(__dirname, '../../');
      const engine = new PolicyEngine(extensionPath);
      await engine.load();
      const roles = engine.getAllRoles();
      assert.ok(roles.length > 0, 'Policy engine failed to load roles in E2E environment');
      assert.ok(roles.some(r => r.role === 'cto'), 'CTO role missing');
    });

    test('Test 3: evaluator blocks secret', async () => {
      const extensionPath = path.resolve(__dirname, '../../');
      const engine = new PolicyEngine(extensionPath);
      await engine.load();
      const evaluator = new Evaluator(engine.getResolvedPolicies());
      
      const results = evaluator.evaluateCode('const API_KEY = "sk-123456789";', 'src/api.ts');
      assert.strictEqual(results[0].passed, false);
      assert.ok(results[0].policyName.toLowerCase().includes('secret'));
    });

    test('Test 4: evaluator passes clean code', async () => {
      const extensionPath = path.resolve(__dirname, '../../');
      const engine = new PolicyEngine(extensionPath);
      await engine.load();
      const evaluator = new Evaluator(engine.getResolvedPolicies());
      
      const results = evaluator.evaluateCode('function add(a, b) { return a + b; }', 'src/math.ts');
      assert.strictEqual(results.length, 0);
    });

    test('Test 5: evaluator blocks unapproved package', async () => {
      const extensionPath = path.resolve(__dirname, '../../');
      const engine = new PolicyEngine(extensionPath);
      await engine.load();
      const evaluator = new Evaluator(engine.getResolvedPolicies());
      
      const results = evaluator.evaluateCommand('npm install stripe');
      assert.strictEqual(results[0].passed, false);
      assert.ok(results[0].description.includes('stripe'));
    });

    test('Test 6: comply.reloadPolicies executes without throwing', async () => {
      await vscode.commands.executeCommand('comply.reloadPolicies');
    });
  });
}
