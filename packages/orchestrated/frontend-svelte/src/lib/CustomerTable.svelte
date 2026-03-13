<script>
  import { v4 as uuid } from 'uuid';

  import Button from './Button.svelte';
  import { forgetSubject } from './commands';

  import Table from './table/Table.svelte';
  import Tbody from './table/Tbody.svelte';
  import Td from './table/Td.svelte';
  import Th from './table/Th.svelte';
  import Thead from './table/Thead.svelte';
  import Tr from './table/Tr.svelte';
  import Working from './Working.svelte';

  export let store;

  const isStructured = (value) =>
    value && typeof value === 'object' && typeof value.text === 'string';

  const isForgotten = (value) =>
    isStructured(value) && value.forgotten === true;

  const isRestricted = (value) =>
    isStructured(value) && value.restricted === true;

  const displayValue = (value) =>
    isStructured(value) ? value.text : value;

  const handleForget = (id, name) => {
    const displayName = displayValue(name);
    if (confirm(`Forget customer "${displayName}"? This cannot be undone.`)) {
      forgetSubject(id);
    }
  };
</script>

{#if !$store.loaded}
  <Working />
{:else if $store.isEmpty}
  <div class="p-2 bg-yellow-200">No data</div>
{:else}
  <Table>
    <Thead>
      <Tr>
        <Th />
        <Th>Id</Th>
        <Th>Name</Th>
      </Tr>
    </Thead>
    <Tbody>
      {#each $store.data as row}
        {@const forgotten = isForgotten(row.name)}
        {@const restricted = isRestricted(row.name)}
        {@const unavailable = forgotten || restricted}
        <Tr>
          <Td>
            <Button
              kind="inline"
              text="Edit"
              target={unavailable ? null : `/customer/${row.id}`}
              disabled={unavailable}
            />
            <Button
              kind="inline"
              text="Place Order"
              target={unavailable ? null : `/order/${row.id}/${uuid()}`}
              disabled={unavailable}
            />
            {#if !unavailable}
              <Button
                kind="inline"
                text="Forget"
                on:click={() => handleForget(row.id, row.name)}
              />
            {/if}
          </Td>
          <Td>{row.id}</Td>
          <Td>{displayValue(row.name)}</Td>
        </Tr>
      {/each}
    </Tbody>
  </Table>
{/if}
