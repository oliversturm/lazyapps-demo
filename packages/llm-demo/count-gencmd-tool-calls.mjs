#!/usr/bin/env node
// Measures which tools the LLM command generator calls for a request.
// Sends the same request N times to /api/llm/generate-commands (with the
// same customers/orders context the UI sends) and tallies the tool call
// sequences — model behaviour varies between runs, so a single run proves
// little.
//
// Usage: node count-gencmd-tool-calls.mjs [options]
//   --runs N          number of requests (default 10)
//   --text "..."      request text (default "Oli wants to order a football")
//   --base URL        where Traefik listens (default http://127.0.0.1)
//   --frontend-host   Host header for the frontend (default llm-demo.localhost)
//   --orders-host     Host header for the orders read model (default rm-orders.localhost)
//   --customers-host  Host header for the customers read model (default rm-customers.localhost)
//
// Like seed-data.sh, requests go to --base with an explicit Host header, so
// *.localhost names don't need to resolve.

import http from 'node:http';
import { parseArgs } from 'node:util';

const { values: opts } = parseArgs({
  options: {
    runs: { type: 'string', default: '10' },
    text: { type: 'string', default: 'Oli wants to order a football' },
    base: { type: 'string', default: 'http://127.0.0.1' },
    'frontend-host': { type: 'string', default: 'llm-demo.localhost' },
    'orders-host': { type: 'string', default: 'rm-orders.localhost' },
    'customers-host': { type: 'string', default: 'rm-customers.localhost' },
  },
});

const runs = Number.parseInt(opts.runs, 10);
if (!Number.isInteger(runs) || runs < 1) {
  console.error(`Invalid --runs "${opts.runs}"`);
  process.exit(1);
}
const base = new URL(opts.base);

const postJson = (host, path, body) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: base.hostname,
        port: base.port || 80,
        path,
        method: 'POST',
        headers: {
          Host: host,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(
              new Error(
                `${host}${path}: HTTP ${res.statusCode} ${data.substring(0, 200)}`,
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(
              new Error(
                `${host}${path}: invalid JSON: ${data.substring(0, 200)}`,
              ),
            );
          }
        });
      },
    );
    req.on('error', (err) =>
      reject(new Error(`${host}${path}: ${err.message}`)),
    );
    req.end(payload);
  });

const describeArgs = (args) =>
  Object.entries(args || {})
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

const describeCommand = (c) =>
  `${c.aggregateName}/${c.command}` +
  (c.payload?.text
    ? ` "${c.payload.text}"`
    : c.payload?.name
      ? ` "${c.payload.name}"`
      : '') +
  (c.payload?.value != null ? ` ${c.payload.value}` : '');

console.log(`=== Command generator tool call measurement ===`);
console.log(`Request:  "${opts.text}"`);
console.log(`Runs:     ${runs}`);
console.log(`Frontend: ${base.origin} (Host: ${opts['frontend-host']})`);

// Same context the UI sends from the orders/customers pages
console.log(
  `Fetching context: orders (Host: ${opts['orders-host']}), customers (Host: ${opts['customers-host']})`,
);
const [orders, customers] = await Promise.all([
  postJson(opts['orders-host'], '/query/overview/all', {}),
  postJson(opts['customers-host'], '/query/overview/all', {}),
]).catch((err) => {
  console.error(`Failed to fetch context: ${err.message}`);
  process.exit(1);
});
console.log(`Context:  ${orders.length} orders, ${customers.length} customers`);
console.log('');

const results = [];
for (let i = 1; i <= runs; i++) {
  const start = Date.now();
  try {
    const res = await postJson(
      opts['frontend-host'],
      '/api/llm/generate-commands',
      {
        text: opts.text,
        context: { customers, orders },
        conversationHistory: [],
      },
    );
    const tools = (res.toolCalls || []).map((tc) => tc.name);
    const commands = res.commands || [];
    results.push({
      tools,
      commands,
      toolChoice: res.toolChoice,
      explanation: res.explanation,
    });
    console.log(
      `run ${i}/${runs}: ` +
        `${(res.toolCalls || []).map((tc) => `${tc.name}(${describeArgs(tc.args)})`).join(' → ') || '(no tool calls)'}` +
        ` | ${commands.map(describeCommand).join(', ') || `no commands${res.explanation ? `: ${res.explanation.substring(0, 80)}` : ''}`}` +
        ` | ${Date.now() - start}ms`,
    );
  } catch (err) {
    results.push({ error: err.message });
    console.log(`run ${i}/${runs}: ERROR ${err.message}`);
  }
}

const ok = results.filter((r) => !r.error);
const count = (pred) => ok.filter(pred).length;
const pct = (n) =>
  ok.length ? ` (${Math.round((n / ok.length) * 100)}%)` : '';
const withOrders = count((r) => r.tools.includes('lookup_orders'));
const withCustomers = count((r) => r.tools.includes('lookup_customers'));
const noCommands = count((r) => r.commands.length === 0);
const avgTools = ok.length
  ? (ok.reduce((sum, r) => sum + r.tools.length, 0) / ok.length).toFixed(1)
  : '-';
const modes = [
  ...new Set(ok.map((r) => r.toolChoice || 'unknown (older frontend)')),
];
const sequences = ok.reduce((acc, r) => {
  const key = r.tools.join(' → ') || '(no tool calls)';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

console.log('');
console.log(
  `=== Summary: ${runs} runs, tool_choice=${modes.join('/') || '-'} ===`,
);
console.log(
  `lookup_orders called:     ${withOrders}/${ok.length}${pct(withOrders)}`,
);
console.log(
  `lookup_customers called:  ${withCustomers}/${ok.length}${pct(withCustomers)}`,
);
console.log(`avg tool calls per run:   ${avgTools}`);
console.log(
  `runs without commands:    ${noCommands}/${ok.length}${pct(noCommands)}  (refusal or explanation)`,
);
console.log(`errors:                   ${results.length - ok.length}`);
console.log('tool call sequences:');
Object.entries(sequences)
  .sort(([, a], [, b]) => b - a)
  .forEach(([seq, n]) => console.log(`  ${String(n).padStart(3)}× ${seq}`));
