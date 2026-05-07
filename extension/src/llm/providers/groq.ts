import Groq from 'groq-sdk';

import type { LlmChatRequest, LlmClient, StreamCallbacks } from '../types';

type GroqOpts = {
  apiKey: string;
};

export class GroqClient implements LlmClient {
  public readonly id = 'groq' as const;
  private groq: Groq;

  constructor(opts: GroqOpts) {
    this.groq = new Groq({ apiKey: opts.apiKey });
  }

  public async chatStream(req: LlmChatRequest, cb: StreamCallbacks, signal?: AbortSignal): Promise<string> {
    const stream = await this.groq.chat.completions.create({
      model: req.model,
      messages: req.messages,
      stream: true,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
    }, { signal: signal as any });

    let full = '';
    for await (const chunk of stream) {
      if (signal?.aborted) throw { name: 'AbortError' };
      const token = chunk.choices[0]?.delta?.content;
      if (token) {
        full += token;
        cb.onToken(token);
      }
    }
    return full;
  }
  public async getAvailableModels(): Promise<{ id: string; label: string }[]> {
    try {
      const response = await this.groq.models.list();
      return response.data
        .sort((a: any, b: any) => (b.created || 0) - (a.created || 0))
        .map((m: any) => ({
          id: m.id,
          label: m.id,
        }));
    } catch {
      return [
        { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
        { id: 'llama3-8b-8192', label: 'Llama 3 8B' },
        { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
        { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
        { id: 'gemma2-9b-it', label: 'Gemma 2 9B' },
        { id: 'deepseek-r1-distill-llama-70b', label: 'Deepseek R1 70B' }
      ];
    }
  }
}

