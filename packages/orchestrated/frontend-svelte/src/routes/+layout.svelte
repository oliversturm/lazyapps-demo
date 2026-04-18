<script>
  import '../app.css';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import Button from '$lib/Button.svelte';
  import { authState, initAuth, logout } from '$lib/auth';

  const navigationTargets = {
    '/customers': 'Customers',
    '/orders': 'Orders',
    '/orderConfirmationRequests': 'Order Confirmation Requests',
    '/about': 'About',
  };

  let authReady = false;

  if (browser) {
    initAuth().then(() => {
      authReady = true;
    });
  }
</script>

{#if !authReady}
  <div class="container mx-auto border-solid border-2 rounded-lg my-4 p-4 shadow-lg">
    <div class="p-4 text-center">Authenticating...</div>
  </div>
{:else}
  <div
    class="container mx-auto border-solid border-2 rounded-lg my-4 p-4 shadow-lg"
  >
    <div class="bg-orange-100 p-2 rounded flex items-center">
      {#each Object.keys(navigationTargets) as target}
        <Button
          kind="{ $page.url.pathname === target ? 'toolbar-selected' : 'toolbar' }"
          text={navigationTargets[target]}
          target={target}
        />
      {/each}
      <div class="ml-auto flex items-center gap-2">
        <span class="text-sm text-gray-600">
          {$authState.username}
          {#if $authState.roles.length > 0}
            <span class="text-xs text-gray-400">({$authState.roles.filter(r => !r.startsWith('default-roles')).join(', ')})</span>
          {/if}
        </span>
        <button
          class="text-sm text-blue-600 hover:text-blue-800 underline"
          on:click={logout}
        >Logout</button>
        <span class="font-bold ml-2">Svelte Frontend</span>
      </div>
    </div>
    <div class="border-solid border mt-4 rounded p-2">
      <slot />
    </div>
  </div>
{/if}
