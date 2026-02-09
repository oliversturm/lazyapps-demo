<script>
  import { v4 as uuid } from 'uuid';

  import Button from '$lib/Button.svelte';
  import CustomerTable from '$lib/CustomerTable.svelte';

  import { readModelStore } from '$lib/readModelStore';

  const endpointName = 'customers';
  const socketIoEndpoint =
    import.meta.env.VITE_CHANGENOTIFIER_URL || 'http://127.0.0.1:3006';

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

<CustomerTable {store} />
<Button kind="separate" text="New Customer" target={`/customer/${uuid()}`} />
