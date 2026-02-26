import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { getLogger } from '@lazyapps/logger';
import { llmClient } from '$lib/server/llm.js';
import {
  tools,
  executeTool,
  systemPrompt,
  parseResponse,
  transformCommands,
} from '$lib/server/command-generator.js';

export const POST = async ({ request }) => {
  const correlationId = `LLM-${nanoid()}`;
  const log = getLogger('LLM/GenCmd', correlationId);
  const startTime = Date.now();
  const { text, context, conversationHistory } = await request.json();

  if (!text) {
    return json({ error: 'text is required' }, { status: 400 });
  }

  log.info(`Generate commands [${correlationId}]: "${text.substring(0, 80)}"`);

  // conversationHistory contains PREVIOUS messages only — the current user
  // message is in `text` and appended here. The frontend must NOT include the
  // current message in conversationHistory to avoid sending it to the LLM twice.
  const messages = [
    ...(conversationHistory || []).slice(-20),
    { role: 'user', content: text },
  ];

  log.debug(
    `Conversation history: ${(conversationHistory || []).length} messages`,
  );

  try {
    const result = await llmClient.toolCompletion(
      messages,
      tools,
      (name, args) =>
        executeTool(name, args, { ...(context || {}), correlationId }),
      {
        systemPrompt,
        maxIterations: 5,
        toolChoice: 'required',
        correlationId,
      },
    );

    log.debug(
      `Tool completion result: ${result.toolCalls.length} tool calls, content length ${result.content?.length}`,
    );

    const content = parseResponse(result.content);

    const commands = transformCommands(content.commands);

    log.info(
      `Parsed ${commands.length} commands: ${commands.map((c) => c.aggregateName + '/' + c.command).join(', ')}`,
    );

    commands.forEach((c) =>
      log.debug(
        `Command: ${c.aggregateName}/${c.command} aggregate=${c.aggregateId} payload=${JSON.stringify(c.payload).substring(0, 150)}`,
      ),
    );

    const duration = Date.now() - startTime;
    log.info(`Generated ${commands.length} commands in ${duration}ms`);

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
