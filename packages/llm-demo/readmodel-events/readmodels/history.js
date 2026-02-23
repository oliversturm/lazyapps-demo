const eventHistoryCollectionName = 'eventHistory';

// Explicit list of event types to project (Decision 4)
const eventTypes = [
  'CUSTOMER_CREATED',
  'CUSTOMER_UPDATED',
  'CUSTOMER_REPUTATION_UPDATED',
  'CUSTOMER_TREND_ANALYZED',
  'ORDER_CREATED',
  'ORDER_CONFIRMED',
  'ORDER_CONFIRMATION_REQUIRED',
];

// Shared generic handler — all event types get the same treatment
const genericProjection = ({ storage }, event) =>
  storage.insertOne(eventHistoryCollectionName, {
    aggregateId: event.aggregateId,
    aggregateName: event.aggregateName,
    type: event.type,
    payload: event.payload,
    timestamp: event.timestamp,
  });

export default {
  projections: Object.fromEntries(
    eventTypes.map((type) => [type, genericProjection]),
  ),

  resolvers: {
    byAggregateId: (storage, { aggregateId }) =>
      storage
        .find(eventHistoryCollectionName, { aggregateId })
        .sort({ timestamp: 1 })
        .project({ _id: 0 })
        .toArray(),

    byType: (storage, { type }) =>
      storage
        .find(eventHistoryCollectionName, { type })
        .sort({ timestamp: 1 })
        .project({ _id: 0 })
        .toArray(),

    all: (storage) =>
      storage
        .find(eventHistoryCollectionName, {})
        .sort({ timestamp: -1 })
        .limit(100)
        .project({ _id: 0 })
        .toArray(),
  },
};
