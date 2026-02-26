import { computeOrderStats } from './computeOrderStats.js';

const RM_CUSTOMERS_URL =
  process.env.RM_CUSTOMERS_URL || 'http://readmodel-customers';
const RM_ORDERS_URL =
  process.env.RM_ORDERS_URL || 'http://readmodel-orders';

// -- Tool Definitions --

export const tools = [
  {
    type: 'function',
    function: {
      name: 'query_customers',
      description:
        'Get the list of all customers with their IDs, names, and locations. ' +
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

export const executeTool = async (name, args) => {
  switch (name) {
    case 'query_customers':
      return fetchJson(`${RM_CUSTOMERS_URL}/query/llm_lookup/all`);

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
      const orders = await fetchJson(
        `${RM_ORDERS_URL}/query/overview/all`,
      );
      return computeOrderStats(orders);
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
};

// -- System Prompt --

export const systemPrompt = `You are a customer service assistant for an order management system.
Answer questions about customers and orders using the available tools.
You handle both direct data queries AND analytical/advisory questions.

IMPORTANT RULES:
- Always use the tools to retrieve real data before answering. Do NOT guess or make up data.
- Only say you cannot answer if the tools return no relevant data at all. If you have ANY data that relates to the question, analyze it and provide your best answer.
- You are authorized to ANALYZE data and provide business insights. When asked about trends, recommendations, or patterns, retrieve the relevant data and reason about it. Your analysis of real data IS a valid answer.
- Use query_customers for customer information (returns id, name, and location).
- Use query_orders for order details (filter by customerId optional). Each order has: customerName, text (product description), value (price), status.
- Use query_order_stats for summary statistics about orders.
- Call multiple tools if needed to answer a complex question.
- Format your answers clearly. Use bullet points or tables where helpful.
- When referring to monetary values, format them as currency (e.g., $1,234.56).
- When referring to customers, include their name.

EXAMPLES OF ANALYTICAL REASONING:
- "What products should we sell?" → Call query_orders, analyze product descriptions in the text field, identify popular categories and price ranges, suggest complementary items based on patterns.
- "Who are our most valuable customers?" → Call query_order_stats or query_orders, analyze spending patterns, rank customers by total order value.
- "What trends do you see?" → Call query_orders and query_order_stats, look for patterns in product types, order values, statuses, and customer activity.`;
