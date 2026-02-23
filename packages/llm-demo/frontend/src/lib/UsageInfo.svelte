<script>
  export let usage = null;
  export let duration = null;
  export let toolCalls = 0;
</script>

{#if usage || duration}
  <div class="text-xs text-gray-400 mt-1 border-t pt-1 flex gap-2">
    {#if duration}
      <span>{duration}ms</span>
    {/if}
    {#if usage?.total_tokens}
      <span>{usage.total_tokens} tokens</span>
    {/if}
    {#if usage?.prompt_tokens && usage?.completion_tokens}
      <span class="text-gray-300">
        ({usage.prompt_tokens}&rarr;{usage.completion_tokens})
      </span>
    {/if}
    {#if toolCalls > 0}
      <span>{toolCalls} tool call{toolCalls > 1 ? 's' : ''}</span>
    {/if}
  </div>
{/if}
