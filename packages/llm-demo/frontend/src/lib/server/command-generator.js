import { nanoid } from 'nanoid';

export const MAX_COMMANDS = 10;

// -- Tool Definitions --

export const tools = [
  {
    type: 'function',
    function: {
      name: 'lookup_customers',
      description:
        'Get the list of all customers with their IDs, names, and locations. ' +
        'Use this to find customer IDs for UPDATE commands or to find customerId for CREATE order commands.',
      parameters: { type: 'object', properties: {}, required: [] },
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
  switch (name) {
    case 'lookup_customers':
      return (context.customers || []).map((c) => ({
        id: c.id,
        name: c.name,
        location: c.location,
      }));
    case 'lookup_orders': {
      const orders = (context.orders || []).map((o) => ({
        id: o.id,
        customerId: o.customerId,
        customerName: o.customerName,
        text: o.text,
        value: o.value,
        status: o.status,
      }));
      return args.customerId
        ? orders.filter((o) => o.customerId === args.customerId)
        : orders;
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
};

// -- System Prompt --

export const systemPrompt = `You are a command generator for a LazyApps event-sourced application.

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

## Constraints

- You MUST return valid JSON: an object with a "commands" array.
- Do NOT invent new command types beyond those listed above.
- Every command MUST include a valid aggregateId.
- For CREATE commands, use any placeholder string as aggregateId — the server replaces it.
- For non-CREATE commands, use the lookup tools to find existing entity IDs.
- Maximum ${MAX_COMMANDS} commands per response.
- When the user's request matches multiple entities (e.g. "confirm Oli's orders" and several of Oli's orders are unconfirmed), generate one command per matching entity.
- If the user's request is ambiguous or you cannot map it to valid commands, return an empty commands array with an "explanation" field describing the issue.

## Examples

User: "Create a customer named Acme Corp in Berlin"
Response: {"commands": [{"aggregateName": "customer", "aggregateId": "new-1", "command": "CREATE", "payload": {"name": "Acme Corp", "location": "Berlin"}}]}

User: "Confirm all of Oli's unconfirmed orders" (after using lookup tools to find Oli's orders)
Response: {"commands": [{"aggregateName": "order", "aggregateId": "<order-id-from-lookup>", "command": "CONFIRM", "payload": {}}]}
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
