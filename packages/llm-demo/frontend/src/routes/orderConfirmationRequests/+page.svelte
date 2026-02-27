<script>
  import OrderConfirmationRequestsTable from '$lib/OrderConfirmationRequestsTable.svelte';

  import { readModelStore } from '$lib/readModelStore';
  import { contextDataStore } from '$lib/contextDataStore.js';

  const endpointName = 'orders';
  const socketIoEndpoint =
    import.meta.env.VITE_CHANGENOTIFIER_URL || 'http://127.0.0.1:3006';

  export let data;
  $: store = readModelStore(
    data.queryFn,
    endpointName,
    socketIoEndpoint,
    'confirmationRequests',
    'all',
    data.correlationId
  );

  // Update context when data changes
  $: if ($store.data) {
    $contextDataStore = { ...$contextDataStore, orders: $store.data };
  }
</script>

<OrderConfirmationRequestsTable {store} />
