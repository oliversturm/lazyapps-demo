import { writable } from 'svelte/store';

// Shared store that pages update with their current data
export const contextDataStore = writable({
  customers: [],
  orders: [],
});

export const requestExplain = (aggregateId, aggregateName, label) => {
  contextDataStore.update((store) => ({
    ...store,
    explainRequest: { aggregateId, aggregateName, label, timestamp: Date.now() },
  }));
};
