<script>
  import { postCommand } from './commands';

  export let commands = [];
  export let onDone = () => {};
  export let initialStatuses = null;
  export let onStatusChange = () => {};

  // Deep clone commands so edits don't mutate the original
  let editableCommands = commands.map((cmd) => JSON.parse(JSON.stringify(cmd)));
  let statuses = initialStatuses || commands.map(() => 'pending'); // pending | editing | sent | error

  $: onStatusChange([...statuses]);
  let editTexts = commands.map(() => '');
  let editErrors = commands.map(() => null);
  let sending = false;

  const validateCommand = (cmd) => {
    if (!cmd.aggregateName || !cmd.aggregateId || !cmd.command || !cmd.payload) {
      return 'Missing required fields';
    }
    if (!['customer', 'order'].includes(cmd.aggregateName)) {
      return `Unknown aggregate: ${cmd.aggregateName}`;
    }
    if (cmd.aggregateName === 'customer' && !['CREATE', 'UPDATE'].includes(cmd.command)) {
      return `Unknown customer command: ${cmd.command}`;
    }
    if (cmd.aggregateName === 'order' && !['CREATE', 'CONFIRM', 'DECLINE'].includes(cmd.command)) {
      return `Unknown order command: ${cmd.command}`;
    }
    return null;
  };

  const formatJson = (cmd) => JSON.stringify(cmd, null, 2);

  const sendOne = async (index) => {
    const error = validateCommand(editableCommands[index]);
    if (error) {
      statuses[index] = 'error';
      statuses = statuses;
      return;
    }
    statuses[index] = 'sending';
    statuses = statuses;
    try {
      await postCommand(editableCommands[index]);
      statuses[index] = 'sent';
    } catch (e) {
      statuses[index] = 'error';
    }
    statuses = statuses;
    if (statuses.every((s) => s === 'sent' || s === 'error')) {
      onDone();
    }
  };

  const sendAll = async () => {
    sending = true;
    for (let i = 0; i < editableCommands.length; i++) {
      if (statuses[i] === 'pending') {
        await sendOne(i);
      }
    }
    sending = false;
  };

  const startEdit = (index) => {
    editTexts[index] = formatJson(editableCommands[index]);
    editErrors[index] = null;
    statuses[index] = 'editing';
    statuses = statuses;
  };

  const saveEdit = (index) => {
    try {
      const parsed = JSON.parse(editTexts[index]);
      const error = validateCommand(parsed);
      if (error) {
        editErrors[index] = error;
        editErrors = editErrors;
        return;
      }
      editableCommands[index] = parsed;
      editableCommands = editableCommands;
      editErrors[index] = null;
      statuses[index] = 'pending';
    } catch (e) {
      editErrors[index] = 'Invalid JSON';
    }
    editErrors = editErrors;
    statuses = statuses;
  };

  const discardEdit = (index) => {
    editableCommands[index] = JSON.parse(JSON.stringify(commands[index]));
    editableCommands = editableCommands;
    editErrors[index] = null;
    editErrors = editErrors;
    statuses[index] = 'pending';
    statuses = statuses;
  };

  const cancel = () => {
    onDone();
  };
</script>

<div class="border rounded p-2 my-1 bg-amber-50">
  {#each editableCommands as cmd, i}
    <div class="py-1 {statuses[i] === 'sent' ? 'opacity-50' : ''}">
      {#if statuses[i] === 'editing'}
        <!-- Edit Mode: JSON textarea -->
        <div class="border rounded p-2 bg-white text-xs">
          <textarea
            class="w-full font-mono text-xs border rounded p-1 bg-gray-50"
            rows={formatJson(editableCommands[i]).split('\n').length + 1}
            bind:value={editTexts[i]}
          />
          {#if editErrors[i]}
            <div class="text-red-600 text-xs mt-1">{editErrors[i]}</div>
          {/if}
          <div class="flex gap-1 mt-1">
            <button
              class="text-xs px-2 py-0.5 bg-blue-200 rounded hover:bg-blue-300"
              on:click={() => saveEdit(i)}
            >Save</button>
            <button
              class="text-xs px-2 py-0.5 bg-gray-200 rounded hover:bg-gray-300"
              on:click={() => discardEdit(i)}
            >Discard</button>
          </div>
        </div>
      {:else}
        <!-- Display Mode: compact JSON -->
        <div class="flex items-start gap-2">
          <pre class="text-xs font-mono flex-1 whitespace-pre-wrap bg-white border rounded p-1">{formatJson(cmd)}</pre>
          <div class="flex flex-col gap-1 shrink-0">
            {#if statuses[i] === 'pending'}
              <button
                class="text-xs px-2 py-0.5 bg-green-200 rounded hover:bg-green-300"
                on:click={() => sendOne(i)}
                disabled={sending}
              >Send</button>
              <button
                class="text-xs px-2 py-0.5 bg-blue-200 rounded hover:bg-blue-300"
                on:click={() => startEdit(i)}
                disabled={sending}
              >Edit</button>
            {:else if statuses[i] === 'sending'}
              <span class="text-xs text-gray-500">...</span>
            {:else if statuses[i] === 'sent'}
              <span class="text-xs text-green-600">Sent</span>
            {:else if statuses[i] === 'error'}
              <span class="text-xs text-red-600">Error</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/each}

  <div class="flex gap-2 mt-2 border-t pt-2">
    {#if editableCommands.length > 1 && statuses.some((s) => s === 'pending')}
      <button
        class="text-xs px-3 py-1 bg-green-300 rounded hover:bg-green-400"
        on:click={sendAll}
        disabled={sending || statuses.some((s) => s === 'editing')}
      >Send All ({statuses.filter((s) => s === 'pending').length})</button>
    {/if}
    <button
      class="text-xs px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
      on:click={cancel}
    >Cancel</button>
  </div>
</div>
