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

const reputationToPath = (reputation) =>
  reputation === 'good'
    ? 'AUTO_CONFIRM'
    : reputation === 'poor'
      ? 'ENHANCED_REVIEW'
      : 'STANDARD';

const routeOrder = (commands, changeNotification, order, path) => {
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
};

// Background LLM reputation update — fire-and-forget, never blocks
// order routing.
const updateReputationInBackground = (storage, commands, order) => {
  storage
    .find('orders_overview', { customerId: order.customerId })
    .project({ _id: 0, text: 1, value: 1, status: 1 })
    .toArray()
    .then((orderHistory) => {
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
      return llmClient.jsonCompletion(messages, { systemPrompt });
    })
    .then((result) => {
      let reputation;
      let reasoning;
      let failSafe;

      if (result.error) {
        log.error(`Reputation parse error: ${result.error}`);
        reputation = 'neutral';
        reasoning = 'Failed to parse LLM response; defaulting to neutral';
        failSafe = true;
      } else {
        const rawReputation = result.content?.reputation;
        reputation = VALID_REPUTATIONS.includes(rawReputation)
          ? rawReputation
          : 'neutral';
        failSafe = !VALID_REPUTATIONS.includes(rawReputation);
        reasoning = result.content?.reasoning || 'No reasoning provided';

        if (failSafe) {
          log.warn(
            `LLM returned unexpected reputation "${rawReputation}" for ${order.customerId}, defaulting to neutral`,
          );
        }
      }

      log.info(
        `Reputation: ${order.customerId} → ${reputation} (${reasoning.substring(0, 80)})`,
      );

      const path = reputationToPath(reputation);
      const payload = {
        reputation,
        reasoning,
        failSafe,
        orderId: order.id,
        orderValue: order.value,
        customerName: order.customerName,
        path,
      };

      return commands
        .execute({
          aggregateName: 'customer',
          aggregateId: order.customerId,
          command: 'UPDATE_CUSTOMER_REPUTATION',
          payload,
        })();
    })
    .catch((err) =>
      log.error(
        `Background reputation update failed for ${order.customerId}: ${err.message}`,
      ),
    );
};

// -- Side Effect (Pattern B: returns () => Promise) --
//
// Route the order immediately using stored reputation (or value-based
// fallback if no prior assessment exists). The LLM reputation update
// runs in the background so order routing is never blocked by LLM
// latency.

export const reputationCheckSideEffect = (
  storage,
  commands,
  changeNotification,
  order,
) =>
  () =>
    // 1. Look up the most recent stored reputation for this customer
    storage
      .find(reputationCollectionName, { customerId: order.customerId })
      .sort({ timestamp: -1 })
      .limit(1)
      .project({ _id: 0, reputation: 1 })
      .toArray()
      .then(([existing]) => {
        // 2. Fire LLM reputation update in background (never awaited)
        updateReputationInBackground(storage, commands, order);

        // 3. Route the order immediately
        if (existing && VALID_REPUTATIONS.includes(existing.reputation)) {
          const path = reputationToPath(existing.reputation);
          log.info(
            `Routing order ${order.id} via stored reputation: ${existing.reputation} → ${path}`,
          );
          return routeOrder(commands, changeNotification, order, path);
        }

        // No prior reputation — fall back to standard value-based routing
        log.info(
          `No stored reputation for ${order.customerId}, using value-based routing`,
        );
        return routeOrder(
          commands,
          changeNotification,
          order,
          'STANDARD',
        );
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
              'all',
              'addRow',
              {
                customerId: event.aggregateId,
                customerName: event.payload.customerName,
                reputation: event.payload.reputation,
                reasoning: event.payload.reasoning,
                failSafe: event.payload.failSafe,
                orderId: event.payload.orderId,
                orderValue: event.payload.orderValue,
                path: event.payload.path,
                timestamp: event.timestamp || new Date().toISOString(),
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
