import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { getLogger } from '@lazyapps/logger';
import { llmClient } from '$lib/server/llm.js';
import { tools, executeTool, systemPrompt } from '$lib/server/query-data.js';
import {
  trimHistoryToTurns,
  MAX_HISTORY_TURNS,
} from '$lib/server/conversation-history.js';

export const POST = async ({ request }) => {
  const correlationId = `LLM-${nanoid()}`;
  const log = getLogger('LLM/RAG', correlationId);
  const { messages, conversationHistory } = await request.json();

  if (!messages || !Array.isArray(messages)) {
    return json({ error: 'messages array is required' }, { status: 400 });
  }

  log.info(`RAG query [${correlationId}]: ${messages.length} messages`);

  try {
    // History carries complete turns including tool calls and results, so
    // IDs from earlier answers stay available to the model
    const history = trimHistoryToTurns(conversationHistory, MAX_HISTORY_TURNS);
    const fullMessages = [...history, ...messages];

    log.debug(
      `Conversation history: ${Array.isArray(conversationHistory) ? conversationHistory.length : 0} prior messages received, ` +
        `${history.length} kept (max ${MAX_HISTORY_TURNS} turns, ${history.filter((m) => m.role === 'tool').length} tool results)`,
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

    // Return the updated history for the client to send back next turn.
    // Trimmed again so the client-side state stays bounded.
    const updatedHistory = trimHistoryToTurns(
      [...history, ...messages, ...result.messages],
      MAX_HISTORY_TURNS,
    );
    log.debug(
      `Updated history: ${updatedHistory.length} messages (${result.messages.length} added this turn)`,
    );

    return json({
      content: result.content,
      toolCalls: result.toolCalls,
      conversationHistory: updatedHistory,
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
