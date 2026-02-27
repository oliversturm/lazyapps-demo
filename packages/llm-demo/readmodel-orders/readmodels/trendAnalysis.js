import { getLogger } from '@lazyapps/logger';
import { llmClient } from '../llm.js';
import { ordersCollectionName } from './overview.js';

const analysisCollectionName = 'orders_trend_analysis';
const ANALYSIS_THRESHOLD = 3; // minimum orders to trigger analysis

const buildPotentialIssuesPrompt = (customer, orders, allOrders, trigger) =>
  `You are a risk assessment system for order patterns.

Analyze these orders for potential issues: many expensive orders in a short
timeframe, unusual patterns, spending spikes, or other anomalies.
Rate the overall risk level.

Consider order outcomes when assessing risk:
- "confirmed" orders: manually reviewed and approved — positive signal
- "declined" orders: manually reviewed and rejected — strong negative signal
- "new" or "unconfirmed" orders: pending review — neutral
A pattern of declined orders is a much stronger risk signal than many new orders.

IMPORTANT: You are ONLY assessing risk. You do NOT have the authority to
block, cancel, or modify any orders or customer accounts. Domain logic will
decide what action to take based on your assessment.

You MUST respond with valid JSON in this exact format:
{
  "riskLevel": "low" | "medium" | "high",
  "riskScore": <number 0-100>,
  "issues": [
    { "type": "spending-spike|velocity|unusual-pattern", "description": "What was detected", "evidence": "Specific data points" }
  ],
  "summary": "Brief overall assessment"
}

The riskScore is a numeric value from 0 (no risk) to 100 (extreme risk).
Guidelines: 0-33 corresponds to "low", 34-66 to "medium", 67-100 to "high".
The riskScore should be more granular than riskLevel — two "medium" assessments
can have different scores (e.g., 35 vs 60).

This analysis was triggered by: ${trigger}

${
  customer
    ? `Customer: ${customer.name}
Customer orders (${orders.length}):
${JSON.stringify(orders.map((o) => ({ text: o.text, value: o.value, status: o.status })))}`
    : ''
}

${
  allOrders.length > 0
    ? `All recent orders across customers (${allOrders.length}):
${JSON.stringify(allOrders.slice(0, 50).map((o) => ({ customerId: o.customerId, customerName: o.customerName, text: o.text, value: o.value, status: o.status })))}`
    : ''
}`;

const validateRiskScore = (raw) => {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(100, Math.round(raw)));
};

// Core trend analysis logic shared by both side effects
const runTrendAnalysis = (
  storage,
  commands,
  customerId,
  customerName,
  triggerEvent,
  correlationId,
) => {
  const log = getLogger('LLM/Trend', correlationId);
  return storage
    .find(ordersCollectionName, { customerId })
    .toArray()
    .then((orders) => {
      if (orders.length < ANALYSIS_THRESHOLD) {
        log.debug(
          `Skipping: ${orders.length} orders < threshold ${ANALYSIS_THRESHOLD}`,
        );
        return null;
      }

      // Fetch all orders for cross-customer analysis
      return storage
        .find(ordersCollectionName, {})
        .toArray()
        .then((allOrders) => {
          log.debug(
            `Analysis data: ${orders.length} customer orders, ${allOrders.length} total orders`,
          );

          const customer = { name: customerName };
          const systemPrompt = buildPotentialIssuesPrompt(
            customer,
            orders,
            allOrders,
            triggerEvent,
          );
          const messages = [
            {
              role: 'user',
              content: `Assess risk for customer "${customerName}" based on their ordering patterns.`,
            },
          ];

          log.debug(
            `Requesting trend analysis, prompt length=${systemPrompt.length}`,
          );

          return llmClient
            .jsonCompletion(messages, { systemPrompt, correlationId })
            .then((result) => {
              if (result.error) {
                log.error(`Analysis parse error: ${result.error}`);
                return null;
              }

              const riskScore = validateRiskScore(
                result.content?.riskScore,
              );

              log.debug(
                `Analysis result: riskLevel=${result.content?.riskLevel}, riskScore=${riskScore}, issues=${result.content?.issues?.length}`,
              );

              const payload = {
                analysisType: 'potential-issues',
                result: { ...result.content, riskScore },
                customerName,
                orderCount: orders.length,
                trigger: triggerEvent,
              };

              log.info(
                `Trend analysis complete: customer=${customerId}, risk=${result.content?.riskLevel}, score=${riskScore}`,
              );

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
};

// Called as side effect from overview.js on ORDER_CREATED
// Pattern B: returns () => Promise (thunk)
export const trendAnalysisSideEffect = (
  storage,
  commands,
  customerId,
  customerName,
) =>
  (correlationId) => {
    const log = getLogger('LLM/TrendBG', correlationId);
    log.info(
      `Trend analysis triggered by ORDER_CREATED for customer ${customerId} (${customerName})`,
    );
    return runTrendAnalysis(
      storage,
      commands,
      customerId,
      customerName,
      'ORDER_CREATED',
      correlationId,
    );
  };

// Triggered on ORDER_CONFIRMED and ORDER_DECLINED.
// Looks up order to get customer context, then runs trend analysis.
// Pattern B: returns () => Promise (thunk)
export const trendReanalysisSideEffect = (
  storage,
  commands,
  aggregateId,
  triggerEvent,
) =>
  (correlationId) => {
    const log = getLogger('LLM/TrendReassess', correlationId);
    log.info(
      `Trend reanalysis triggered by ${triggerEvent} for order ${aggregateId}`,
    );
    return storage
      .find(ordersCollectionName, { id: aggregateId })
      .toArray()
      .then(([order]) => {
        if (!order) {
          log.warn(
            `Cannot reanalyze trends: order ${aggregateId} not found`,
          );
          return;
        }
        return runTrendAnalysis(
          storage,
          commands,
          order.customerId,
          order.customerName,
          triggerEvent,
          correlationId,
        );
      });
  };

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
          riskScore: event.payload.result?.riskScore ?? null,
          orderCount: event.payload.orderCount,
          trigger: event.payload.trigger,
          timestamp: event.timestamp || new Date().toISOString(),
        })
        .then(() =>
          sendChangeNotification(
            createChangeInfo(
              'orders',
              'trendAnalysis',
              'all',
              'addRow',
              {
                customerId: event.aggregateId,
                customerName: event.payload.customerName,
                analysisType: event.payload.analysisType,
                result: event.payload.result,
                riskScore: event.payload.result?.riskScore ?? null,
                orderCount: event.payload.orderCount,
                trigger: event.payload.trigger,
                timestamp: event.timestamp || new Date().toISOString(),
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

export const __testing__ = { validateRiskScore, runTrendAnalysis };
