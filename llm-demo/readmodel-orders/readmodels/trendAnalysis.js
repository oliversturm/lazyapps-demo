const analysisCollectionName = 'orders_trend_analysis';
const LLM_SERVICE_URL =
  process.env.LLM_SERVICE_URL || 'http://llm-service';
const ANALYSIS_THRESHOLD = 3; // minimum orders to trigger analysis

// Called as side effect from overview.js on ORDER_CREATED
export const trendAnalysisSideEffect = (
  storage,
  changeNotification,
  customerId,
  customerName,
) =>
  // 1. Count recent orders for this customer
  storage
    .find('orders_overview', { customerId })
    .toArray()
    .then((orders) => {
      if (orders.length < ANALYSIS_THRESHOLD) return null;

      // 2. Call llm-service for analysis
      return fetch(`${LLM_SERVICE_URL}/api/llm/analyze-trends`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisType: 'potential-issues',
          customerId,
        }),
      })
        .then((res) => res.json())
        .then((analysis) => {
          // 3. Store analysis result
          const record = {
            customerId,
            customerName,
            analysisType: 'potential-issues',
            result: analysis.result,
            timestamp: new Date().toISOString(),
            trigger: 'event-driven',
          };

          return storage
            .insertOne(analysisCollectionName, record)
            .then(() =>
              // 4. Notify frontend
              changeNotification.sendChangeNotification(
                changeNotification.createChangeInfo(
                  'orders',
                  'trendAnalysis',
                  'all',
                  'addRow',
                  record,
                ),
              ),
            );
        });
    });

export default {
  // No projections — populated by the side effect in overview.js
  projections: {},

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
