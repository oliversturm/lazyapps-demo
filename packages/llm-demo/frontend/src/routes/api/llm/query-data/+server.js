import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { getLogger } from '@lazyapps/logger';
import { llmClient } from '$lib/server/llm.js';
import { tools, executeTool, systemPrompt } from '$lib/server/query-data.js';

export const POST = async ({ request }) => {
  const correlationId = `LLM-${nanoid()}`;
  const log = getLogger('LLM/RAG', correlationId);
  const { messages, conversationHistory } = await request.json();

  if (!messages || !Array.isArray(messages)) {
    return json({ error: 'messages array is required' }, { status: 400 });
  }

  log.info(`RAG query [${correlationId}]: ${messages.length} messages`);

  try {
    const fullMessages = [
      ...(conversationHistory || []).slice(-20),
      ...messages,
    ];

    log.debug(
      `Conversation history: ${(conversationHistory || []).length} prior messages`,
    );

    const result = await llmClient.toolCompletion(
      fullMessages,
      tools,
      (name, args) => executeTool(name, args, { correlationId }),
      {
        systemPrompt,
        maxIterations: 5,
        correlationId,
      },
    );

    log.debug(`RAG result: ${result.toolCalls.length} tool calls`);
    log.info(
      `RAG query: ${result.toolCalls.length} tool calls, ${result.duration}ms`,
    );

    return json({
      content: result.content,
      toolCalls: result.toolCalls,
      usage: result.usage,
      duration: result.duration,
    });
  } catch (error) {
    log.error(`RAG query failed: ${error.message}`);
    return json(
      { error: 'Query failed', message: error.message },
      { status: 500 },
    );
  }
};
