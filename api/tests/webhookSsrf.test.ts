import { isBlockedWebhookHost } from '../src/services/webhook';

describe('isBlockedWebhookHost (SSRF guard)', () => {
  it('blocks loopback, private, and link-local hosts', () => {
    for (const url of [
      'http://localhost:9999/x',
      'http://127.0.0.1/x',
      'http://10.0.0.5/x',
      'http://172.16.4.4/x',
      'http://192.168.1.50/x',
      'http://169.254.169.254/latest/meta-data', // cloud metadata
      'http://0.0.0.0/x',
      'http://[::1]/x',
      'not-a-url',
    ]) {
      expect(isBlockedWebhookHost(url)).toBe(true);
    }
  });

  it('allows public hosts', () => {
    for (const url of [
      'https://hooks.example.com/x',
      'http://172.32.0.1/x', // just outside 172.16/12
      'https://8.8.8.8/x',
    ]) {
      expect(isBlockedWebhookHost(url)).toBe(false);
    }
  });
});
