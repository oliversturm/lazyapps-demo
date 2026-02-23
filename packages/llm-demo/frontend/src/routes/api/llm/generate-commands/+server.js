import { json } from '@sveltejs/kit';
import { getLogger } from '@lazyapps/logger';
import { llmClient } from '$lib/server/llm.js';

const MAX_COMMANDS = 10;

const buildSystemPrompt = (
  context,
) => `You are a command generator for a LazyApps event-sourced application.

## Available Aggregates and Commands

### customer
- **CREATE**: Creates a new customer.
  - Required payload: { name: string, location: string }
  - aggregateId: You MUST generate a new UUID (format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
- **UPDATE**: Updates an existing customer.
  - Required payload: { name: string, location: string } (include all fields, even unchanged ones)
  - aggregateId: MUST be the existing customer's id from the context data below

### order
- **CREATE**: Creates a new order for a customer.
  - Required payload: { customerId: string, text: string, value: number }
  - aggregateId: You MUST generate a new UUID
  - customerId MUST be an existing customer's id from the context data below
- **REQUIRE_CONFIRMATION**: Flags an order for manual confirmation. (System use only — do not generate this.)
- **CONFIRM**: Confirms a pending order.
  - Required payload: {}
  - aggregateId: MUST be the existing order's id from the context data below

## Command Structure

Every command MUST be a JSON object with exactly these fields:
{
  "aggregateName": "customer" or "order",
  "aggregateId": "<uuid>",
  "command": "<COMMAND_NAME>",
  "payload": { ... }
}

## Constraints

- You MUST return valid JSON: an object with a "commands" array.
- Do NOT invent new command types beyond those listed above.
- Every command MUST include a valid aggregateId.
- For CREATE commands, generate a fresh UUID v4 for aggregateId.
- For non-CREATE commands, use the id of an existing entity from the context data.
- Maximum ${MAX_COMMANDS} commands per response.
- If the user's request is ambiguous or you cannot map it to valid commands, return an empty commands array with an "explanation" field describing the issue.

## Current Data Context

${context.page === 'customers' ? `### Customers\n${JSON.stringify(context.customers || [], null, 2)}` : ''}
${context.page === 'orders' || context.page === 'customers' ? `### Orders\n${JSON.stringify(context.orders || [], null, 2)}` : ''}

## Examples

User: "Create a customer named Acme Corp in Berlin"
Response: {"commands": [{"aggregateName": "customer", "aggregateId": "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5", "command": "CREATE", "payload": {"name": "Acme Corp", "location": "Berlin"}}]}

User: "Place an order for office supplies worth 500 for Acme Corp" (where Acme Corp has id "abc-123")
Response: {"commands": [{"aggregateName": "order", "aggregateId": "f6e5d4c3-b2a1-4098-7654-321fedcba987", "command": "CREATE", "payload": {"customerId": "abc-123", "text": "Office supplies", "value": 500}}]}
`;

const log = getLogger('LLM', 'GEN-CMD');

export const POST = async ({ request }) => {
  const { text, context, conversationHistory } = await request.json();

  if (!text) {
    return json({ error: 'text is required' }, { status: 400 });
  }

  const systemPrompt = buildSystemPrompt(context || {});
  const messages = [
    ...(conversationHistory || []),
    { role: 'user', content: text },
  ];

  try {
    const result = await llmClient.jsonCompletion(messages, {
      systemPrompt,
    });

    if (result.error) {
      log.error(`JSON parse error: ${result.error}`);
      return json({
        commands: [],
        explanation: 'Failed to parse LLM response as JSON',
        raw: result.raw,
        usage: result.usage,
        duration: result.duration,
      });
    }

    const content = result.content;
    const commands = Array.isArray(content.commands)
      ? content.commands.slice(0, MAX_COMMANDS)
      : [];

    log.info(
      `Generated ${commands.length} commands for: "${text.substring(0, 80)}"`,
    );

    return json({
      commands,
      explanation: content.explanation || null,
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
