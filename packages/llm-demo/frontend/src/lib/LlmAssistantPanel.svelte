<script>
  import { page } from '$app/stores';
  import CommandPreview from './CommandPreview.svelte';
  import AnalysisResults from './AnalysisResults.svelte';
  import ExplanationDisplay from './ExplanationDisplay.svelte';
  import UsageInfo from './UsageInfo.svelte';
  import { readModelStore } from './readModelStore';
  import { query } from './query.js';
  import { contextDataStore } from './contextDataStore';

  // Props
  export let contextData = {};

  // State
  let messages = [];
  let inputText = '';
  let loading = false;
  let collapsed = false;
  let pendingCommands = null;

  // Analysis state (D7)
  let selectedAnalysisType = 'product-suggestions';
  let selectedCustomerId = null;
  let selectedCustomerName = '';
  let analysisLoading = false;

  // Explanation state (F8)
  let explanationLoading = false;
  let lastExplainTimestamp = 0;

  // Approach B: notification subscription (D8)
  const ordersEndpoint =
    import.meta.env.VITE_RM_ORDERS_URL || 'http://rm-orders.localhost';
  const socketIoEndpoint =
    import.meta.env.VITE_CHANGENOTIFIER_URL || 'http://change-notifier.localhost';

  const analysisStore = readModelStore(
    () => query('LLM-PANEL', fetch)(ordersEndpoint, 'trendAnalysis', 'all'),
    'orders',
    socketIoEndpoint,
    'trendAnalysis',
    'all',
    'LLM-PANEL',
  );

  const reputationStore = readModelStore(
    () => query('LLM-PANEL', fetch)(ordersEndpoint, 'reputation', 'all'),
    'orders',
    socketIoEndpoint,
    'reputation',
    'all',
    'LLM-PANEL',
  );

  let seenAnalyses = new Set();

  // React to new event-driven analyses (D8)
  // Always target the 'orders' context — trend analysis is order data and
  // the notification should appear on the Orders page regardless of which
  // page the user is on when the Socket.io event arrives.
  $: if ($analysisStore.data?.length > 0) {
    const latest = $analysisStore.data[$analysisStore.data.length - 1];
    if (
      latest.trigger === 'event-driven' &&
      !seenAnalyses.has(latest.timestamp)
    ) {
      seenAnalyses.add(latest.timestamp);
      addMessage({
        role: 'system',
        type: 'analysis',
        content: `Auto-analysis triggered for ${latest.customerName}`,
        analysisType: latest.analysisType,
        result: latest.result,
      }, 'orders');
    }
  }

  // React to explain requests from table buttons (F8)
  $: if ($contextDataStore.explainRequest?.timestamp > lastExplainTimestamp) {
    lastExplainTimestamp = $contextDataStore.explainRequest.timestamp;
    handleExplainRequest($contextDataStore.explainRequest);
  }

  const handleExplainRequest = async ({ aggregateId, aggregateName, label }) => {
    addMessage({
      role: 'user',
      content: `Explain the history of ${aggregateName} "${label}"`,
    });

    explanationLoading = true;
    try {
      const response = await fetch(`/api/llm/explain-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aggregateId, aggregateName }),
      });
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      const data = await response.json();

      addMessage({
        role: 'assistant',
        type: 'explanation',
        content: data.explanation,
        events: data.events,
        keyEvents: data.keyEvents,
        summary: data.summary,
        reputation: data.reputation,
        usage: data.usage,
        duration: data.duration,
      });
    } catch (error) {
      addMessage({ role: 'assistant', type: 'error', content: error.message });
    }
    explanationLoading = false;
  };

  // Context detection from route
  $: currentPage = $page.url.pathname.startsWith('/orders')
    ? 'orders'
    : $page.url.pathname.startsWith('/orderConfirmationRequests')
      ? 'confirmations'
      : 'customers';

  $: contextLabel = {
    customers: 'Customers',
    orders: 'Orders',
    confirmations: 'Confirmations',
  }[currentPage];

  // Per-context conversation history (R-3.5.6)
  let conversationsByContext = {};
  $: {
    if (!conversationsByContext[currentPage]) {
      conversationsByContext[currentPage] = [];
    }
    messages = conversationsByContext[currentPage];
  }

  // Persist collapsed state (R-9.6.5)
  if (typeof localStorage !== 'undefined') {
    collapsed = localStorage.getItem('llm-panel-collapsed') === 'true';
  }
  $: if (typeof localStorage !== 'undefined') {
    localStorage.setItem('llm-panel-collapsed', collapsed);
  }

  const addMessage = (msg, targetContext) => {
    const ctx = targetContext || currentPage;
    if (!conversationsByContext[ctx]) {
      conversationsByContext[ctx] = [];
    }
    conversationsByContext[ctx] = [
      ...conversationsByContext[ctx],
      msg,
    ];
    if (ctx === currentPage) {
      messages = conversationsByContext[ctx];
    }
  };

  const clearChat = () => {
    conversationsByContext[currentPage] = [];
    messages = [];
    pendingCommands = null;
  };

  const sendMessage = async () => {
    if (!inputText.trim() || loading) return;

    const text = inputText.trim();
    inputText = '';
    addMessage({ role: 'user', content: text });
    loading = true;

    try {
      const response = await fetch(`/api/llm/generate-commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          context: {
            page: currentPage,
            customers: contextData.customers || [],
            orders: contextData.orders || [],
          },
          conversationHistory: messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      const data = await response.json();

      if (data.commands && data.commands.length > 0) {
        addMessage({
          role: 'assistant',
          type: 'command-preview',
          content: `Generated ${data.commands.length} command(s)`,
          commands: data.commands,
          usage: data.usage,
          duration: data.duration,
        });
        pendingCommands = data.commands;
      } else {
        addMessage({
          role: 'assistant',
          content: data.explanation || 'No commands generated.',
          usage: data.usage,
          duration: data.duration,
        });
      }
    } catch (error) {
      addMessage({
        role: 'assistant',
        type: 'error',
        content: `Error: ${error.message}`,
      });
    } finally {
      loading = false;
    }
  };

  // Analysis trigger (D7)
  const runAnalysis = async () => {
    analysisLoading = true;

    try {
      const response = await fetch(`/api/llm/analyze-trends`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisType: selectedAnalysisType,
          customerId: selectedCustomerId || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      const data = await response.json();

      addMessage({
        role: 'assistant',
        type: 'analysis',
        content: data.error
          ? `Analysis error: ${data.error}`
          : `${selectedAnalysisType} analysis${selectedCustomerName ? ` for ${selectedCustomerName}` : ''}`,
        analysisType: data.analysisType || selectedAnalysisType,
        result: data.result,
        usage: data.usage,
        duration: data.duration,
      });
    } catch (error) {
      addMessage({
        role: 'assistant',
        type: 'error',
        content: `Analysis error: ${error.message}`,
      });
    } finally {
      analysisLoading = false;
    }
  };

  const selectCustomer = (customer) => {
    selectedCustomerId = customer.id;
    selectedCustomerName = customer.name;
  };

  const handleKeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  let messagesContainer;
  let prevMessageCount = 0;
  $: if (messages.length > prevMessageCount && messagesContainer) {
    // Scroll to bottom only when new messages are added
    prevMessageCount = messages.length;
    setTimeout(() => {
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }, 0);
  }
</script>

{#if collapsed}
  <div
    class="w-[50px] flex flex-col items-center py-4 bg-blue-50 border rounded cursor-pointer hover:bg-blue-100"
    on:click={() => (collapsed = false)}
    on:keydown={(e) => e.key === 'Enter' && (collapsed = false)}
    role="button"
    tabindex="0"
    title="Expand LLM Assistant"
  >
    <span class="text-lg">🤖</span>
    <span class="text-xs [writing-mode:vertical-lr] mt-2 text-gray-500">Assistant</span>
  </div>
{:else}
  <div class="w-[350px] flex-shrink-0 border rounded bg-white flex flex-col">
    <!-- Header -->
    <div class="flex items-center gap-2 p-2 bg-blue-50 border-b">
      <span class="font-bold text-sm flex-1">LLM Assistant</span>
      <span class="text-xs px-2 py-0.5 bg-blue-200 rounded">{contextLabel}</span>
      <button
        class="text-xs px-1 hover:bg-blue-200 rounded"
        on:click={clearChat}
        title="Clear chat"
      >Clear</button>
      <button
        class="text-xs px-1 hover:bg-blue-200 rounded"
        on:click={() => (collapsed = true)}
        title="Collapse panel"
      >—</button>
    </div>

    <!-- Customer chips for analysis (D7) -->
    {#if currentPage === 'customers' && contextData.customers?.length > 0}
      <div class="px-2 pt-2 flex flex-wrap gap-1">
        {#each contextData.customers as customer}
          <button
            class="text-xs px-2 py-0.5 rounded {selectedCustomerId === customer.id
              ? 'bg-blue-400 text-white'
              : 'bg-gray-100 hover:bg-gray-200'}"
            on:click={() => selectCustomer(customer)}
          >{customer.name}</button>
        {/each}
      </div>
    {/if}

    <!-- Quick Analysis section (D7) -->
    {#if currentPage === 'customers' || currentPage === 'orders'}
      <div class="border-t mx-2 pt-2 mt-2">
        <div class="text-xs font-bold mb-1">Quick Analysis</div>
        <select
          bind:value={selectedAnalysisType}
          class="text-xs border rounded p-1 w-full"
        >
          <option value="product-suggestions">Product Suggestions</option>
          <option value="interest-range">Interest Categories</option>
          <option value="erroneous-orders">Error Detection</option>
          <option value="potential-issues">Risk Assessment</option>
        </select>

        {#if currentPage === 'customers' && selectedCustomerId}
          <button
            class="text-xs mt-1 px-2 py-1 bg-blue-200 rounded hover:bg-blue-300 w-full"
            on:click={runAnalysis}
            disabled={analysisLoading}
          >
            {analysisLoading ? 'Analyzing...' : `Analyze ${selectedCustomerName}`}
          </button>
        {:else if currentPage === 'orders'}
          <button
            class="text-xs mt-1 px-2 py-1 bg-blue-200 rounded hover:bg-blue-300 w-full"
            on:click={runAnalysis}
            disabled={analysisLoading}
          >
            {analysisLoading ? 'Analyzing...' : 'Analyze All Orders'}
          </button>
        {:else if currentPage === 'customers'}
          <div class="text-xs text-gray-400 mt-1">Select a customer above</div>
        {/if}
      </div>
    {/if}

    <!-- Reputation Assessments (E6+E7) -->
    {#if currentPage === 'orders' && $reputationStore.data?.length > 0}
      <div class="border-t pt-2 mt-2 px-2">
        <div class="text-xs font-bold mb-1">Reputation Assessments</div>
        {#each $reputationStore.data.slice(0, 5) as assessment}
          <div class="border rounded p-2 my-1 text-xs">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-medium">{assessment.customerName}</span>
              <span class="px-1 rounded {assessment.reputation === 'good'
                ? 'bg-green-200 text-green-800'
                : assessment.reputation === 'poor'
                  ? 'bg-red-200 text-red-800'
                  : 'bg-yellow-200 text-yellow-800'}">{assessment.reputation}</span>
              <span class="text-gray-400">{assessment.path}</span>
            </div>
            <div class="text-gray-600">{assessment.reasoning}</div>
            {#if assessment.failSafe}
              <div class="text-orange-600 text-xs mt-1">Default assessment (LLM unavailable)</div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Messages -->
    <div
      class="flex-1 overflow-y-auto p-2 space-y-2 min-h-[200px] max-h-[600px]"
      bind:this={messagesContainer}
    >
      {#each messages as msg}
        <div class="text-sm {msg.role === 'user' ? 'text-right' : ''}">
          {#if msg.role === 'user'}
            <div class="inline-block bg-blue-100 rounded px-2 py-1 max-w-[90%] text-left">
              {msg.content}
            </div>
          {:else if msg.type === 'command-preview'}
            <div class="bg-gray-50 rounded px-2 py-1">
              <div class="text-xs text-gray-500 mb-1">{msg.content}</div>
              <CommandPreview
                commands={msg.commands}
                initialStatuses={msg.statuses}
                onStatusChange={(s) => { msg.statuses = s; }}
                onDone={() => (pendingCommands = null)}
              />
              <UsageInfo usage={msg.usage} duration={msg.duration} />
            </div>
          {:else if msg.type === 'analysis'}
            <div class="bg-gray-50 rounded px-2 py-1">
              <div class="text-xs text-gray-500 mb-1">
                {#if msg.role === 'system'}
                  ⚡ {msg.content}
                {:else}
                  {msg.content}
                {/if}
              </div>
              {#if msg.result}
                <AnalysisResults
                  analysisType={msg.analysisType}
                  result={msg.result}
                  usage={msg.usage}
                  duration={msg.duration}
                />
              {:else}
                <div class="text-xs text-gray-400">No results</div>
              {/if}
            </div>
          {:else if msg.type === 'explanation'}
            <ExplanationDisplay
              explanation={msg.content}
              events={msg.events}
              keyEvents={msg.keyEvents}
              reputation={msg.reputation}
              summary={msg.summary}
              usage={msg.usage}
              duration={msg.duration}
            />
          {:else if msg.type === 'error'}
            <div class="bg-red-50 text-red-700 rounded px-2 py-1">
              {msg.content}
            </div>
          {:else}
            <div class="bg-gray-100 rounded px-2 py-1">
              {msg.content}
              <UsageInfo usage={msg.usage} duration={msg.duration} />
            </div>
          {/if}
        </div>
      {/each}

      {#if loading}
        <div class="text-sm text-gray-400">Thinking...</div>
      {/if}
    </div>

    <!-- Input -->
    <div class="border-t p-2">
      <div class="flex gap-2">
        <input
          type="text"
          class="flex-1 text-sm border rounded px-2 py-1"
          placeholder="Type a command..."
          bind:value={inputText}
          on:keydown={handleKeydown}
          disabled={loading}
        />
        <button
          class="text-sm px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          on:click={sendMessage}
          disabled={loading || !inputText.trim()}
        >Send</button>
      </div>
    </div>
  </div>
{/if}
