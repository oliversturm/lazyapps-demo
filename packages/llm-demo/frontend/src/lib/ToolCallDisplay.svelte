<script>
  export let toolCalls = [];
  let expandedIndex = -1;

  const toggle = (i) => {
    expandedIndex = expandedIndex === i ? -1 : i;
  };

  const toolLabels = {
    query_customers: 'Queried customers',
    query_orders: 'Queried orders',
    query_order_stats: 'Queried order statistics',
  };
</script>

<div class="mb-2 text-xs">
  {#each toolCalls as call, i}
    <div class="border rounded my-1">
      <button
        class="w-full text-left px-2 py-1 hover:bg-gray-100 flex items-center gap-2"
        on:click={() => toggle(i)}
      >
        <span class="text-gray-400">{expandedIndex === i ? '▼' : '▶'}</span>
        <span class="font-medium text-blue-600">
          {toolLabels[call.name] || call.name}
        </span>
        {#if call.args?.customerId}
          <span class="text-gray-400">({call.args.customerId.substring(0, 8)}...)</span>
        {/if}
      </button>

      {#if expandedIndex === i}
        <div class="px-2 py-1 border-t bg-gray-50">
          {#if Object.keys(call.args || {}).length > 0}
            <div class="mb-1">
              <span class="text-gray-500">Args:</span>
              <code class="text-xs">{JSON.stringify(call.args)}</code>
            </div>
          {/if}
          <div>
            <span class="text-gray-500">Result:</span>
            <pre class="text-xs overflow-x-auto max-h-32 overflow-y-auto mt-1 p-1 bg-white rounded border">{JSON.stringify(call.result, null, 2).substring(0, 500)}{JSON.stringify(call.result, null, 2).length > 500 ? '\n... (truncated)' : ''}</pre>
          </div>
        </div>
      {/if}
    </div>
  {/each}
</div>
