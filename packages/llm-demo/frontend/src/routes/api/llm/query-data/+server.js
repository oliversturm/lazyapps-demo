import { json } from '@sveltejs/kit';
import { getLogger } from '@lazyapps/logger';
import { llmClient } from '$lib/server/llm.js';
import { tools, executeTool, systemPrompt } from '$lib/server/query-data.js';

// -- Route Handler --

const log = getLogger('LLM', 'RAG');

export const POST = async ({ request }) => {
	const { messages, conversationHistory } = await request.json();

	if (!messages || !Array.isArray(messages)) {
		return json({ error: 'messages array is required' }, { status: 400 });
	}

	try {
		// Combine conversation history with new messages
		const fullMessages = [...(conversationHistory || []).slice(-20), ...messages];

		const result = await llmClient.toolCompletion(fullMessages, tools, executeTool, {
			systemPrompt,
			maxIterations: 5
		});

		log.info(`RAG query: ${result.toolCalls.length} tool calls, ${result.duration}ms`);

		return json({
			content: result.content,
			toolCalls: result.toolCalls,
			usage: result.usage,
			duration: result.duration
		});
	} catch (error) {
		log.error(`RAG query failed: ${error.message}`);
		return json({ error: 'Query failed', message: error.message }, { status: 500 });
	}
};
