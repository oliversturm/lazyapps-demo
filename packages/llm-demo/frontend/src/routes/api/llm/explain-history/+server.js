import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { getLogger } from '@lazyapps/logger';
import { llmClient } from '$lib/server/llm.js';

const RM_EVENTS_URL = process.env.RM_EVENTS_URL || 'http://readmodel-events';
const RM_ORDERS_URL = process.env.RM_ORDERS_URL || 'http://readmodel-orders';
const RM_CUSTOMERS_URL =
  process.env.RM_CUSTOMERS_URL || 'http://readmodel-customers';

// Fetch event history for an aggregate
const fetchEventHistory = (aggregateId, correlationId) =>
  fetch(`${RM_EVENTS_URL}/query/history/byAggregateId`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aggregateId, correlationId }),
  }).then((res) => res.json());

// Fetch reputation records for a customer
const fetchReputationByCustomer = (customerId, correlationId) =>
  fetch(`${RM_ORDERS_URL}/query/reputation/byCustomerId`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId, correlationId }),
  }).then((res) => res.json());

// Fetch reputation records for an order
const fetchReputationByOrder = (orderId, correlationId) =>
  fetch(`${RM_ORDERS_URL}/query/reputation/byOrderId`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, correlationId }),
  }).then((res) => res.json());

// Fetch customer details
const fetchCustomer = (customerId, correlationId) =>
  fetch(`${RM_CUSTOMERS_URL}/query/editing/byId`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: customerId, correlationId }),
  })
    .then((res) => res.json())
    .then((items) => items[0] || null);

// Fetch related events for an order's customer
const fetchRelatedCustomerEvents = (customerId, correlationId) =>
  fetch(`${RM_EVENTS_URL}/query/history/byAggregateId`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aggregateId: customerId, correlationId }),
  }).then((res) => res.json());

const buildSystemPrompt = (events, reputationRecords, entityLabel) =>
  `You are an event history explainer for an order management system. Your job
is to explain WHY something happened by examining the event stream and any
associated reputation assessments.

The event stream is the ground truth — every state change in the system is
recorded as an event. Explain the causal chain: what events occurred, in what
order, and how they led to the current state.

If reputation assessments are available, explain how the LLM-based reputation
evaluation influenced the order confirmation path. The three paths are:
- AUTO_CONFIRM (good reputation): order confirmed immediately
- STANDARD (neutral reputation): value threshold applied (>$1000 requires confirmation)
- ENHANCED_REVIEW (poor reputation): always requires confirmation

Provide your explanation as a clear narrative. Reference specific events and
their timestamps. If you're unsure about something, say so rather than guessing.

You MUST respond with valid JSON in this exact format:
{
  "explanation": "Narrative explanation text...",
  "keyEvents": [
    { "type": "EVENT_TYPE", "timestamp": "...", "significance": "Why this event matters" }
  ],
  "summary": "One-sentence summary"
}

Entity: ${entityLabel}

Event history (${events.length} events, chronological):
${JSON.stringify(events)}

${reputationRecords.length > 0 ? `Reputation assessments (${reputationRecords.length} records):\n${JSON.stringify(reputationRecords)}` : 'No reputation assessments available for this entity.'}`;

export const POST = async ({ request }) => {
  const correlationId = `LLM-${nanoid()}`;
  const log = getLogger('LLM/Explain', correlationId);
  const startTime = Date.now();
  const { aggregateId, aggregateName, question, conversationHistory } =
    await request.json();

  if (!aggregateId) {
    return json({ error: 'aggregateId is required' }, { status: 400 });
  }

  log.info(
    `Explain history [${correlationId}]: ${aggregateName || 'entity'} ${aggregateId}`,
  );

  try {
    // 1. Fetch event history for the aggregate
    const events = await fetchEventHistory(aggregateId, correlationId);

    log.debug(`Fetched ${(events || []).length} events for ${aggregateId}`);

    if (!events || events.length === 0) {
      log.info(
        `No events found for ${aggregateName || 'entity'} ${aggregateId}`,
      );
      return json({
        events: [],
        reputation: [],
        explanation: `No events found for ${aggregateName || 'entity'} ${aggregateId}.`,
        keyEvents: [],
        summary: 'No history available.',
      });
    }

    // 2. Fetch reputation data based on aggregate type
    let reputationRecords = [];
    let entityLabel = `${aggregateName || 'entity'} ${aggregateId}`;

    if (aggregateName === 'customer') {
      reputationRecords = await fetchReputationByCustomer(
        aggregateId,
        correlationId,
      );
      const customer = await fetchCustomer(aggregateId, correlationId);
      if (customer) entityLabel = `customer "${customer.name}"`;
    } else if (aggregateName === 'order') {
      reputationRecords = await fetchReputationByOrder(
        aggregateId,
        correlationId,
      );
      // Also fetch the customer's events for context
      const orderCreated = events.find((e) => e.type === 'ORDER_CREATED');
      if (orderCreated?.payload?.customerId) {
        const customerEvents = await fetchRelatedCustomerEvents(
          orderCreated.payload.customerId,
          correlationId,
        );
        log.debug(
          `Merged ${customerEvents.length} related customer events`,
        );
        // Merge customer events for full context
        events.push(
          ...customerEvents.map((e) => ({
            ...e,
            _context: 'related-customer',
          })),
        );
        events.sort(
          (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
        );
      }
    }

    log.debug(`Fetched ${reputationRecords.length} reputation records`);

    // 3. Build prompt and call LLM
    const promptEvents = events
      .slice(-50)
      .map(({ type, payload, timestamp, aggregateId, aggregateName }) => ({
        type,
        payload,
        timestamp,
        aggregateId,
        aggregateName,
      }));
    const systemPrompt = buildSystemPrompt(
      promptEvents,
      reputationRecords,
      entityLabel,
    );
    const messages = [
      ...(conversationHistory || []).slice(-20),
      {
        role: 'user',
        content: question || `Explain the history of ${entityLabel}.`,
      },
    ];

    const result = await llmClient.jsonCompletion(messages, {
      systemPrompt,
      correlationId,
    });

    if (result.error) {
      log.error(`Explain history parse error: ${result.error}`);
      return json({
        events,
        reputation: reputationRecords,
        explanation: 'Failed to generate explanation.',
        keyEvents: [],
        summary: 'Explanation unavailable.',
        usage: result.usage,
        duration: result.duration,
      });
    }

    log.debug(
      `Explanation: summary="${result.content?.summary?.substring(0, 100)}", keyEvents=${result.content?.keyEvents?.length}`,
    );

    const duration = Date.now() - startTime;
    log.info(
      `Explanation generated for ${aggregateName || 'entity'} ${aggregateId}, ${duration}ms`,
    );

    return json({
      events,
      reputation: reputationRecords,
      explanation:
        result.content?.explanation || 'No explanation generated.',
      keyEvents: result.content?.keyEvents || [],
      summary: result.content?.summary || '',
      usage: result.usage,
      duration: result.duration,
    });
  } catch (error) {
    log.error(`Explain history failed: ${error.message}`);
    return json(
      { error: 'Explanation failed', message: error.message },
      { status: 500 },
    );
  }
};
