import type { ChatMessage, LlmChatRequest, LlmClient, StreamCallbacks } from '../types';
import { sseDataIterator } from '../sse';

type AnthropicOpts = {
  apiKey: string;
  timeoutMs: number;
};

export class AnthropicClient implements LlmClient {
  public readonly id = 'anthropic' as const;
  private apiKey: string;
  private timeoutMs: number;

  constructor(opts: AnthropicOpts) {
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs;
  }

  public async chatStream(req: LlmChatRequest, cb: StreamCallbacks, signal?: AbortSignal): Promise<string> {
    // Anthropic uses `system` separately + `messages` without system role
    const { system, messages } = splitSystem(req.messages);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);

    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
      if (signal.aborted) controller.abort();
    }

    try {
      const res = await fetch(`https://api.anthropic.com/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens ?? 4096,
          temperature: req.temperature ?? 0.7,
          system: system || undefined,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const text = await safeReadText(res);
        throw new Error(`LLM error (${res.status}): ${text || res.statusText}`);
      }

      // Anthropic streams SSE-like events with JSON payloads.
      // We'll extract text deltas when present.
      let full = '';
      for await (const data of sseDataIterator(res.body as any)) {
        if (signal?.aborted) throw { name: 'AbortError' };
        try {
          const parsed = JSON.parse(data);
          const t = parsed?.delta?.text;
          if (typeof t === 'string' && t.length > 0) {
            full += t;
            cb.onToken(t);
          }
        } catch {
          // ignore
        }
      }

      return full;
    } finally {
      clearTimeout(t);
    }
  }
  public async getAvailableModels(): Promise<{ id: string; label: string }[]> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`https://api.anthropic.com/v1/models`, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: controller.signal,
      });
      if (!res.ok) {throw new Error('Failed');}
      const json = await res.json() as any;
      if (!json.data || !Array.isArray(json.data)) {throw new Error('Invalid');}
      return json.data.map((m: any) => ({
        id: m.id,
        label: m.display_name || m.id,
      }));
    } catch {
      return [
        { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' }
      ];
    } finally {
      clearTimeout(t);
    }
  }
}

function splitSystem(all: ChatMessage[]): { system: string; messages: ChatMessage[] } {
  const systemParts: string[] = [];
  const messages: ChatMessage[] = [];
  for (const m of all) {
    if (m.role === 'system') systemParts.push(m.content);
    else messages.push(m);
  }
  return { system: systemParts.join('\n\n'), messages };
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

