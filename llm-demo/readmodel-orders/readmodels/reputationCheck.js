import { checkOrderValueSideEffect } from './confirmationRequests.js';

const LLM_SERVICE_URL = process.env.LLM_SERVICE_URL || 'http://llm-service';
const reputationCollectionName = 'orders_reputation';

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
      .then((orderHistory) =>
        // 2. Call llm-service for reputation evaluation (R-6.1.3)
        fetch(`${LLM_SERVICE_URL}/api/llm/evaluate-reputation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: order.customerId,
            customerName: order.customerName,
            orderId: order.id,
            orderHistory,
          }),
        }).then((res) => res.json()),
      )
      .then(({ reputation, reasoning, failSafe }) => {
        // 3. Map reputation to pre-defined path (R-6.2.1)
        const path =
          reputation === 'good'
            ? 'AUTO_CONFIRM'
            : reputation === 'poor'
              ? 'ENHANCED_REVIEW'
              : 'STANDARD'; // neutral + fail-safe default (R-6.2.4)

        // 4. Store reputation assessment (R-6.2.5 MANDATORY)
        return storage
          .insertOne(reputationCollectionName, {
            customerId: order.customerId,
            customerName: order.customerName,
            orderId: order.id,
            orderValue: order.value,
            reputation,
            reasoning,
            path,
            failSafe: !!failSafe,
            timestamp: new Date().toISOString(),
          })
          .then(() =>
            // 5. Notify frontend of new reputation record
            changeNotification.sendChangeNotification(
              changeNotification.createChangeInfo(
                'orders',
                'reputation',
                'all',
                'addRow',
                {
                  customerId: order.customerId,
                  customerName: order.customerName,
                  orderId: order.id,
                  reputation,
                  reasoning,
                  path,
                },
              ),
            ),
          )
          .then(() => {
            // 6. Route to pre-defined path (R-6.3.3, R-6.3.4)
            switch (path) {
              case 'AUTO_CONFIRM':
                // Good reputation: skip confirmation entirely (R-6.3.3)
                return commands.execute({
                  aggregateName: 'order',
                  aggregateId: order.id,
                  command: 'CONFIRM',
                  payload: {},
                })(); // ()() pattern: call the thunk

              case 'ENHANCED_REVIEW':
                // Poor reputation: always require confirmation (Decision 3)
                return commands.execute({
                  aggregateName: 'order',
                  aggregateId: order.id,
                  command: 'REQUIRE_CONFIRMATION',
                  payload: {},
                })(); // ()() pattern

              case 'STANDARD':
              default:
                // Neutral / fail-safe: apply existing value threshold
                return checkOrderValueSideEffect(
                  commands,
                  changeNotification,
                  order,
                )(); // ()() pattern: checkOrderValueSideEffect returns thunk
            }
          });
      });

// -- Read Model (resolvers only, no projections) --

export default {
  projections: {},

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
