<script>
  import { goto } from '$app/navigation';

  import Button from './Button.svelte';
  import { postCommand } from './commands';
  import customerEditSchema from './schemas/customerEditSchema';
  import TextInput from './TextInput.svelte';
  import ValidationLabel from './ValidationLabel.svelte';
  import { createValidator } from './validator';

  export let data;
  export let dataId;

  const isStructured = (value) =>
    value && typeof value === 'object' && typeof value.text === 'string';

  const isForgotten = (value) =>
    isStructured(value) && value.forgotten === true;

  const isRestricted = (value) =>
    isStructured(value) && value.restricted === true;

  const isUnauthorized = (value) =>
    isStructured(value) && value.unauthorized === true;

  const isFieldUnavailable = (value) =>
    isForgotten(value) || isRestricted(value) || isUnauthorized(value);

  $: unavailable =
    isFieldUnavailable(data.name) || isFieldUnavailable(data.location);

  const validator = createValidator(customerEditSchema);
  const { errors, isValid } = validator;
  const validate = () => validator.validate(data);

  const save = () => {
    validate().then(() => {
      if ($isValid) {
        postCommand({
          aggregateName: 'customer',
          aggregateId: dataId,
          command: data.newObject ? 'CREATE' : 'UPDATE',
          payload: { name: data.name, location: data.location },
        }).then(() => goto('/customers'));
      }
    });
  };
</script>

{#if unavailable}
  <div class="p-4 bg-red-100 border border-red-300 rounded my-4">
    <p class="font-bold text-red-800">Access Denied</p>
    <p class="text-red-700">You are not authorized to edit this customer, or the customer data is no longer available.</p>
    <Button kind="separate" text="Back to Customers" target="/customers" />
  </div>
{:else}
  <!-- svelte-ignore a11y-label-has-associated-control -->
  <form>
    <div>
      <div class="my-4 flex">
        <label class="mr-4">
          Name
          <TextInput
            name="name"
            autoFocus
            bind:value={data.name}
            on:input={validate}
          />
          <ValidationLabel {errors} field="name" />
        </label>
        <label>
          Location
          <TextInput
            name="location"
            bind:value={data.location}
            on:input={validate}
          />
          <ValidationLabel {errors} field="location" />
        </label>
      </div>
      <div>
        <div>
          <Button
            kind="separate"
            text="Save"
            on:click={save}
            disabled={!$isValid}
          />
          <Button kind="separate" text="Cancel" target="/customers" />
        </div>
      </div>
    </div>
  </form>
{/if}
