import { getLogger } from '@lazyapps/logger';
import { llmClient } from '../llm.js';
import { ordersCollectionName } from './overview.js';

const VALID_REPUTATIONS = ['good', 'neutral', 'poor'];
const reputationCollectionName = 'orders_reputation';

const buildSystemPrompt = (customerName, orderHistory) =>
  `You are a customer reputation assessment engine for an order management system.

Based on the customer's order history, evaluate their reputation level. Consider:
- Number of successfully confirmed orders (higher = better)
- Order value patterns (consistent, reasonable values = better)
- Any declined orders (strong negative signal)
- Overall ordering pattern (regular, reliable activity = better)

You MUST respond with valid JSON in this exact format:
{
  "reputation": "good" | "neutral" | "poor",
  "reasoning": "Brief explanation of the assessment"
}

The "reputation" field MUST be exactly one of: "good", "neutral", "poor".
No other values are accepted.

Guidelines:
- "good": Multiple confirmed orders with no declines — reliable customer. Manual confirmation (order went through human review and was approved) is an especially strong positive signal.
- "neutral": Few orders, or mixed signals — insufficient data to assess
- "poor": Declined orders (strong negative signal — order was reviewed and rejected by a human), suspicious patterns, or red flags
- Note: "unconfirmed" orders are simply in the review queue — this is not inherently negative.

Customer: ${customerName}
Order history (${orderHistory.length} orders):
${JSON.stringify(orderHistory.map((o) => ({ text: o.text, value: o.value, status: o.status })))}`;

const reputationToPath = (reputation) =>
  reputation === 'good'
    ? 'AUTO_CONFIRM'
    : reputation === 'poor'
      ? 'ENHANCED_REVIEW'
      : 'STANDARD';

const reputationToThreshold = (reputation) =>
  reputation === 'good'
    ? 5000
    : reputation === 'poor'
      ? 0
      : 1000;

// Background LLM reputation update with change detection — fire-and-forget.
const updateReputationInBackground = (
  storage,
  commands,
  order,
  correlationId,
  triggerEvent,
) => {
  const log = getLogger('LLM/Repute', correlationId);
  log.info(
    `Reputation check triggered by ${triggerEvent} for customer ${order.customerId}, order ${order.id}, value=$${order.value}`,
  );

  storage
    .find(ordersCollectionName, { customerId: order.customerId })
    .project({ _id: 0, text: 1, value: 1, status: 1 })
    .toArray()
    .then((orderHistory) => {
      log.debug(
        `Order history: ${orderHistory.length} orders for customer ${order.customerId}`,
      );
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
      log.debug(
        `Requesting reputation assessment, prompt length=${systemPrompt.length}`,
      );
      return llmClient.jsonCompletion(messages, {
        systemPrompt,
        correlationId,
      });
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

      log.debug(
        `Reputation result: ${reputation} — ${reasoning.substring(0, 100)}`,
      );

      // Change detection: only send UPDATE if reputation actually changed
      return storage
        .find(reputationCollectionName, { customerId: order.customerId })
        .sort({ timestamp: -1 })
        .limit(1)
        .project({ _id: 0, reputation: 1, reasoning: 1 })
        .toArray()
        .then(([existing]) => {
          if (
            existing &&
            existing.reputation === reputation &&
            existing.reasoning === reasoning
          ) {
            log.info(
              `Reputation unchanged for ${order.customerId} (${reputation}), skipping update`,
            );
            return;
          }

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

          log.info(
            `Reputation update: ${order.customerId} → ${reputation} (path=${path})`,
          );

          return commands
            .execute({
              aggregateName: 'customer',
              aggregateId: order.customerId,
              command: 'UPDATE_CUSTOMER_REPUTATION',
              payload,
            })();
        });
    })
    .catch((err) =>
      log.error(
        `Background reputation update failed for ${order.customerId}: ${err.message}`,
      ),
    );
};

// -- Side Effect: Reputation Routing (Pattern B: returns () => Promise) --
//
// Route the order immediately using stored reputation and threshold-based
// comparison. No LLM call — fast synchronous lookup only.

export const reputationRoutingSideEffect = (storage, commands, order) =>
  (correlationId) => {
    const log = getLogger('RM/ReputeRoute', correlationId);
    log.info(
      `Reputation routing triggered by ORDER_CREATED for order ${order.id}, customer ${order.customerId}, value=$${order.value}`,
    );
    return storage
      .find(reputationCollectionName, { customerId: order.customerId })
      .sort({ timestamp: -1 })
      .limit(1)
      .project({ _id: 0, reputation: 1 })
      .toArray()
      .then(([existing]) => {
        const reputation =
          existing && VALID_REPUTATIONS.includes(existing.reputation)
            ? existing.reputation
            : 'unknown';
        const threshold = reputationToThreshold(reputation);
        const command =
          order.value <= threshold ? 'CONFIRM' : 'REQUIRE_CONFIRMATION';

        log.info(
          `Routing order ${order.id}: reputation=${reputation}, threshold=$${threshold}, value=$${order.value} → ${command}`,
        );

        return commands.execute({
          aggregateName: 'order',
          aggregateId: order.id,
          command,
          payload: {},
        })();
      });
  };

// -- Side Effect: Reputation Reassessment (Pattern B: returns () => Promise) --
//
// Triggered on ORDER_CONFIRMED and ORDER_DECLINED. Fetches order data from
// storage, then fires background LLM reputation update.

export const reputationReassessmentSideEffect = (
  storage,
  commands,
  aggregateId,
  triggerEvent,
) =>
  (correlationId) => {
    const log = getLogger('RM/ReputeReassess', correlationId);
    log.info(
      `Reputation reassessment triggered by ${triggerEvent} for order ${aggregateId}`,
    );
    return storage
      .find(ordersCollectionName, { id: aggregateId })
      .toArray()
      .then(([order]) => {
        if (!order) {
          log.warn(
            `Cannot reassess reputation: order ${aggregateId} not found`,
          );
          return;
        }
        updateReputationInBackground(
          storage,
          commands,
          order,
          correlationId,
          triggerEvent,
        );
      });
  };

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
          id: `${event.aggregateId}-${event.payload.orderId}-${event.timestamp || Date.now()}`,
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
                id: `${event.aggregateId}-${event.payload.orderId}-${event.timestamp || Date.now()}`,
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
