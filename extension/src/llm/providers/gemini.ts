import type { ChatMessage, LlmChatRequest, LlmClient, StreamCallbacks } from '../types';

type GeminiOpts = {
  apiKey: string;
  timeoutMs: number;
};

export class GeminiClient implements LlmClient {
  public readonly id = 'gemini' as const;
  private apiKey: string;
  private timeoutMs: number;

  constructor(opts: GeminiOpts) {
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs;
  }

  public async chatStream(req: LlmChatRequest, cb: StreamCallbacks, signal?: AbortSignal): Promise<string> {
    // Minimal implementation (non-streaming) mapped to "stream" via chunking.
    // Endpoint: generateContent (v1beta). This keeps dependencies at zero.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);

    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
      if (signal.aborted) controller.abort();
    }
    try {
      const model = encodeURIComponent(req.model);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
        this.apiKey
      )}`;

      const contents = toGeminiContents(req.messages);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: req.temperature ?? 0.7,
            maxOutputTokens: req.maxTokens ?? 4096,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await safeReadText(res);
        throw new Error(`LLM error (${res.status}): ${text || res.statusText}`);
      }

      const json = (await res.json()) as any;
      const text =
        json?.candidates?.[0]?.content?.parts
          ?.map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
          .join('') ?? '';

      // Chunk to mimic streaming UX
      const chunkSize = 30;
      let full = '';
      for (let i = 0; i < text.length; i += chunkSize) {
        if (signal?.aborted) throw { name: 'AbortError' };
        const chunk = text.slice(i, i + chunkSize);
        full += chunk;
        cb.onToken(chunk);
        await new Promise((r) => setTimeout(r, 0));
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
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(this.apiKey)}`;
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      if (!res.ok) {throw new Error('Failed');}
      const json = await res.json() as any;
      if (!json.models || !Array.isArray(json.models)) {throw new Error('Invalid');}
      return json.models
        .filter((m: any) => m.name.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => ({
          id: m.name.replace('models/', ''),
          label: m.displayName || m.name.replace('models/', '')
        }));
    } catch {
      return [
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }
      ];
    } finally {
      clearTimeout(t);
    }
  }
}

function toGeminiContents(messages: ChatMessage[]): any[] {
  // Gemini expects roles: user/model
  const out: any[] = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    out.push({ role, parts: [{ text: m.content }] });
  }
  return out;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

