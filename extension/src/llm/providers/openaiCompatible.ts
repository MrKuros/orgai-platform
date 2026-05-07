import { sseDataIterator } from '../sse';
import type { LlmChatRequest, LlmClient, StreamCallbacks } from '../types';

type OpenAiCompatibleOpts = {
  id: 'openai' | 'openaiCompatible';
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
};

export class OpenAiCompatibleClient implements LlmClient {
  public readonly id: 'openai' | 'openaiCompatible';
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(opts: OpenAiCompatibleOpts) {
    this.id = opts.id;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs;
  }

  public async chatStream(req: LlmChatRequest, cb: StreamCallbacks, signal?: AbortSignal): Promise<string> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
      if (signal.aborted) controller.abort();
    }

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          temperature: req.temperature ?? 0.7,
          stream: true,
          max_tokens: req.maxTokens ?? 4096,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const text = await safeReadText(res);
        throw new Error(`LLM error (${res.status}): ${text || res.statusText}`);
      }

      let full = '';
      for await (const data of sseDataIterator(res.body as any)) {
        if (signal?.aborted) throw { name: 'AbortError' };
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            full += delta;
            cb.onToken(delta);
          }
        } catch {
          // ignore non-JSON events
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
      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });
      if (!res.ok) {throw new Error('Failed to fetch models');}
      const json = await res.json() as any;
      if (!json.data || !Array.isArray(json.data)) {throw new Error('Invalid format');}
      return json.data.map((m: any) => ({
        id: m.id,
        label: m.id,
      }));
    } catch {
      if (this.id === 'openai') {
        return [
          { id: 'gpt-4o', label: 'GPT-4o' },
          { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
          { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' }
        ];
      }
      return [{ id: 'model', label: 'Default Model' }];
    } finally {
      clearTimeout(t);
    }
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

