import { json } from '@sveltejs/kit';
import { getLogger } from '@lazyapps/logger';
import { llmClient } from '$lib/server/llm.js';

const RM_CUSTOMERS_URL =
  process.env.RM_CUSTOMERS_URL || 'http://readmodel-customers';
const RM_ORDERS_URL =
  process.env.RM_ORDERS_URL || 'http://readmodel-orders';

// -- Tool Definitions --

const tools = [
  {
    type: 'function',
    function: {
      name: 'query_customers',
      description:
        'Get the list of all customers with their names and IDs. ' +
        'Use this to look up customer information or to find a customer by name.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_orders',
      description:
        'Get orders from the system. Can retrieve all orders or filter ' +
        'by a specific customer ID. Each order includes: id, customerId, ' +
        'customerName, text (item description), value (amount), and status.',
      parameters: {
        type: 'object',
        properties: {
          customerId: {
            type: 'string',
            description:
              'Optional customer ID (UUID) to filter orders. ' +
              'If omitted, returns all orders.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_order_stats',
      description:
        'Get aggregated order statistics: total count, total value, ' +
        'average value, and counts by status. Use this for summary ' +
        'questions about order volume, revenue, or status distribution.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

// -- Tool Executor --

const fetchJson = (url, body = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((res) => res.json());

const executeTool = async (name, args) => {
  switch (name) {
    case 'query_customers':
      return fetchJson(`${RM_CUSTOMERS_URL}/query/overview/all`);

    case 'query_orders': {
      if (args.customerId) {
        const allOrders = await fetchJson(
          `${RM_ORDERS_URL}/query/overview/all`,
        );
        return allOrders.filter((o) => o.customerId === args.customerId);
      }
      return fetchJson(`${RM_ORDERS_URL}/query/overview/all`);
    }

    case 'query_order_stats': {
      const orders = await fetchJson(`${RM_ORDERS_URL}/query/overview/all`);
      const totalValue = orders.reduce((sum, o) => sum + (o.value || 0), 0);
      return {
        totalOrders: orders.length,
        totalValue,
        averageValue: orders.length
          ? Math.round((totalValue / orders.length) * 100) / 100
          : 0,
        byStatus: orders.reduce((acc, o) => {
          acc[o.status] = (acc[o.status] || 0) + 1;
          return acc;
        }, {}),
        topCustomers: Object.entries(
          orders.reduce((acc, o) => {
            if (!acc[o.customerName])
              acc[o.customerName] = { count: 0, value: 0 };
            acc[o.customerName].count++;
            acc[o.customerName].value += o.value || 0;
            return acc;
          }, {}),
        )
          .map(([name, stats]) => ({ name, ...stats }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5),
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
};

// -- System Prompt --

const systemPrompt = `You are a customer service assistant for an order management system.
Answer questions about customers and orders using the available tools.

IMPORTANT RULES:
- Always base your answers on actual data from the tools. Do NOT guess or make up data.
- If you cannot answer from available data, say so clearly.
- Use query_customers to look up customer information.
- Use query_orders to look up specific orders or all orders. You can filter by customerId.
- Use query_order_stats for summary statistics about orders.
- You may call multiple tools if needed to answer a complex question.
- Format your answers clearly. Use bullet points or tables where helpful.
- When referring to monetary values, format them as currency (e.g., $1,234.56).
- When referring to customers, include their name.`;

// -- Route Handler --

const log = getLogger('LLM', 'RAG');

export const POST = async ({ request }) => {
  const { messages, conversationHistory } = await request.json();

  if (!messages || !Array.isArray(messages)) {
    return json({ error: 'messages array is required' }, { status: 400 });
  }

  try {
    // Combine conversation history with new messages
    const fullMessages = [...(conversationHistory || []), ...messages];

    const result = await llmClient.toolCompletion(
      fullMessages,
      tools,
      executeTool,
      { systemPrompt, maxIterations: 5 },
    );

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
