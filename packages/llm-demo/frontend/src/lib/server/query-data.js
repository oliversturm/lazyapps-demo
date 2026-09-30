import { computeOrderStats } from './computeOrderStats.js';
import { getLogger } from '@lazyapps/logger';

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
              'Optional customer ID to filter orders. Must be copied exactly ' +
              'from the "id" field of a query_customers result (or the ' +
              '"customerId" field of an order or topCustomers entry). IDs are ' +
              'opaque strings — never construct, guess or reformat one. If you ' +
              "only know the customer's name, call query_customers first. " +
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
        'average value, counts by status, and the top customers by total ' +
        'order value (each with customerId, name, order count and value). ' +
        'Use this for summary questions about order volume, revenue, ' +
        'status distribution, or best customers.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];

// -- Tool Executor --

const fetchJson = (url, body = {}, correlationId) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, correlationId }),
  }).then((res) => res.json());

export const executeTool = async (name, args, { correlationId } = {}) => {
  const log = getLogger('LLM/RAG', correlationId);
  log.debug(
    `executeTool: ${name}, args=${JSON.stringify(args).substring(0, 200)}`,
  );
  switch (name) {
    case 'query_customers':
      log.debug(`Fetching ${RM_CUSTOMERS_URL}/query/llm_lookup/all`);
      return fetchJson(
        `${RM_CUSTOMERS_URL}/query/llm_lookup/all`,
        {},
        correlationId,
      ).then((result) => {
        log.debug(`query_customers: ${result.length} customers`);
        return result;
      });

    case 'query_orders': {
      log.debug(
        `Fetching ${RM_ORDERS_URL}/query/overview/all${args.customerId ? ' (filtering by ' + args.customerId + ')' : ''}`,
      );
      if (args.customerId) {
        // Validate the ID against the customer list: an unknown ID must not
        // look like "customer has no orders" to the model
        log.debug(
          `Validating customerId ${args.customerId} against ${RM_CUSTOMERS_URL}/query/llm_lookup/all`,
        );
        const [customers, allOrders] = await Promise.all([
          fetchJson(
            `${RM_CUSTOMERS_URL}/query/llm_lookup/all`,
            {},
            correlationId,
          ),
          fetchJson(`${RM_ORDERS_URL}/query/overview/all`, {}, correlationId),
        ]);
        if (!customers.some((c) => c.id === args.customerId)) {
          log.warn(
            `query_orders: unknown customerId "${args.customerId}" (${customers.length} customers known) — returning error to model`,
          );
          return {
            error:
              `Unknown customerId "${args.customerId}". No customer with this ID exists. ` +
              'IDs must be copied exactly from tool results — never constructed or guessed. ' +
              "Call query_customers to look up the customer's ID by name, then retry.",
          };
        }
        const filtered = allOrders.filter(
          (o) => o.customerId === args.customerId,
        );
        log.debug(
          `query_orders: ${filtered.length} orders for known customer ${args.customerId}`,
        );
        return filtered;
      }
      return fetchJson(
        `${RM_ORDERS_URL}/query/overview/all`,
        {},
        correlationId,
      ).then((result) => {
        log.debug(`query_orders: ${result.length} orders`);
        return result;
      });
    }

    case 'query_order_stats': {
      log.debug(
        `Fetching ${RM_ORDERS_URL}/query/overview/all for stats computation`,
      );
      const orders = await fetchJson(
        `${RM_ORDERS_URL}/query/overview/all`,
        {},
        correlationId,
      );
      log.debug(`query_order_stats: computed from ${orders.length} orders`);
      return computeOrderStats(orders);
    }

    default:
      log.warn(`Unknown tool: ${name}`);
      return { error: `Unknown tool: ${name}` };
  }
};

// -- System Prompt --

export const systemPrompt = `You are a customer service assistant for an order management system.
Answer questions about customers and orders using the available tools.
You handle both direct data queries AND analytical/advisory questions.

IMPORTANT RULES:
- Always use the tools to retrieve real data before answering. Do NOT guess or make up data.
- IDs (customer IDs, order IDs) are opaque values. Only use an ID that appears verbatim in a tool result in this conversation. Never construct, guess or reformat an ID. If you only know a customer's name (for example from an earlier answer), call query_customers to look up their ID first.
- Only say you cannot answer if the tools return no relevant data at all. If you have ANY data that relates to the question, analyze it and provide your best answer.
- You are authorized to ANALYZE data and provide business insights. When asked about trends, recommendations, or patterns, retrieve the relevant data and reason about it. Your analysis of real data IS a valid answer.
- Use query_customers for customer information (returns id, name, and location).
- Use query_orders for order details (filter by customerId optional). Each order has: customerId, customerName, text (product description), value (price), status.
- Use query_order_stats for summary statistics about orders, including topCustomers (customerId, name, order count, total value).
- Call multiple tools if needed to answer a complex question.
- Format your answers clearly. Use bullet points or tables where helpful.
- When referring to monetary values, format them as currency (e.g., $1,234.56).
- When referring to customers, include their name.

EXAMPLES OF ANALYTICAL REASONING:
- "What products should we sell?" → Call query_orders, analyze product descriptions in the text field, identify popular categories and price ranges, suggest complementary items based on patterns.
- "Who are our most valuable customers?" → Call query_order_stats and use topCustomers (which includes each customer's ID), or call query_orders and rank customers by total order value.
- "What trends do you see?" → Call query_orders and query_order_stats, look for patterns in product types, order values, statuses, and customer activity.`;
