<script>
  import OrderConfirmationRequestsTable from '$lib/OrderConfirmationRequestsTable.svelte';

  import { readModelStore } from '$lib/readModelStore';

  const endpointName = 'orders';
  const socketIoEndpoint = 'http://127.0.0.1:53008';

  export let data;
  $: store = readModelStore(
    data.queryFn,
    endpointName,
    socketIoEndpoint,
    'confirmationRequests',
    'all',
    data.correlationId
  );
</script>

<OrderConfirmationRequestsTable {store} />
