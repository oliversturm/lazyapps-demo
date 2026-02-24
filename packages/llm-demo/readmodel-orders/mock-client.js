import { getLogger } from '@lazyapps/logger';

export const createMockClient = () => {
  const log = getLogger('LLM', 'MOCK');

  const mockResponse = (content) => ({
    content,
    usage: { total_tokens: 42, prompt_tokens: 30, completion_tokens: 12 },
    duration: 50,
  });

  const chatCompletion = async (messages, { systemPrompt } = {}) => {
    const lastMessage = messages[messages.length - 1]?.content || '';
    log.debug(`Mock chat: "${lastMessage.substring(0, 80)}..."`);
    return mockResponse(
      `[Mock] Response to: ${lastMessage.substring(0, 100)}`,
    );
  };

  const jsonCompletion = async (messages, { systemPrompt } = {}) => {
    const lastMessage = messages[messages.length - 1]?.content || '';
    log.debug(`Mock JSON: "${lastMessage.substring(0, 80)}..."`);

    // Route-aware mock responses based on system prompt content
    // Note: command generator now uses toolCompletion on the frontend, not jsonCompletion

    if (systemPrompt?.includes('reputation')) {
      // Count confirmed orders in the system prompt
      const confirmedMatches = systemPrompt.match(/"status":\s*"confirmed"/g);
      const confirmedCount = confirmedMatches ? confirmedMatches.length : 0;

      // Check for unconfirmed orders (handle both compact and pretty-printed JSON)
      const hasUnconfirmed = /\"status\":\s*\"unconfirmed\"/.test(systemPrompt);

      if (confirmedCount >= 3 && !hasUnconfirmed) {
        return mockResponse({
          reputation: 'good',
          reasoning: `Mock: Customer has ${confirmedCount} confirmed orders with no issues — reliable ordering pattern.`,
        });
      }

      if (hasUnconfirmed) {
        return mockResponse({
          reputation: 'poor',
          reasoning:
            'Mock: Customer has unconfirmed orders requiring attention.',
        });
      }

      return mockResponse({
        reputation: 'neutral',
        reasoning: `Mock: Customer has ${confirmedCount} confirmed order(s) — insufficient history for positive assessment.`,
      });
    }

    if (
      systemPrompt?.includes('product recommendation') ||
      systemPrompt?.includes('suggest')
    ) {
      return mockResponse({
        suggestions: [
          {
            product: 'Office Chair',
            reasoning: 'Customer orders office supplies frequently',
          },
          {
            product: 'Desk Lamp',
            reasoning: 'Complements previous desk purchases',
          },
          {
            product: 'Monitor Stand',
            reasoning: 'Common accessory for monitor buyers',
          },
        ],
      });
    }

    if (
      systemPrompt?.includes('risk assessment') ||
      systemPrompt?.includes('potential issues')
    ) {
      return mockResponse({
        riskLevel: 'medium',
        issues: [
          {
            type: 'velocity',
            description: 'Multiple orders in short timeframe',
            evidence: '3 orders in last 10 minutes',
          },
        ],
        summary: 'Moderate ordering velocity detected',
      });
    }

    if (
      systemPrompt?.includes('anomaly detection') ||
      systemPrompt?.includes('erroneous')
    ) {
      return mockResponse({
        flags: [],
        summary: 'No anomalies detected in recent orders',
      });
    }

    if (
      systemPrompt?.includes('interest analysis') ||
      systemPrompt?.includes('ad targeting')
    ) {
      return mockResponse({
        interests: [
          {
            category: 'Office Equipment',
            confidence: 0.9,
            evidence: '5 of 7 orders are office-related',
          },
          {
            category: 'Technology',
            confidence: 0.7,
            evidence: 'Multiple monitor and laptop orders',
          },
        ],
      });
    }

    if (systemPrompt?.includes('event history explainer')) {
      return mockResponse({
        explanation:
          'This customer was created and then placed several orders. ' +
          'After accumulating 3 confirmed orders, their reputation was assessed as "good", ' +
          'which meant subsequent orders were auto-confirmed via the AUTO_CONFIRM path.',
        keyEvents: [
          {
            type: 'CUSTOMER_CREATED',
            timestamp: new Date(Date.now() - 3600000).toISOString(),
            significance: 'Customer account created',
          },
          {
            type: 'ORDER_CONFIRMED',
            timestamp: new Date(Date.now() - 1800000).toISOString(),
            significance:
              'Third order confirmed, establishing good reputation',
          },
        ],
        summary:
          'Customer has good reputation based on consistent confirmed orders.',
      });
    }

    return mockResponse({ message: 'Mock JSON response' });
  };

  const toolCompletion = async (
    messages,
    tools,
    executeToolFn,
    opts = {},
  ) => {
    const lastMessage = messages[messages.length - 1]?.content || '';
    log.debug(`Mock tool: "${lastMessage.substring(0, 80)}..."`);

    const toolCalls = [];

    // Determine which tools to call based on the question
    const lowerMsg = lastMessage.toLowerCase();

    if (
      lowerMsg.includes('customer') ||
      lowerMsg.includes('best') ||
      lowerMsg.includes('who')
    ) {
      const result = await executeToolFn('query_customers', {});
      toolCalls.push({ name: 'query_customers', args: {}, result });
    }

    if (
      lowerMsg.includes('order') ||
      lowerMsg.includes('popular') ||
      lowerMsg.includes('today') ||
      lowerMsg.includes('recent')
    ) {
      const result = await executeToolFn('query_orders', {});
      toolCalls.push({ name: 'query_orders', args: {}, result });
    }

    if (
      lowerMsg.includes('stats') ||
      lowerMsg.includes('total') ||
      lowerMsg.includes('how many') ||
      lowerMsg.includes('revenue')
    ) {
      const result = await executeToolFn('query_order_stats', {});
      toolCalls.push({ name: 'query_order_stats', args: {}, result });
    }

    // If no tools matched, call all
    if (toolCalls.length === 0) {
      for (const tool of tools) {
        const result = await executeToolFn(tool.function.name, {});
        toolCalls.push({ name: tool.function.name, args: {}, result });
      }
    }

    // Generate mock answer summarizing tool results
    const summary = toolCalls
      .map(
        (tc) =>
          `[${tc.name}]: ${Array.isArray(tc.result) ? tc.result.length + ' records' : JSON.stringify(tc.result).substring(0, 100)}`,
      )
      .join('; ');

    return {
      ...mockResponse(
        `[Mock] Based on the data (${summary}), here is a summary of the results.`,
      ),
      toolCalls,
    };
  };

  const streamCompletion = async function* (messages, opts = {}) {
    const words =
      '[Mock] This is a streaming response from the mock LLM client.'.split(
        ' ',
      );
    for (const word of words) {
      await new Promise((r) => setTimeout(r, 50));
      yield word + ' ';
    }
  };

  log.info('Mock LLM client initialized');

  return {
    chatCompletion,
    jsonCompletion,
    toolCompletion,
    streamCompletion,
  };
};
