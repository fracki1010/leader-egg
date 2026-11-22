import { env } from '../../config/env.js';
import { AppError } from '../../middleware/error-handler.js';

/**
 * Minimal OpenAI-compatible chat-completions client.
 *
 * Only the shapes the assistant loop needs are modelled. Provider responses are
 * never forwarded to the client or persisted, and error messages are fixed
 * strings — the API key and the raw provider body must never leak.
 */

export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ProviderToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ProviderAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ProviderToolCall[];
}

export interface ProviderToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ProviderResponseChoice {
  message?: ProviderAssistantMessage;
  finish_reason?: string;
}

interface ProviderResponse {
  choices?: ProviderResponseChoice[];
}

const NOT_CONFIGURED_MESSAGE = 'El asistente no está configurado';
const SATURATED_MESSAGE = 'El asistente está saturado, intentá en un minuto';
const NO_RESPONSE_MESSAGE = 'El asistente no respondió, intentá de nuevo';

/** True when an API key is configured; the feature is inert otherwise. */
export const isAgentEnabled = (): boolean => Boolean(env.AGENT_API_KEY);

const endpointUrl = (): string => `${env.AGENT_BASE_URL.replace(/\/+$/, '')}/chat/completions`;

/**
 * Sends one chat-completions turn and returns the first assistant message.
 *
 * Error mapping (all details swallowed on purpose):
 *  - missing key / 401 / 403 → 503 "not configured"
 *  - 429                     → 429 "saturated"
 *  - timeout / network / 5xx → 503 "did not respond"
 */
const postCompletion = async (
  apiKey: string,
  messages: ProviderMessage[],
  tools: ProviderToolDefinition[]
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AGENT_TIMEOUT_MS);
  try {
    return await fetch(endpointUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: env.AGENT_MODEL,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: env.AGENT_MAX_TOKENS,
        ...(env.AGENT_REASONING_EFFORT ? { reasoning_effort: env.AGENT_REASONING_EFFORT } : {})
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

export const callProvider = async (
  messages: ProviderMessage[],
  tools: ProviderToolDefinition[]
): Promise<ProviderAssistantMessage> => {
  const apiKey = env.AGENT_API_KEY;
  if (!apiKey) {
    throw new AppError(NOT_CONFIGURED_MESSAGE, 503);
  }

  let response: Response;
  try {
    // No automatic retry: free tiers count rejected attempts against TPM too,
    // so retrying immediately makes the next minute worse. The API returns a
    // clear 429 and the user retries after the window resets.
    response = await postCompletion(apiKey, messages, tools);
  } catch {
    // Covers AbortError (timeout) and network failures alike.
    throw new AppError(NO_RESPONSE_MESSAGE, 503);
  }

  if (!response.ok) {
    // Server-side diagnostics only (never forwarded, never includes the key).
    try {
      const detail = (await response.text()).slice(0, 300);
      console.error(`[agent] provider error ${response.status}: ${detail}`);
    } catch {
      // Body already consumed/unreadable — the mapped error below still applies.
    }
    if (response.status === 429) {
      throw new AppError(SATURATED_MESSAGE, 429);
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppError(NOT_CONFIGURED_MESSAGE, 503);
    }
    throw new AppError(NO_RESPONSE_MESSAGE, 503);
  }

  let payload: ProviderResponse;
  try {
    payload = (await response.json()) as ProviderResponse;
  } catch {
    throw new AppError(NO_RESPONSE_MESSAGE, 503);
  }

  const message = payload.choices?.[0]?.message;
  if (!message) {
    throw new AppError(NO_RESPONSE_MESSAGE, 503);
  }

  return {
    role: 'assistant',
    content: message.content ?? null,
    tool_calls: message.tool_calls
  };
};
