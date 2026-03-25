<script>
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import CustomerForm from '$lib/CustomerForm.svelte';
  import Button from '$lib/Button.svelte';

  export let data;

  let items = null;
  let loading = true;

  onMount(() => {
    data.queryFn().then((result) => {
      items = result || [];
      loading = false;
    });
  });

  const isStructured = (value) =>
    value && typeof value === 'object' && typeof value.text === 'string';

  const isFieldUnavailable = (value) =>
    isStructured(value) &&
    (value.forgotten === true ||
      value.restricted === true ||
      value.unauthorized === true);

  $: dataObject = items && items.length
    ? items[0]
    : { newObject: true, name: '', location: '' };

  $: unavailable =
    !loading &&
    !dataObject.newObject &&
    (isFieldUnavailable(dataObject.name) ||
      isFieldUnavailable(dataObject.location));
</script>

{#if loading}
  <div class="p-4 text-center">Loading...</div>
{:else if unavailable}
  <div class="p-4 bg-red-100 border border-red-300 rounded my-4">
    <p class="font-bold text-red-800">Access Denied</p>
    <p class="text-red-700">You are not authorized to edit this customer, or the customer data is no longer available.</p>
    <Button kind="separate" text="Back to Customers" target="/customers" />
  </div>
{:else}
  <CustomerForm
    dataId={$page.params.id}
    data={dataObject}
  />
{/if}
