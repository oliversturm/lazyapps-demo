export const createChatRoute = (llmClient) => async (req, res) => {
  const { messages, systemPrompt } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const result = await llmClient.chatCompletion(messages, { systemPrompt });
    res.json({
      content: result.content,
      usage: result.usage,
      duration: result.duration,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: 'LLM request failed', message: error.message });
  }
};
