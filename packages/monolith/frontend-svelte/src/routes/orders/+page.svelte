<script>
  import OrderTable from '$lib/OrderTable.svelte';

  import { readModelStore } from '$lib/readModelStore';

  const endpointName = 'orders';
  const socketIoEndpoint = import.meta.env.VITE_CHANGENOTIFIER_URL || 'http://127.0.0.1:53008';

  export let data;
  $: store = readModelStore(
    data.queryFn,
    endpointName,
    socketIoEndpoint,
    'overview',
    'all',
    data.correlationId
  );
</script>

<OrderTable {store} />
