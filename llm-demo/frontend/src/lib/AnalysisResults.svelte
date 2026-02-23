<script>
  import UsageInfo from './UsageInfo.svelte';

  export let analysisType;
  export let result;
  export let usage = null;
  export let duration = null;
</script>

<div class="border rounded p-2 my-1 bg-blue-50 text-sm">
  {#if analysisType === 'product-suggestions' && result?.suggestions}
    <div class="font-bold mb-1">Product Suggestions</div>
    {#each result.suggestions as suggestion}
      <div class="ml-2 mb-1">
        <span class="font-medium">{suggestion.product}</span>
        <span class="text-gray-600 text-xs block">{suggestion.reasoning}</span>
      </div>
    {/each}

  {:else if analysisType === 'interest-range' && result?.interests}
    <div class="font-bold mb-1">Interest Categories</div>
    {#each result.interests as interest}
      <div class="ml-2 mb-1 flex items-center gap-2">
        <span class="font-medium">{interest.category}</span>
        <span class="text-xs px-1 rounded {interest.confidence > 0.7
          ? 'bg-green-200'
          : interest.confidence > 0.4
            ? 'bg-yellow-200'
            : 'bg-gray-200'}">{Math.round(interest.confidence * 100)}%</span>
        <span class="text-gray-600 text-xs">{interest.evidence}</span>
      </div>
    {/each}

  {:else if analysisType === 'erroneous-orders' && result}
    <div class="font-bold mb-1">Order Review</div>
    {#if result.flags?.length > 0}
      {#each result.flags as flag}
        <div class="ml-2 mb-1 border-l-2 border-red-400 pl-2">
          <span class="text-xs font-mono">{flag.orderId}</span>
          <span class="text-xs px-1 rounded bg-red-200">{flag.issue}</span>
          <span class="text-gray-600 text-xs block">{flag.explanation}</span>
        </div>
      {/each}
    {:else}
      <div class="text-green-700">No issues detected. {result.summary}</div>
    {/if}

  {:else if analysisType === 'potential-issues' && result}
    <div class="font-bold mb-1 flex items-center gap-2">
      Risk Assessment
      <span class="text-xs px-2 py-0.5 rounded {result.riskLevel === 'high'
        ? 'bg-red-300'
        : result.riskLevel === 'medium'
          ? 'bg-yellow-300'
          : 'bg-green-300'}">{result.riskLevel}</span>
    </div>
    {#if result.issues?.length > 0}
      {#each result.issues as issue}
        <div class="ml-2 mb-1">
          <span class="text-xs font-medium">{issue.type}</span>:
          <span class="text-xs">{issue.description}</span>
          <span class="text-gray-600 text-xs block">{issue.evidence}</span>
        </div>
      {/each}
    {/if}
    {#if result.summary}
      <div class="text-xs text-gray-600 mt-1 italic">{result.summary}</div>
    {/if}

  {:else}
    <div class="text-gray-500">No analysis results</div>
  {/if}

  <UsageInfo {usage} {duration} />
</div>
