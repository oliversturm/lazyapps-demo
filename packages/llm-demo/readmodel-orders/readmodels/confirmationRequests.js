import { ordersCollectionName } from './overview.js';

export const confirmationRequestsCollectionName =
  'orders_confirmation_requests';

export default {
  projections: {
    ORDER_CONFIRMATION_REQUIRED: (
      {
        storage,
        changeNotification: { sendChangeNotification, createChangeInfo },
      },
      { aggregateId },
    ) =>
      storage
        .find(ordersCollectionName, { id: aggregateId })
        .toArray()
        .then(([order]) => order)
        .then((order) =>
          Promise.all([
            Promise.resolve({
              id: aggregateId,
              text: order.text,
              value: order.value,
              customerId: order.customerId,
              customerName: order.customerName,
              status: 'unconfirmed',
            }).then((newItem) =>
              storage
                .insertOne(confirmationRequestsCollectionName, newItem)
                .then(() =>
                  sendChangeNotification(
                    createChangeInfo(
                      'orders',
                      'confirmationRequests',
                      'all',
                      'addRow',
                      newItem,
                    ),
                  ),
                ),
            ),
            storage
              .updateOne(
                ordersCollectionName,
                { id: aggregateId },
                { $set: { status: 'unconfirmed' } },
              )
              .then(() =>
                sendChangeNotification(
                  createChangeInfo('orders', 'overview', 'all', 'updateRow', {
                    id: aggregateId,
                    status: 'unconfirmed',
                  }),
                ),
              ),
          ]),
        ),

    ORDER_CONFIRMED: (
      {
        storage,
        changeNotification: { sendChangeNotification, createChangeInfo },
      },
      { aggregateId },
    ) =>
      storage
        .updateOne(
          confirmationRequestsCollectionName,
          { id: aggregateId },
          { $set: { status: 'confirmed' } },
        )
        .then(() =>
          sendChangeNotification(
            createChangeInfo(
              'orders',
              'confirmationRequests',
              'all',
              'updateRow',
              {
                id: aggregateId,
                status: 'confirmed',
              },
            ),
          ),
        ),

    ORDER_DECLINED: (
      {
        storage,
        changeNotification: { sendChangeNotification, createChangeInfo },
      },
      { aggregateId },
    ) =>
      storage
        .updateOne(
          confirmationRequestsCollectionName,
          { id: aggregateId },
          { $set: { status: 'declined' } },
        )
        .then(() =>
          sendChangeNotification(
            createChangeInfo(
              'orders',
              'confirmationRequests',
              'all',
              'updateRow',
              {
                id: aggregateId,
                status: 'declined',
              },
            ),
          ),
        ),
  },

  resolvers: {
    all: (storage) =>
      storage
        .find(confirmationRequestsCollectionName, {})
        .project({ _id: 0 })
        .toArray(),
  },
};
