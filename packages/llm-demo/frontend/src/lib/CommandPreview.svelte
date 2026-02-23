<script>
  import { postCommand } from './commands';

  export let commands = [];
  export let onDone = () => {};

  // Deep clone commands so edits don't mutate the original
  let editableCommands = commands.map((cmd) => JSON.parse(JSON.stringify(cmd)));
  let statuses = commands.map(() => 'pending'); // pending | editing | sent | error
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
    if (cmd.aggregateName === 'order' && !['CREATE', 'CONFIRM'].includes(cmd.command)) {
      return `Unknown order command: ${cmd.command}`;
    }
    return null;
  };

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
    statuses[index] = 'editing';
    statuses = statuses;
  };

  const saveEdit = (index) => {
    statuses[index] = 'pending';
    statuses = statuses;
  };

  const discardEdit = (index) => {
    // Revert to original
    editableCommands[index] = JSON.parse(JSON.stringify(commands[index]));
    editableCommands = editableCommands;
    statuses[index] = 'pending';
    statuses = statuses;
  };

  const cancel = () => {
    onDone();
  };

  const formatCommand = (cmd) => {
    const action = cmd.command;
    const target = cmd.aggregateName;
    const detail =
      target === 'customer'
        ? cmd.payload.name || ''
        : target === 'order'
          ? cmd.payload.text || ''
          : '';
    return `${action} ${target}${detail ? `: ${detail}` : ''}`;
  };

  // Get editable payload fields based on aggregate type and command
  const getEditableFields = (cmd) => {
    if (cmd.aggregateName === 'customer') {
      return ['name', 'location'];
    }
    if (cmd.aggregateName === 'order' && cmd.command === 'CREATE') {
      return ['text', 'value'];
    }
    return [];
  };
</script>

<div class="border rounded p-2 my-1 bg-amber-50">
  {#each editableCommands as cmd, i}
    <div class="py-1 {statuses[i] === 'sent' ? 'opacity-50' : ''}">
      {#if statuses[i] === 'editing'}
        <!-- Edit Mode -->
        <div class="border rounded p-2 bg-white text-xs">
          <div class="font-medium mb-1">
            {cmd.command} {cmd.aggregateName}
          </div>
          {#each getEditableFields(cmd) as field}
            <div class="flex items-center gap-2 mb-1">
              <label class="w-16 text-gray-500">{field}:</label>
              {#if field === 'value'}
                <input
                  type="number"
                  class="flex-1 border rounded px-2 py-0.5"
                  bind:value={cmd.payload[field]}
                />
              {:else}
                <input
                  type="text"
                  class="flex-1 border rounded px-2 py-0.5"
                  bind:value={cmd.payload[field]}
                />
              {/if}
            </div>
          {/each}
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
        <!-- Display Mode -->
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono flex-1">{formatCommand(cmd)}</span>
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
