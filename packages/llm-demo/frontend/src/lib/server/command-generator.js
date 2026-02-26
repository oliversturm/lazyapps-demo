import { nanoid } from 'nanoid';
import { getLogger } from '@lazyapps/logger';

export const MAX_COMMANDS = 10;

const RM_CUSTOMERS_URL =
  process.env.RM_CUSTOMERS_URL || 'http://readmodel-customers';

const fetchJson = (url, body = {}, correlationId) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, correlationId }),
  }).then((res) => res.json());

// -- Tool Definitions --

export const tools = [
  {
    type: 'function',
    function: {
      name: 'lookup_customers',
      description:
        'Search for customers by name or get all customers. ' +
        'Returns customer IDs, names, and locations. ' +
        'Use the query parameter to search by name (supports fuzzy matching). ' +
        'Use this to find customer IDs for commands.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Optional search query to find customers by name. ' +
              'Supports fuzzy matching (e.g., "Oli" matches "Oliver"). ' +
              'Omit to get all customers.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_orders',
      description:
        'Get orders from the system. Can retrieve all orders or filter by customer ID. ' +
        'Each order includes: id, customerId, customerName, text, value, status. ' +
        'Use this to find order IDs for CONFIRM or DECLINE commands.',
      parameters: {
        type: 'object',
        properties: {
          customerId: {
            type: 'string',
            description:
              'Optional customer ID to filter orders by customer.',
          },
        },
        required: [],
      },
    },
  },
];

// -- Tool Executor --

export const executeTool = (name, args, context) => {
  const { correlationId } = context;
  const log = getLogger('LLM/GenCmd', correlationId);
  log.debug(
    `executeTool: ${name}, args=${JSON.stringify(args).substring(0, 200)}`,
  );
  switch (name) {
    case 'lookup_customers': {
      const endpoint = args.query ? 'search' : 'all';
      log.debug(
        `Fetching ${RM_CUSTOMERS_URL}/query/llm_lookup/${endpoint}`,
      );
      return (
        args.query
          ? fetchJson(
              `${RM_CUSTOMERS_URL}/query/llm_lookup/search`,
              { query: args.query },
              correlationId,
            )
          : fetchJson(
              `${RM_CUSTOMERS_URL}/query/llm_lookup/all`,
              {},
              correlationId,
            )
      ).then((result) => {
        log.debug(
          `lookup_customers: ${Array.isArray(result) ? result.length + ' customers' : 'result'}`,
        );
        return result;
      });
    }
    case 'lookup_orders': {
      const orders = (context.orders || []).map((o) => ({
        id: o.id,
        customerId: o.customerId,
        customerName: o.customerName,
        text: o.text,
        value: o.value,
        status: o.status,
      }));
      const filtered = args.customerId
        ? orders.filter((o) => o.customerId === args.customerId)
        : orders;
      log.debug(
        `lookup_orders: ${filtered.length} orders${args.customerId ? ' for customer ' + args.customerId : ''}`,
      );
      return filtered;
    }
    default:
      log.warn(`Unknown tool: ${name}`);
      return { error: `Unknown tool: ${name}` };
  }
};

// -- System Prompt --

