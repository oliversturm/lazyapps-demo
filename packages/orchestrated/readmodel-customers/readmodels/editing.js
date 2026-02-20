const collectionName = 'customers_editing';

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

    SUBJECT_FORGOTTEN: ({ storage }, { payload: { subjectId } }) =>
      storage.deleteMany(collectionName, { id: subjectId }),
  },

  resolvers: {
    byId: (storage, { id }) => {
      return storage.find(collectionName, { id }).project({ _id: 0 }).toArray();
    },
  },
};
