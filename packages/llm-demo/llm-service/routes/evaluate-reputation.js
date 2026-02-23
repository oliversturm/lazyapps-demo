import { getLogger } from '@lazyapps/logger';

const VALID_REPUTATIONS = ['good', 'neutral', 'poor'];

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

export const createEvaluateReputationRoute = (llmClient) => {
  const log = getLogger('LLM', 'REPUTATION');

  return async (req, res) => {
    const { customerId, customerName, orderId, orderHistory } = req.body;

    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }
    if (!orderHistory || !Array.isArray(orderHistory)) {
      return res.status(400).json({ error: 'orderHistory array is required' });
    }

    try {
      const systemPrompt = buildSystemPrompt(
        customerName || 'Unknown',
        orderHistory,
      );
      const messages = [
        {
          role: 'user',
          content: `Evaluate the reputation of customer "${customerName || customerId}" based on their ${orderHistory.length} order(s).`,
        },
      ];

      const result = await llmClient.jsonCompletion(messages, { systemPrompt });

      if (result.error) {
        log.error(`Reputation parse error: ${result.error}`);
        // Fail-safe: default to STANDARD (R-6.2.4)
        return res.json({
          reputation: 'neutral',
          reasoning: 'Failed to parse LLM response; defaulting to neutral',
          failSafe: true,
          usage: result.usage,
          duration: result.duration,
        });
      }

      // Validate reputation value (R-6.2.2, R-6.2.4)
      const rawReputation = result.content?.reputation;
      const reputation = VALID_REPUTATIONS.includes(rawReputation)
        ? rawReputation
        : 'neutral'; // Fail-safe: unknown value → STANDARD

      if (!VALID_REPUTATIONS.includes(rawReputation)) {
        log.warn(
          `LLM returned unexpected reputation "${rawReputation}" for ${customerId}, defaulting to neutral`,
        );
      }

      const reasoning = result.content?.reasoning || 'No reasoning provided';

      log.info(
        `Reputation: ${customerId} → ${reputation} (${reasoning.substring(0, 80)})`,
      );

      res.json({
        reputation,
        reasoning,
        failSafe: !VALID_REPUTATIONS.includes(rawReputation),
        usage: result.usage,
        duration: result.duration,
      });
    } catch (error) {
      log.error(`Reputation evaluation failed: ${error.message}`);
      // Fail-safe: return neutral on any error (R-6.2.4)
      res.json({
        reputation: 'neutral',
        reasoning: `Error during evaluation: ${error.message}; defaulting to neutral`,
        failSafe: true,
      });
    }
  };
};
