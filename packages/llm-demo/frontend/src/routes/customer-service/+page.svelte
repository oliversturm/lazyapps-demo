<script>
  import ToolCallDisplay from '$lib/ToolCallDisplay.svelte';
  import UsageInfo from '$lib/UsageInfo.svelte';

  let messages = [];
  let conversationHistory = [];
  let inputText = '';
  let loading = false;
  let messagesContainer;

  const scrollToBottom = () => {
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || loading) return;
    inputText = '';

    // Add user message to display
    messages = [...messages, { role: 'user', content: text }];

    loading = true;
    try {
      const response = await fetch(`/api/llm/query-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: text }],
          conversationHistory,
        }),
      });
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      const data = await response.json();

      if (data.error) {
        messages = [
          ...messages,
          { role: 'assistant', type: 'error', content: data.message || data.error },
        ];
      } else {
        messages = [
          ...messages,
          {
            role: 'assistant',
            content: data.content,
            toolCalls: data.toolCalls,
            usage: data.usage,
            duration: data.duration,
          },
        ];
      }

      // Update conversation history for multi-turn (R-7.5.3)
      conversationHistory = [
        ...conversationHistory,
        { role: 'user', content: text },
        { role: 'assistant', content: data.content || data.error },
      ];
    } catch (error) {
      messages = [
        ...messages,
        { role: 'assistant', type: 'error', content: error.message },
      ];
    }
    loading = false;
    setTimeout(scrollToBottom, 50);
  };

  const handleKeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearHistory = () => {
    messages = [];
    conversationHistory = [];
  };
</script>

<div class="flex flex-col h-[calc(100vh-120px)]">
  <!-- Header -->
  <div class="flex items-center justify-between p-3 border-b">
    <div>
      <span class="font-bold text-lg">Customer Service</span>
      <span class="text-sm text-gray-500 ml-2">Ask questions about customers and orders</span>
    </div>
    <button
      class="text-xs px-2 py-1 rounded border hover:bg-gray-100"
      on:click={clearHistory}
    >
      Clear History
    </button>
  </div>

  <!-- Messages Area -->
  <div
    class="flex-1 overflow-y-auto p-4 space-y-4"
    bind:this={messagesContainer}
  >
    {#if messages.length === 0}
      <div class="text-center text-gray-400 mt-8">
        <div class="text-lg mb-2">Ask me about customers and orders</div>
        <div class="text-sm space-y-1">
          <div>"Who are our best customers?"</div>
          <div>"What are the most popular orders?"</div>
          <div>"How many orders did we get today?"</div>
          <div>"Show me customers who haven't ordered in a while"</div>
        </div>
      </div>
    {/if}

    {#each messages as message}
      {#if message.role === 'user'}
        <div class="flex justify-end">
          <div class="bg-blue-100 rounded-lg px-4 py-2 max-w-xl">
            {message.content}
          </div>
        </div>
      {:else if message.type === 'error'}
        <div class="flex justify-start">
          <div class="bg-red-50 border border-red-200 rounded-lg px-4 py-2 max-w-xl text-red-700">
            {message.content}
          </div>
        </div>
      {:else}
        <div class="flex justify-start">
          <div class="bg-gray-50 rounded-lg px-4 py-2 max-w-xl">
            <!-- Tool Call Transparency (R-7.5.4) -->
            {#if message.toolCalls?.length > 0}
              <ToolCallDisplay toolCalls={message.toolCalls} />
            {/if}

            <!-- Answer -->
            <div class="whitespace-pre-wrap">{message.content}</div>

            <!-- Usage metadata -->
            <UsageInfo
              usage={message.usage}
              duration={message.duration}
              toolCalls={message.toolCalls?.length || 0}
            />
          </div>
        </div>
      {/if}
    {/each}

    {#if loading}
      <div class="flex justify-start">
        <div class="bg-gray-50 rounded-lg px-4 py-2 text-gray-400 animate-pulse">
          Querying data...
        </div>
      </div>
    {/if}
  </div>

  <!-- Input Area -->
  <div class="border-t p-3">
    <div class="flex gap-2">
      <input
        class="flex-1 border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
        type="text"
        placeholder="Ask about customers and orders..."
        bind:value={inputText}
        on:keydown={handleKeydown}
        disabled={loading}
      />
      <button
        class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
        on:click={sendMessage}
        disabled={loading || !inputText.trim()}
      >
        Send
      </button>
    </div>
  </div>
</div>
