<script>
  import { page } from '$app/stores';
  import Button from '$lib/Button.svelte';
  import LlmAssistantPanel from '$lib/LlmAssistantPanel.svelte';
  import { contextDataStore } from '$lib/contextDataStore.js';

  const navigationTargets = {
    '/customers': 'Customers',
    '/orders': 'Orders',
    '/orderConfirmationRequests': 'Order Confirmation Requests',
    '/customer-service': 'Customer Service',
    '/about': 'About',
  };

  // Don't show panel on customer-service page (R-9.1.4) or about page
  $: showPanel = !['/about', '/customer-service'].some((p) =>
    $page.url.pathname.startsWith(p)
  );
</script>

<div
  class="container mx-auto border-solid border-2 rounded-lg my-4 p-4 shadow-lg"
>
  <div class="bg-orange-100 p-2 rounded flex items-center">
    {#each Object.keys(navigationTargets) as target}
      <Button
        kind="{ $page.url.pathname === target ? 'toolbar-selected' : 'toolbar' }"
        text={navigationTargets[target]}
        {target}
      />
    {/each}
    <div class="ml-auto font-bold">LLM Demo</div>
  </div>
  <div class="flex mt-4 gap-4 h-[calc(100vh-120px)]">
    <div class="flex-1 border-solid border rounded p-2 min-w-0 overflow-y-auto">
      <slot />
    </div>
    {#if showPanel}
      <LlmAssistantPanel contextData={$contextDataStore} />
    {/if}
  </div>
</div>
