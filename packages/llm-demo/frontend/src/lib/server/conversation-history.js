// Conversation history for multi-turn tool-calling chats.
//
// The history holds complete turns: the user message, any assistant
// tool_calls messages with their tool results, and the final assistant
// answer. Keeping the tool results is what lets the model resolve follow-up
// questions ("what did they order?") with the real IDs from earlier turns.
//
// Trimming works on whole turns (a turn starts at a user message), so a
// tool result is never separated from the assistant message that requested
// it — OpenAI-compatible APIs reject such orphaned tool messages.

export const MAX_HISTORY_TURNS = 10;

export const trimHistoryToTurns = (history, maxTurns = MAX_HISTORY_TURNS) => {
  if (!Array.isArray(history)) return [];

  const turnStarts = history.reduce(
    (acc, m, i) => (m?.role === 'user' ? [...acc, i] : acc),
    [],
  );
  if (turnStarts.length === 0) return [];

  const firstKept = turnStarts[Math.max(0, turnStarts.length - maxTurns)];
  return history.slice(firstKept);
};
