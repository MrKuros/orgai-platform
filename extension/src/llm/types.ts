export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = { role: ChatRole; content: string };

export type LlmProviderId =
  | 'groq'
  | 'openai'
  | 'openaiCompatible'
  | 'anthropic'
  | 'gemini'
  | 'ollama';

export type StreamCallbacks = {
  onToken: (token: string) => void;
  onCancelled?: () => void;
};

export type LlmChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

export interface LlmClient {
  readonly id: LlmProviderId;
  chatStream(req: LlmChatRequest, cb: StreamCallbacks, signal?: AbortSignal): Promise<string>;
  getAvailableModels(): Promise<{ id: string; label: string }[]>;
}

