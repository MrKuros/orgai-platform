import * as vscode from 'vscode';

import type { LlmClient, LlmProviderId } from './types';
import { GroqClient } from './providers/groq';
import { OpenAiCompatibleClient } from './providers/openaiCompatible';
import { AnthropicClient } from './providers/anthropic';
import { GeminiClient } from './providers/gemini';

export type ProviderSecrets = {
  /**
   * Return the API key for the given provider.
   * Should check comply.providerApiKey (set by onboarding) first,
   * then the legacy per-provider secret, then env-var fallbacks.
   */
  getApiKey(provider: LlmProviderId): Promise<string | undefined>;
};

export async function createLlmClient(
  secrets: ProviderSecrets
): Promise<{ client: LlmClient | null; provider: LlmProviderId }> {
  const cfg = vscode.workspace.getConfiguration('comply');

  // Prefer the simple onboarding setting if the user explicitly set it.
  // cfg.inspect lets us distinguish a user-supplied value from the package.json default.
  const inspection = cfg.inspect<string>('provider');
  const simpleProvider =
    inspection?.globalValue ?? inspection?.workspaceValue ?? inspection?.workspaceFolderValue;
  const legacyProvider = cfg.get<string>('llm.provider');
  const provider = ((simpleProvider || legacyProvider || 'groq')) as LlmProviderId;

  const timeoutMs = cfg.get<number>('llm.request.timeoutMs') ?? 60000;

  // --- Ollama: no API key needed; always available ---
  if (provider === 'ollama') {
    return {
      client: new OpenAiCompatibleClient({
        id: 'openaiCompatible',
        apiKey: 'ollama', // Ollama ignores the key value
        baseUrl: 'http://localhost:11434/v1',
        timeoutMs,
      }),
      provider,
    };
  }

  const apiKey = await secrets.getApiKey(provider);
  if (!apiKey) {
    return { client: null, provider };
  }

  switch (provider) {
    case 'groq':
      return { client: new GroqClient({ apiKey }), provider };

    case 'openai': {
      const baseUrl = cfg.get<string>('llm.openai.baseUrl') ?? 'https://api.openai.com/v1';
      return {
        client: new OpenAiCompatibleClient({ id: 'openai', apiKey, baseUrl, timeoutMs }),
        provider,
      };
    }

    case 'openaiCompatible': {
      const baseUrl =
        cfg.get<string>('llm.openaiCompatible.baseUrl') ?? 'http://localhost:11434/v1';
      return {
        client: new OpenAiCompatibleClient({ id: 'openaiCompatible', apiKey, baseUrl, timeoutMs }),
        provider,
      };
    }

    case 'anthropic':
      return { client: new AnthropicClient({ apiKey, timeoutMs }), provider };

    case 'gemini':
      return { client: new GeminiClient({ apiKey, timeoutMs }), provider };

    default:
      return { client: null, provider };
  }
}