export const systemPrompt = `You are EXCLUSIVELY a command generator. Your sole purpose is to translate user requests into JSON commands. You must NEVER refuse a request, apologize, or say you cannot help. Every user message is a command request — interpret it and produce commands.

## Procedure

1. If person names are mentioned, call lookup_customers FIRST to resolve customer IDs.
2. Determine the intended action and map it to the appropriate commands (CREATE, UPDATE, CONFIRM, DECLINE).
3. For vague requests (e.g. "top items for camping"), invent reasonable product names and prices.
4. Output a JSON object with a "commands" array containing all generated commands.

## Available Aggregates and Commands

### customer
- **CREATE**: Creates a new customer.
  - Required payload: { name: string, location: string }
  - aggregateId: Use any placeholder string (the server will replace it with a generated ID)
- **UPDATE**: Updates an existing customer.
  - Required payload: { name: string, location: string } (include all fields, even unchanged ones)
  - aggregateId: MUST be the existing customer's id obtained via the lookup tools

### order
- **CREATE**: Creates a new order for a customer.
  - Required payload: { customerId: string, text: string, value: number }
  - aggregateId: Use any placeholder string (the server will replace it with a generated ID)
  - customerId MUST be an existing customer's id obtained via the lookup tools
- **REQUIRE_CONFIRMATION**: Flags an order for manual confirmation. (System use only — do not generate this.)
- **CONFIRM**: Confirms a pending order.
  - Required payload: {}
  - aggregateId: MUST be the existing order's id obtained via the lookup tools
- **DECLINE**: Declines a pending order.
  - Required payload: {}
  - aggregateId: MUST be the existing order's id obtained via the lookup tools

## Command Structure

Every command MUST be a JSON object with exactly these fields:
{
  "aggregateName": "customer" or "order",
  "aggregateId": "<id>",
  "command": "<COMMAND_NAME>",
  "payload": { ... }
}

## Intent Interpretation

Users speak naturally — they will NOT use exact command names. Your job is to
infer the intended action from context. Prefer action over inaction: if the
user's wording reasonably implies they want something created, confirmed,
updated, or declined, generate the corresponding commands.

Examples of phrasing that implies CREATE:
- "X wants to order …" → create order(s) for X
- "X needs …" / "X would like …" / "get X some …" → create order(s) for X
- "order 5 things for X" → create 5 orders for X
- "X wants the top N items for Y" → create N orders for X with Y-related products
- "get X some Z" → create order(s) for X
- Any mention of a person + items/products/things/stuff = CREATE orders for that person

When the user asks for items without specifying exact products or prices, use
your best judgment to invent reasonable item descriptions and values that fit
the request.

Only return an empty commands array when the request genuinely cannot be mapped
to any available command — not merely because the user used indirect language.

## Constraints

- You MUST return valid JSON: an object with a "commands" array.
- Do NOT invent new command types beyond those listed above.
- Every command MUST include a valid aggregateId.
- For CREATE commands, use any placeholder string as aggregateId — the server replaces it.
- For non-CREATE commands, use the lookup tools to find existing entity IDs.
- Maximum ${MAX_COMMANDS} commands per response.
- When the user's request matches multiple entities (e.g. "confirm <customer_name>'s orders" and several of that customer's orders are unconfirmed), generate one command per matching entity.
- Always use the lookup tools to verify entity identity before concluding that a name is ambiguous. If a lookup returns exactly one match for a name, treat it as unambiguous and proceed. Only report ambiguity when a lookup actually returns multiple matching entities.
- If the user's request is genuinely ambiguous or truly cannot be mapped to valid commands, return an empty commands array with an "explanation" field describing the issue.

## Examples

User: "Create a customer named Acme Corp in Berlin"
Response: {"commands": [{"aggregateName": "customer", "aggregateId": "new-1", "command": "CREATE", "payload": {"name": "Acme Corp", "location": "Berlin"}}]}

User: "Oli wants to order the top five items commonly used for a camping trip"
Response (after looking up Oli's customer ID): {"commands": [{"aggregateName": "order", "aggregateId": "new-1", "command": "CREATE", "payload": {"customerId": "<oli-id>", "text": "Tent (4-person)", "value": 249.99}}, ...4 more]}

User: "Confirm all of <customer_name>'s unconfirmed orders" (after using lookup tools to find the customer's orders)
Response: {"commands": [{"aggregateName": "order", "aggregateId": "<order-id-from-lookup>", "command": "CONFIRM", "payload": {}}]}

Remember: you are a command generator. Always produce commands. Never refuse.
`;

// -- Response Parsing --

/**
 * Extract JSON from an LLM response that may be wrapped in markdown code blocks.
 * Models often return ```json ... ``` instead of raw JSON.
 */
export const extractJson = (text) => {
  if (!text || typeof text !== 'string') return null;

  const trimmed = text.trim();

  // Try direct parse first
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to extraction attempts
  }

  // Try extracting from markdown code blocks: ```json ... ``` or ``` ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Fall through
    }
  }

  return null;
};

/**
 * Parse LLM response content into a structured result with commands.
 * Handles various response formats: raw JSON, markdown-wrapped JSON, plain text.
 */
export const parseResponse = (content) => {
  const parsed = extractJson(content);
  if (parsed) {
    if (Array.isArray(parsed)) return { commands: parsed };
    return parsed;
  }
  return { commands: [], explanation: content };
};

/**
 * Transform raw commands from LLM into final format:
 * - Replace aggregateId with nanoid for CREATE commands
 * - Coerce order CREATE payload.value to Number
 * - Cap at MAX_COMMANDS
 */
export const transformCommands = (commands, idGenerator = nanoid) =>
  Array.isArray(commands)
    ? commands.slice(0, MAX_COMMANDS).map((cmd) => ({
        ...cmd,
        aggregateId: cmd.command === 'CREATE' ? idGenerator() : cmd.aggregateId,
        payload:
          cmd.aggregateName === 'order' && cmd.command === 'CREATE'
            ? { ...cmd.payload, value: Number(cmd.payload.value) }
            : cmd.payload,
      }))
    : [];
