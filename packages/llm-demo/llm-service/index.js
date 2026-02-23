import express from 'express';
import { getLogger } from '@lazyapps/logger';
import { createLlmClient } from './llm-client.js';
import { createMockClient } from './mock-client.js';

// Routes
import { createGenerateCommandsRoute } from './routes/generate-commands.js';
import { createAnalyzeTrendsRoute } from './routes/analyze-trends.js';
import { createEvaluateReputationRoute } from './routes/evaluate-reputation.js';
import { createQueryDataRoute } from './routes/query-data.js';
import { createExplainHistoryRoute } from './routes/explain-history.js';
import { createChatRoute } from './routes/chat.js';

const log = getLogger('LLM', 'INIT');
const port = process.env.EXPRESS_PORT || 3010;

const llmClient =
  process.env.LLM_MOCK === 'true'
    ? createMockClient()
    : createLlmClient({
        apiKey: process.env.LLM_API_KEY,
        baseURL: process.env.LLM_BASE_URL,
        model: process.env.LLM_MODEL || 'gpt-4o',
      });

if (process.env.LLM_MOCK !== 'true' && !process.env.LLM_API_KEY) {
  log.warn('LLM_MOCK is not true but no LLM_API_KEY is set — LLM calls will fail');
}

// Rate limiting: 20 requests per minute per IP
const rateLimit = (maxRequests, windowMs) => {
  const requests = new Map();
  return (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;
    const userRequests = (requests.get(ip) || []).filter(
      (t) => t > windowStart,
    );
    if (userRequests.length >= maxRequests) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    userRequests.push(now);
    requests.set(ip, userRequests);
    next();
  };
};

const app = express();
app.use(express.json({ limit: '1mb' }));

// Health endpoint
app.get('/health', (req, res) =>
  res.json({ status: 'ok', mock: !!process.env.LLM_MOCK }),
);

// Apply rate limiting to all LLM endpoints
app.use('/api/llm', rateLimit(20, 60000));

// LLM endpoints
app.post('/api/llm/generate-commands', createGenerateCommandsRoute(llmClient));
app.post('/api/llm/analyze-trends', createAnalyzeTrendsRoute(llmClient));
app.post(
  '/api/llm/evaluate-reputation',
  createEvaluateReputationRoute(llmClient),
);
app.post('/api/llm/query-data', createQueryDataRoute(llmClient));
app.post('/api/llm/explain-history', createExplainHistoryRoute(llmClient));
app.post('/api/llm/chat', createChatRoute(llmClient));

app.listen(port, () => {
  log.info(
    `LLM service listening on port ${port} (mock: ${process.env.LLM_MOCK === 'true'})`,
  );
});
