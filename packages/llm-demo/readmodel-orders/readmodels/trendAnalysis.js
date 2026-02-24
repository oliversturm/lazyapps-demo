import { getLogger } from '@lazyapps/logger';
import { llmClient } from '../llm.js';

const log = getLogger('READMODEL', 'TRENDS');

const analysisCollectionName = 'orders_trend_analysis';
const ANALYSIS_THRESHOLD = 3; // minimum orders to trigger analysis

const buildPotentialIssuesPrompt = (customer, orders, allOrders) =>
  `You are a risk assessment system for order patterns.

Analyze these orders for potential issues: many expensive orders in a short
timeframe, unusual patterns, spending spikes, or other anomalies.
Rate the overall risk level.

IMPORTANT: You are ONLY assessing risk. You do NOT have the authority to
block, cancel, or modify any orders or customer accounts. Domain logic will
decide what action to take based on your assessment.

You MUST respond with valid JSON in this exact format:
{
  "riskLevel": "low" | "medium" | "high",
  "issues": [
    { "type": "spending-spike|velocity|unusual-pattern", "description": "What was detected", "evidence": "Specific data points" }
  ],
  "summary": "Brief overall assessment"
}

${
  customer
    ? `Customer: ${customer.name}
Customer orders (${orders.length}):
${JSON.stringify(orders.map((o) => ({ id: o.id, text: o.text, value: o.value, status: o.status })), null, 2)}`
    : ''
}

${
  allOrders.length > 0
    ? `All recent orders across customers (${allOrders.length}):
${JSON.stringify(allOrders.slice(0, 100).map((o) => ({ id: o.id, customerId: o.customerId, customerName: o.customerName, text: o.text, value: o.value, status: o.status })), null, 2)}`
    : ''
}`;

// Called as side effect from overview.js on ORDER_CREATED
// Pattern B: returns () => Promise (thunk)
export const trendAnalysisSideEffect = (
  storage,
  commands,
  changeNotification,
  customerId,
  customerName,
) =>
  () =>
    // 1. Count recent orders for this customer
    storage
      .find('orders_overview', { customerId })
      .toArray()
      .then((orders) => {
        if (orders.length < ANALYSIS_THRESHOLD) return null;

        // 2. Fetch all orders for cross-customer analysis
        return storage
          .find('orders_overview', {})
          .toArray()
          .then((allOrders) => {
            // 3. Build prompt
            const customer = { name: customerName };
            const systemPrompt = buildPotentialIssuesPrompt(
              customer,
              orders,
              allOrders,
            );
            const messages = [
              {
                role: 'user',
                content: `Assess risk for customer "${customerName}" based on their ordering patterns.`,
              },
            ];

            // 4. Call LLM directly
            return llmClient
              .jsonCompletion(messages, { systemPrompt })
              .then((result) => {
                if (result.error) {
                  log.error(`Analysis parse error: ${result.error}`);
                  return null;
                }

                log.info(
                  `Analysis complete: potential-issues for customer ${customerId}`,
                );

                // 5. Assemble payload and send command
                const payload = {
                  analysisType: 'potential-issues',
                  result: result.content,
                  customerName,
                  orderCount: orders.length,
                  trigger: 'event-driven',
                };

                return commands
                  .execute({
                    aggregateName: 'customer',
                    aggregateId: customerId,
                    command: 'RECORD_TREND_ANALYSIS',
                    payload,
                  })();
              })
              .catch((err) =>
                log.error(
                  `Background trend analysis failed for ${customerId}: ${err.message}`,
                ),
              );
          });
      });

export default {
  projections: {
    CUSTOMER_TREND_ANALYZED: (
      {
        storage,
        changeNotification: { sendChangeNotification, createChangeInfo },
      },
      event,
    ) =>
      storage
        .insertOne(analysisCollectionName, {
          customerId: event.aggregateId,
          customerName: event.payload.customerName,
          analysisType: event.payload.analysisType,
          result: event.payload.result,
          orderCount: event.payload.orderCount,
          trigger: event.payload.trigger,
          timestamp: event.timestamp || new Date().toISOString(),
        })
        .then(() =>
          sendChangeNotification(
            createChangeInfo(
              'orders',
              'trendAnalysis',
              event.aggregateId,
              'addRow',
              {
                customerId: event.aggregateId,
                customerName: event.payload.customerName,
                analysisType: event.payload.analysisType,
                result: event.payload.result,
              },
            ),
          ),
        ),
  },

  resolvers: {
    all: (storage) =>
      storage
        .find(analysisCollectionName, {})
        .sort({ timestamp: -1 })
        .project({ _id: 0 })
        .toArray(),
    byCustomerId: (storage, { customerId }) =>
      storage
        .find(analysisCollectionName, { customerId })
        .sort({ timestamp: -1 })
        .project({ _id: 0 })
        .toArray(),
  },
};
