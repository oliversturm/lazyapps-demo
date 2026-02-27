import { json } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { getLogger } from '@lazyapps/logger';
import { llmClient } from '$lib/server/llm.js';

const RM_CUSTOMERS_URL =
  process.env.RM_CUSTOMERS_URL || 'http://readmodel-customers';
const RM_ORDERS_URL =
  process.env.RM_ORDERS_URL || 'http://readmodel-orders';

// Fetch customer data from readmodel-customers
const fetchCustomer = (customerId, correlationId) =>
  fetch(`${RM_CUSTOMERS_URL}/query/editing/byId`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: customerId, correlationId }),
  })
    .then((res) => res.json())
    .then((items) => items[0] || null);

// Fetch orders for a customer from readmodel-orders
const fetchOrdersByCustomer = (customerId, correlationId) =>
  fetch(`${RM_ORDERS_URL}/query/overview/ordersByCustomerId`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId, correlationId }),
  }).then((res) => res.json());

// Fetch all orders (for cross-customer analysis)
const fetchAllOrders = (correlationId) =>
  fetch(`${RM_ORDERS_URL}/query/overview/all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correlationId }),
  }).then((res) => res.json());

const validateRiskScore = (raw) => {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(100, Math.round(raw)));
};

const ANALYSIS_PROMPTS = {
  'product-suggestions': {
    needsAllOrders: false,
    buildPrompt: (customer, orders) =>
      `You are a product recommendation engine analyzing customer ordering patterns.

Given a customer's order history, suggest 3-5 products they might be interested in.
Explain why each suggestion fits their ordering patterns.

You MUST respond with valid JSON in this exact format:
{
  "suggestions": [
    { "product": "Product name", "reasoning": "Why this fits their pattern" }
  ]
}

Customer: ${customer.name} (${customer.location || 'location unknown'})
Order history (${orders.length} orders):
${JSON.stringify(orders.map((o) => ({ text: o.text, value: o.value, status: o.status })))}`,

    userMessage: (customer) =>
      `Suggest products for customer "${customer.name}" based on their order history.`,
  },

  'interest-range': {
    needsAllOrders: false,
    buildPrompt: (customer, orders) =>
      `You are a customer interest analysis engine for ad targeting.

Analyze this customer's ordering patterns and categorize their interests.
Return interest categories with confidence scores (0.0-1.0) and evidence.

You MUST respond with valid JSON in this exact format:
{
  "interests": [
    { "category": "Category name", "confidence": 0.85, "evidence": "Based on..." }
  ]
}

Customer: ${customer.name} (${customer.location || 'location unknown'})
Order history (${orders.length} orders):
${JSON.stringify(orders.map((o) => ({ text: o.text, value: o.value, status: o.status })))}`,

    userMessage: (customer) =>
      `Categorize interests for customer "${customer.name}" for ad targeting.`,
  },

  'erroneous-orders': {
    needsAllOrders: false,
    buildPrompt: (customer, orders) =>
      `You are an order anomaly detection system.

Review these recent orders and flag any that appear to be duplicates, errors,
or accidental submissions. Look for: same or very similar items ordered in a
short timeframe, identical values, or other suspicious patterns.

IMPORTANT: You are ONLY flagging potential issues. You do NOT have the authority
to delete, cancel, or modify any orders. A human will review your findings.

You MUST respond with valid JSON in this exact format:
{
  "flags": [
    { "orderId": "id", "issue": "duplicate|error|suspicious", "explanation": "Why this looks wrong" }
  ],
  "summary": "Brief overall assessment"
}

If no issues are found, return: { "flags": [], "summary": "No issues detected" }

Customer: ${customer.name}
Recent orders:
${JSON.stringify(orders.map((o) => ({ id: o.id, text: o.text, value: o.value, status: o.status })))}`,

    userMessage: (customer) =>
      `Review recent orders for customer "${customer.name}" for potential errors or duplicates.`,
  },

  'potential-issues': {
    needsAllOrders: true,
    buildPrompt: (customer, orders, allOrders) =>
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
}`,

    userMessage: (customer) =>
      customer
        ? `Assess risk for customer "${customer.name}" based on their ordering patterns.`
        : 'Assess risk across all recent orders.',
  },
};

export const POST = async ({ request }) => {
  const correlationId = `LLM-${nanoid()}`;
  const log = getLogger('LLM/Trends', correlationId);
  const startTime = Date.now();
  const { analysisType, customerId, conversationHistory } =
    await request.json();

  if (!analysisType) {
    return json({ error: 'analysisType is required' }, { status: 400 });
  }

  const promptConfig = ANALYSIS_PROMPTS[analysisType];
  if (!promptConfig) {
    return json(
      {
        error: `Unknown analysisType: ${analysisType}`,
        validTypes: Object.keys(ANALYSIS_PROMPTS),
      },
      { status: 400 },
    );
  }

  log.info(
    `Trend analysis [${correlationId}]: type=${analysisType}, customer=${customerId || 'all'}`,
  );

  try {
    // Fetch data from read models
    const [customer, orders, allOrders] = await Promise.all([
      customerId ? fetchCustomer(customerId, correlationId) : null,
      customerId ? fetchOrdersByCustomer(customerId, correlationId) : [],
      promptConfig.needsAllOrders ? fetchAllOrders(correlationId) : [],
    ]);

    log.debug(
      `Fetched data: customer=${!!customer}, orders=${(orders || []).length}, allOrders=${(allOrders || []).length}`,
    );

    if (customerId && !customer) {
      return json(
        { error: `Customer ${customerId} not found` },
        { status: 404 },
      );
    }

    // Build analysis prompt with fetched data
    const systemPrompt = promptConfig.buildPrompt(
      customer,
      orders,
      allOrders,
    );
    const messages = [
      ...(conversationHistory || []).slice(-20),
      {
        role: 'user',
        content: promptConfig.userMessage(customer, orders),
      },
    ];

    const result = await llmClient.jsonCompletion(messages, {
      systemPrompt,
      correlationId,
    });

    if (result.error) {
      log.error(`Analysis parse error: ${result.error}`);
      return json({
        analysisType,
        result: null,
        error: 'Failed to parse analysis response',
        usage: result.usage,
        duration: result.duration,
      });
    }

    log.debug(
      `Analysis result keys: ${Object.keys(result.content || {}).join(',')}`,
    );

    // Validate riskScore for potential-issues analyses
    let content = result.content;
    if (analysisType === 'potential-issues' && content) {
      const riskScore = validateRiskScore(content.riskScore);
      content = { ...content, riskScore };
    }

    const duration = Date.now() - startTime;
    log.info(
      `Analysis complete: ${analysisType} for ${customerId || 'all'}, ${duration}ms`,
    );

    return json({
      analysisType,
      customerId,
      result: content,
      usage: result.usage,
      duration: result.duration,
    });
  } catch (error) {
    log.error(`Analyze trends failed: ${error.message}`);
    return json(
      { error: 'Analysis failed', message: error.message },
      { status: 500 },
    );
  }
};
