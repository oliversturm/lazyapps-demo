import OpenAI from 'openai';
import { getLogger } from '@lazyapps/logger';

export const createLlmClient = ({ apiKey, baseURL, model }) => {
  const log = getLogger('LLM', 'CLIENT');
  const defaultModel = model || 'gpt-4o';

  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  log.info(
    `LLM client initialized (model: ${defaultModel}, baseURL: ${baseURL || 'default'})`,
  );

  const describeError = (err) => {
    const status = err.status ? `${err.status} ` : '';
    const detail =
      err.error?.detail || err.error?.message || err.message || String(err);
    return `${status}${detail}`;
  };

  // Simple chat completion (no tools)
  const chatCompletion = async (
    messages,
    { systemPrompt, model: modelOverride } = {},
  ) => {
    const fullMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const startTime = Date.now();
    let response;
    try {
      response = await client.chat.completions.create({
        model: modelOverride || defaultModel,
        messages: fullMessages,
      });
    } catch (err) {
      const desc = describeError(err);
      log.error(`Chat completion failed: ${desc}`);
      throw new Error(`Chat completion failed: ${desc}`);
    }
    const duration = Date.now() - startTime;
    const usage = response.usage;

    log.debug(
      `Chat completion: ${duration}ms, ${usage?.total_tokens || '?'} tokens`,
    );

    return {
      content: response.choices[0].message.content,
      usage,
      duration,
    };
  };

  // Chat completion with structured JSON response
  const jsonCompletion = async (
    messages,
    { systemPrompt, model: modelOverride } = {},
  ) => {
    const fullMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const startTime = Date.now();
    let response;
    try {
      response = await client.chat.completions.create({
        model: modelOverride || defaultModel,
        messages: fullMessages,
        response_format: { type: 'json_object' },
      });
    } catch (err) {
      const desc = describeError(err);
      log.error(`JSON completion failed: ${desc}`);
      throw new Error(`JSON completion failed: ${desc}`);
    }
    const duration = Date.now() - startTime;
    const usage = response.usage;

    log.debug(
      `JSON completion: ${duration}ms, ${usage?.total_tokens || '?'} tokens`,
    );

    const content = response.choices[0].message.content;
    try {
      return { content: JSON.parse(content), usage, duration };
    } catch (e) {
      log.error(`Failed to parse JSON response: ${content}`);
      return {
        content: null,
        error: 'Invalid JSON from LLM',
        raw: content,
        usage,
        duration,
      };
    }
  };

  // Chat completion with tool calling (agent loop)
  const toolCompletion = async (
    messages,
    tools,
    executeToolFn,
    { systemPrompt, model: modelOverride, maxIterations = 5 } = {},
  ) => {
    const fullMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : [...messages];

    let totalTokens = 0;
    const startTime = Date.now();
    const toolCalls = []; // track for transparency

    for (let i = 0; i < maxIterations; i++) {
      let response;
      try {
        response = await client.chat.completions.create({
          model: modelOverride || defaultModel,
          messages: fullMessages,
          tools,
        });
      } catch (err) {
        const desc = describeError(err);
        log.error(`Tool completion failed: ${desc}`);
        throw new Error(`Tool completion failed: ${desc}`);
      }

      totalTokens += response.usage?.total_tokens || 0;
      const { finish_reason, message } = response.choices[0];

      if (finish_reason !== 'tool_calls' || !message.tool_calls) {
        return {
          content: message.content,
          toolCalls,
          usage: { total_tokens: totalTokens },
          duration: Date.now() - startTime,
        };
      }

      // Execute tool calls — construct a fully clean assistant message to
      // avoid provider-specific extra fields (e.g. reasoning_content,
      // name: null) that some APIs reject on the follow-up request.
      // Deep-clone tool_calls to sever any reference to SDK response objects.
      const cleanToolCalls = message.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
      const assistantMessage = { role: 'assistant', tool_calls: cleanToolCalls };
      if (message.content) assistantMessage.content = message.content;
      fullMessages.push(assistantMessage);
      for (const toolCall of message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeToolFn(toolCall.function.name, args);
        toolCalls.push({ name: toolCall.function.name, args, result });
        fullMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    return {
      content: 'Max tool iterations reached',
      toolCalls,
      usage: { total_tokens: totalTokens },
      duration: Date.now() - startTime,
    };
  };

  // Streaming chat completion (for Phase H SSE)
  const streamCompletion = async function* (
    messages,
    { systemPrompt, model: modelOverride } = {},
  ) {
    const fullMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    let stream;
    try {
      stream = await client.chat.completions.create({
        model: modelOverride || defaultModel,
        messages: fullMessages,
        stream: true,
      });
    } catch (err) {
      const desc = describeError(err);
      log.error(`Stream completion failed: ${desc}`);
      throw new Error(`Stream completion failed: ${desc}`);
    }

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  };

  return {
    chatCompletion,
    jsonCompletion,
    toolCompletion,
    streamCompletion,
  };
};
