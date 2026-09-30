import { describe, test, expect } from 'vitest';
import { trimHistoryToTurns, MAX_HISTORY_TURNS } from './conversation-history.js';

// A turn: user question, assistant tool call, tool result, final answer
const turn = (n) => [
  { role: 'user', content: `question ${n}` },
  {
    role: 'assistant',
    tool_calls: [
      {
        id: `call_${n}`,
        type: 'function',
        function: { name: 'query_customers', arguments: '{}' },
      },
    ],
  },
  { role: 'tool', tool_call_id: `call_${n}`, content: `[{"id":"c${n}"}]` },
  { role: 'assistant', content: `answer ${n}` },
];

const turns = (count) =>
  Array.from({ length: count }, (_, i) => turn(i + 1)).flat();

describe('trimHistoryToTurns', () => {
  test('defaults to 10 turns', () => {
    expect(MAX_HISTORY_TURNS).toBe(10);
  });

  test('returns empty array for missing history', () => {
    expect(trimHistoryToTurns(undefined)).toEqual([]);
    expect(trimHistoryToTurns(null)).toEqual([]);
    expect(trimHistoryToTurns([])).toEqual([]);
  });

  test('keeps history unchanged when within the turn limit', () => {
    const history = turns(3);
    expect(trimHistoryToTurns(history, 10)).toEqual(history);
  });

  test('keeps exactly the last N turns', () => {
    const history = turns(12);
    const trimmed = trimHistoryToTurns(history, 10);
    expect(trimmed).toEqual(history.slice(2 * 4));
    expect(trimmed[0]).toEqual({ role: 'user', content: 'question 3' });
    expect(trimmed.filter((m) => m.role === 'user')).toHaveLength(10);
  });

  test('never splits a tool result from its tool call', () => {
    const trimmed = trimHistoryToTurns(turns(5), 2);
    expect(trimmed[0].role).toBe('user');
    const callIds = trimmed
      .filter((m) => m.tool_calls)
      .flatMap((m) => m.tool_calls.map((tc) => tc.id));
    trimmed
      .filter((m) => m.role === 'tool')
      .forEach((m) => expect(callIds).toContain(m.tool_call_id));
  });

  test('drops leading messages that do not start a turn', () => {
    const history = [
      { role: 'tool', tool_call_id: 'orphan', content: '[]' },
      { role: 'assistant', content: 'dangling' },
      ...turn(1),
    ];
    expect(trimHistoryToTurns(history, 10)).toEqual(turn(1));
  });

  test('keeps text-only turns (e.g. error responses)', () => {
    const history = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'Query failed' },
      ...turn(2),
    ];
    expect(trimHistoryToTurns(history, 10)).toEqual(history);
  });
});
