import { confirmationRequestsCollectionName } from './confirmationRequests.js';
import {
  trendAnalysisSideEffect,
  trendReanalysisSideEffect,
} from './trendAnalysis.js';
import {
  reputationRoutingSideEffect,
  reputationReassessmentSideEffect,
} from './reputationCheck.js';

export const customersCollectionName = 'orders_customers';
export const ordersCollectionName = 'orders_overview';

const persistInitialOrder = (
  storage,
  aggregateId,
  { customerId, text, value },
  { sendChangeNotification, createChangeInfo },
) =>
  storage
    .find(customersCollectionName, { id: customerId })
    .project({ name: 1 })
    .toArray()
    .then(([{ name }]) => name)
    .then((name) =>
      Promise.resolve({
        id: aggregateId,
        customerId,
        text,
        value,
        customerName: name,
        status: 'new',
      }).then(
        (newItem) =>
          storage
            .insertOne(ordersCollectionName, newItem)
            .then(() =>
              sendChangeNotification(
                createChangeInfo(
                  'orders',
                  'overview',
                  'all',
                  'addRow',
                  newItem,
                ),
              ),
            )
            .then(() => newItem), // for further processing
      ),
    );

const confirmOrder = (
  storage,
  { sendChangeNotification, createChangeInfo },
  orderId,
) =>
  Promise.all([
    storage.updateOne(
      ordersCollectionName,
      { id: orderId },
      { $set: { status: 'confirmed' } },
    ),
    sendChangeNotification(
      createChangeInfo('orders', 'overview', 'all', 'updateRow', {
        id: orderId,
        status: 'confirmed',
      }),
    ),
  ]);

export default {
  projections: {
    CUSTOMER_CREATED: ({ storage }, { aggregateId, payload: { name } }) =>
      storage.insertOne(customersCollectionName, { id: aggregateId, name }),

    CUSTOMER_UPDATED: (
      {
        storage,
        changeNotification: { sendChangeNotification, createChangeInfo },
      },
      { aggregateId, payload: { name } },
    ) =>
      Promise.all([
        storage.updateOne(
          customersCollectionName,
          { id: aggregateId },
          { $set: { name } },
        ),
        storage
          .updateMany(
            ordersCollectionName,
            { customerId: aggregateId },
            { $set: { customerName: name } },
          )
          .then(() =>
            // There is no feature that would allow to signal the criterion-
            // based update that was run here, so we indicate a change that
            // requires a full reload
            sendChangeNotification(
              createChangeInfo('orders', 'overview', 'all', 'all'),
            ),
          ),
        storage
          .updateMany(
            confirmationRequestsCollectionName,
            { customerId: aggregateId },
            { $set: { customerName: name } },
          )
          .then(() =>
            sendChangeNotification(
              createChangeInfo('orders', 'confirmationRequests', 'all', 'all'),
            ),
          ),
      ]),

    ORDER_CREATED: (
      { storage, sideEffects, commands, changeNotification },
      { aggregateId, payload },
    ) =>
      persistInitialOrder(
        storage,
        aggregateId,
        payload,
        changeNotification,
      ).then((order) =>
        Promise.all([
          sideEffects.schedule(
            reputationRoutingSideEffect(storage, commands, order),
            { name: 'Reputation routing', execution: 'liveOnly' },
          ),
          sideEffects.schedule(
            trendAnalysisSideEffect(
              storage,
              commands,
              order.customerId,
              order.customerName,
            ),
            { name: 'Trend analysis check', execution: 'liveOnly' },
          ),
        ]),
      ),

    ORDER_CONFIRMED: (
      { storage, sideEffects, commands, changeNotification },
      { aggregateId },
    ) =>
      confirmOrder(storage, changeNotification, aggregateId).then(() =>
        Promise.all([
          sideEffects.schedule(
            reputationReassessmentSideEffect(
              storage,
              commands,
              aggregateId,
              'ORDER_CONFIRMED',
            ),
            { name: 'Reputation reassessment', execution: 'liveOnly' },
          ),
          sideEffects.schedule(
            trendReanalysisSideEffect(
              storage,
              commands,
              aggregateId,
              'ORDER_CONFIRMED',
            ),
            { name: 'Trend reanalysis', execution: 'liveOnly' },
          ),
        ]),
      ),

    ORDER_DECLINED: (
      {
        storage,
        sideEffects,
        commands,
        changeNotification: { sendChangeNotification, createChangeInfo },
      },
      { aggregateId },
    ) =>
      Promise.all([
        storage.updateOne(
          ordersCollectionName,
          { id: aggregateId },
          { $set: { status: 'declined' } },
        ),
        sendChangeNotification(
          createChangeInfo('orders', 'overview', 'all', 'updateRow', {
            id: aggregateId,
            status: 'declined',
          }),
        ),
      ]).then(() =>
        Promise.all([
          sideEffects.schedule(
            reputationReassessmentSideEffect(
              storage,
              commands,
              aggregateId,
              'ORDER_DECLINED',
            ),
            { name: 'Reputation reassessment', execution: 'liveOnly' },
          ),
          sideEffects.schedule(
            trendReanalysisSideEffect(
              storage,
              commands,
              aggregateId,
              'ORDER_DECLINED',
            ),
            { name: 'Trend reanalysis', execution: 'liveOnly' },
          ),
        ]),
      ),
  },

  resolvers: {
    all: (storage) =>
      storage.find(ordersCollectionName, {}).project({ _id: 0 }).toArray(),
    customerById: (storage, { id }) =>
      storage
        .find(customersCollectionName, { id })
        .project({ _id: 0 })
        .toArray(),
    ordersByCustomerId: (storage, { customerId }) =>
      storage.find(ordersCollectionName, { customerId }).toArray(),
  },
};
