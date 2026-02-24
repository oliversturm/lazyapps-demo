import { json } from '@sveltejs/kit';
import { getLogger } from '@lazyapps/logger';
import { llmClient } from '$lib/server/llm.js';
import {
  tools,
  executeTool,
  systemPrompt,
  parseResponse,
  transformCommands,
} from '$lib/server/command-generator.js';

const log = getLogger('LLM', 'GEN-CMD');

export const POST = async ({ request }) => {
  const { text, context, conversationHistory } = await request.json();

  if (!text) {
    return json({ error: 'text is required' }, { status: 400 });
  }

  const messages = [
    ...(conversationHistory || []).slice(-20),
    { role: 'user', content: text },
  ];

  try {
    const result = await llmClient.toolCompletion(
      messages,
      tools,
      (name, args) => executeTool(name, args, context || {}),
      { systemPrompt, maxIterations: 5 },
    );

    log.info(
      `[DEBUG] toolCompletion result.content type=${typeof result.content}, value=${JSON.stringify(result.content)?.substring(0, 200)}`,
    );
    log.info(
      `[DEBUG] toolCalls=${JSON.stringify(result.toolCalls?.map(tc => tc.name))}`,
    );

    const content = parseResponse(result.content);

    log.info(
      `[DEBUG] parseResponse result: commands=${content.commands?.length ?? 'undefined'}, explanation=${content.explanation?.substring(0, 100) ?? 'none'}`,
    );

    const commands = transformCommands(content.commands);

    log.info(
      `Generated ${commands.length} commands for: "${text.substring(0, 80)}"`,
    );

    return json({
      commands,
      explanation: content.explanation || null,
      toolCalls: result.toolCalls,
      usage: result.usage,
      duration: result.duration,
    });
  } catch (error) {
    log.error(`Generate commands failed: ${error.message}`);
    return json(
      { error: 'Command generation failed', message: error.message },
      { status: 500 },
    );
  }
};
