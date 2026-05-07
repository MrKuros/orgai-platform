import * as assert from 'assert';
import { Evaluator } from '../../evaluator';

suite('Evaluator Stabilization Test', () => {
    test('blocks path traversal attempts (../../etc/passwd)', () => {
        const evaluator = new Evaluator([]);
        const violations = evaluator.evaluateCode('// some code', '../../etc/passwd');
        
        const traversalBlocking = violations.find(v => v.description === 'Blocked: path traversal detected');
        assert.ok(traversalBlocking, 'Should have blocked path traversal to /etc/passwd');
    });

    test('allows normal relative paths (src/agent.ts)', () => {
        const evaluator = new Evaluator([]);
        const violations = evaluator.evaluateCode('// some code', 'src/agent.ts');
        
        const traversalBlocking = violations.find(v => v.description === 'Blocked: path traversal detected');
        assert.strictEqual(traversalBlocking, undefined, 'Should not block normal workspace paths');
    });
});
