import { createLlmClient } from './llm-client.js';
import { createMockClient } from './mock-client.js';

export const llmClient =
  process.env.LLM_MOCK === 'true'
    ? createMockClient()
    : createLlmClient({
        apiKey: process.env.LLM_API_KEY,
        baseURL: process.env.LLM_BASE_URL,
        model: process.env.LLM_MODEL || 'gpt-4o',
      });
