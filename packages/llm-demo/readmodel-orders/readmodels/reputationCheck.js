import { getLogger } from '@lazyapps/logger';
import { checkOrderValueSideEffect } from './confirmationRequests.js';
import { llmClient } from '../llm.js';

const log = getLogger('READMODEL', 'REPUTATION');

const VALID_REPUTATIONS = ['good', 'neutral', 'poor'];
const reputationCollectionName = 'orders_reputation';

const buildSystemPrompt = (customerName, orderHistory) =>
  `You are a customer reputation assessment engine for an order management system.

Based on the customer's order history, evaluate their reputation level. Consider:
- Number of successfully confirmed orders (higher = better)
- Order value patterns (consistent, reasonable values = better)
- Any unconfirmed or problematic orders (negative signal)
- Overall ordering pattern (regular, reliable activity = better)

You MUST respond with valid JSON in this exact format:
{
  "reputation": "good" | "neutral" | "poor",
  "reasoning": "Brief explanation of the assessment"
}

The "reputation" field MUST be exactly one of: "good", "neutral", "poor".
No other values are accepted.

Guidelines:
- "good": 3+ confirmed orders with no issues — reliable customer
- "neutral": fewer than 3 orders, or mixed signals — insufficient data
- "poor": unconfirmed orders, suspicious patterns, or red flags

Customer: ${customerName}
Order history (${orderHistory.length} orders):
${JSON.stringify(orderHistory.map((o) => ({ text: o.text, value: o.value, status: o.status })), null, 2)}`;

// -- Side Effect (Pattern B: returns () => Promise) --

export const reputationCheckSideEffect = (
  storage,
  commands,
  changeNotification,
  order,
) =>
  () =>
    // 1. Fetch this customer's order history from own storage
    storage
      .find('orders_overview', { customerId: order.customerId })
      .project({ _id: 0, text: 1, value: 1, status: 1 })
      .toArray()
      .then((orderHistory) => {
        // 2. Build system prompt
        const systemPrompt = buildSystemPrompt(
          order.customerName,
          orderHistory,
        );
        const messages = [
          {
            role: 'user',
            content: `Evaluate the reputation of customer "${order.customerName}" based on their ${orderHistory.length} order(s).`,
          },
        ];

        // 3. Call LLM directly
        return llmClient.jsonCompletion(messages, { systemPrompt });
      })
      .then((result) => {
        // 4. Validate response with fail-safe
        let reputation;
        let reasoning;
        let failSafe;

        if (result.error) {
          log.error(`Reputation parse error: ${result.error}`);
          reputation = 'neutral';
          reasoning =
            'Failed to parse LLM response; defaulting to neutral';
          failSafe = true;
        } else {
          const rawReputation = result.content?.reputation;
          reputation = VALID_REPUTATIONS.includes(rawReputation)
            ? rawReputation
            : 'neutral';
          failSafe = !VALID_REPUTATIONS.includes(rawReputation);
          reasoning =
            result.content?.reasoning || 'No reasoning provided';

          if (failSafe) {
            log.warn(
              `LLM returned unexpected reputation "${rawReputation}" for ${order.customerId}, defaulting to neutral`,
            );
          }
        }

        log.info(
          `Reputation: ${order.customerId} → ${reputation} (${reasoning.substring(0, 80)})`,
        );

        // 5. Map reputation to path
        const path =
          reputation === 'good'
            ? 'AUTO_CONFIRM'
            : reputation === 'poor'
              ? 'ENHANCED_REVIEW'
              : 'STANDARD';

        // 6. Assemble full payload
        const payload = {
          reputation,
          reasoning,
          failSafe,
          orderId: order.id,
          orderValue: order.value,
          customerName: order.customerName,
          path,
        };

        // 7. Fire-and-forget: store reputation via command
        commands
          .execute({
            aggregateName: 'customer',
            aggregateId: order.customerId,
            command: 'UPDATE_CUSTOMER_REPUTATION',
            payload,
          })()
          .catch((err) =>
            log.error(
              `Failed to store reputation for ${order.customerId}: ${err.message}`,
            ),
          );

        // 8. Route order based on path (independent of command above)
        switch (path) {
          case 'AUTO_CONFIRM':
            return commands.execute({
              aggregateName: 'order',
              aggregateId: order.id,
              command: 'CONFIRM',
              payload: {},
            })();

          case 'ENHANCED_REVIEW':
            return commands.execute({
              aggregateName: 'order',
              aggregateId: order.id,
              command: 'REQUIRE_CONFIRMATION',
              payload: {},
            })();

          case 'STANDARD':
          default:
            return checkOrderValueSideEffect(
              commands,
              changeNotification,
              order,
            )();
        }
      });

// -- Read Model --

export default {
  projections: {
    CUSTOMER_REPUTATION_UPDATED: (
      {
        storage,
        changeNotification: { sendChangeNotification, createChangeInfo },
      },
      event,
    ) =>
      storage
        .insertOne(reputationCollectionName, {
          customerId: event.aggregateId,
          customerName: event.payload.customerName,
          reputation: event.payload.reputation,
          reasoning: event.payload.reasoning,
          failSafe: event.payload.failSafe,
          orderId: event.payload.orderId,
          orderValue: event.payload.orderValue,
          path: event.payload.path,
          timestamp: event.timestamp || new Date().toISOString(),
        })
        .then(() =>
          sendChangeNotification(
            createChangeInfo(
              'orders',
              'reputation',
              event.aggregateId,
              'addRow',
              {
                customerId: event.aggregateId,
                customerName: event.payload.customerName,
                reputation: event.payload.reputation,
                reasoning: event.payload.reasoning,
                path: event.payload.path,
              },
            ),
          ),
        ),
  },

  resolvers: {
    all: (storage) =>
      storage
        .find(reputationCollectionName, {})
        .sort({ timestamp: -1 })
        .project({ _id: 0 })
        .toArray(),

    byCustomerId: (storage, { customerId }) =>
      storage
        .find(reputationCollectionName, { customerId })
        .sort({ timestamp: -1 })
        .project({ _id: 0 })
        .toArray(),

    byOrderId: (storage, { orderId }) =>
      storage
        .find(reputationCollectionName, { orderId })
        .project({ _id: 0 })
        .toArray(),
  },
};
