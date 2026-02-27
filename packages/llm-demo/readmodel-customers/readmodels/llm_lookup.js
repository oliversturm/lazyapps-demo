import Fuse from 'fuse.js';

const collectionName = 'customers_llm_lookup';

const fuseOptions = {
  keys: ['name', 'location'],
  threshold: 0.4,
  includeScore: true,
  shouldSort: true,
};

export default {
  projections: {
    CUSTOMER_CREATED: (
      { storage },
      { aggregateId, payload: { name, location } },
    ) => storage.insertOne(collectionName, { id: aggregateId, name, location }),

    CUSTOMER_UPDATED: (
      { storage },
      { aggregateId, payload: { name, location } },
    ) =>
      storage.updateOne(
        collectionName,
        { id: aggregateId },
        { $set: { name, location } },
      ),
  },

  resolvers: {
    all: (storage) =>
      storage.find(collectionName, {}).project({ _id: 0 }).toArray(),

    search: (storage, { query, limit = 5 }) =>
      storage
        .find(collectionName, {})
        .project({ _id: 0 })
        .toArray()
        .then((customers) => {
          if (!query) return customers.slice(0, limit);
          const fuse = new Fuse(customers, fuseOptions);
          return fuse
            .search(query)
            .slice(0, limit)
            .map((r) => ({ ...r.item, score: r.score }));
        }),
  },
};
