<script>
  import UsageInfo from './UsageInfo.svelte';

  export let explanation;
  export let events = [];
  export let keyEvents = [];
  export let reputation = [];
  export let summary = '';
  export let usage = null;
  export let duration = null;
</script>

<div class="border rounded p-2 my-1 text-sm">
  {#if summary}
    <div class="font-bold text-xs mb-2">{summary}</div>
  {/if}

  <!-- Narrative explanation -->
  <div class="text-xs whitespace-pre-wrap mb-2">{explanation}</div>

  <!-- Key events timeline -->
  {#if keyEvents.length > 0}
    <div class="border-t pt-2">
      <div class="text-xs font-medium mb-1 text-gray-500">Key Events</div>
      {#each keyEvents as event}
        <div class="mb-2 border-l-2 border-blue-400 pl-2">
          <div class="text-xs font-mono text-blue-700 break-all">{event.type}</div>
          {#if event.timestamp && !isNaN(new Date(event.timestamp).getTime())}
            <div class="text-xs text-gray-400">
              {new Date(event.timestamp).toLocaleTimeString()}
            </div>
          {/if}
          <div class="text-xs text-gray-600">{event.significance}</div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Reputation context -->
  {#if reputation.length > 0}
    <div class="border-t mt-2 pt-2">
      <div class="text-xs font-medium text-gray-500 mb-1">Reputation History</div>
      {#each reputation as record}
        <div class="flex items-center gap-2 text-xs mb-1">
          <span class="px-1 rounded {
            record.reputation === 'good' ? 'bg-green-200' :
            record.reputation === 'poor' ? 'bg-red-200' : 'bg-yellow-200'
          }">{record.reputation}</span>
          <span class="text-gray-400">{record.path}</span>
          <span class="text-gray-600 truncate">{record.reasoning}</span>
        </div>
      {/each}
    </div>
  {/if}

  <UsageInfo {usage} {duration} />
</div>
