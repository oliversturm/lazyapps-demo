import React, { useMemo } from 'react';

import { postCommand, query } from './http';
import { nanoid } from 'nanoid';

const SystemContext = React.createContext();

const SystemProvider = ({
  readModelEndpoints = {},
  commandEndpoint,
  changeNotifierEndpoint,
  aggregates = {},
  children,
}) => {
  const context = useMemo(
    () => ({
      changeNotifierEndpoint,
      readModels: Object.keys(readModelEndpoints).reduce(
        (r, v) => ({
          ...r,
          [v]: { query: query(readModelEndpoints[v]) },
        }),
        {},
      ),
      commands: Object.keys(aggregates).reduce(
        (r, aggregateName) => ({
          ...r,
          ...Object.keys(aggregates[aggregateName]).reduce(
            (r, cmdName) => ({
              ...r,
              [cmdName]: (aggregateId, payload) =>
                postCommand(commandEndpoint, {
                  aggregateName,
                  aggregateId,
                  command: aggregates[aggregateName][cmdName],
                  payload,
                  correlationId: `REACT-${nanoid()}`,
                }),
            }),
            {},
          ),
        }),
        {},
      ),
      forgetSubject: (subjectId) =>
        postCommand(commandEndpoint, {
          aggregateName: 'customer',
          aggregateId: subjectId,
          command: 'FORGET_SUBJECT',
          payload: { subjectId },
          correlationId: `REACT-${nanoid()}`,
        }).then(() =>
          query(readModelEndpoints.orders)(
            `REACT-${nanoid()}`,
            'overview',
            'all',
          ).then((orders) =>
            Promise.all(
              (orders || [])
                .filter((o) => o.customerId === subjectId)
                .map((order) =>
                  postCommand(commandEndpoint, {
                    aggregateName: 'order',
                    aggregateId: order.id,
                    command: 'FORGET_RELATED_SUBJECT',
                    payload: {
                      relatedSubjectId: subjectId,
                      relatedSubjectType: 'customer',
                      contexts: ['personal'],
                    },
                    correlationId: `REACT-${nanoid()}`,
                  }),
                ),
            ),
          ),
        ),
    }),
    [aggregates, readModelEndpoints, commandEndpoint, changeNotifierEndpoint],
  );
  return (
    <SystemContext.Provider value={context}>{children}</SystemContext.Provider>
  );
};

export { SystemContext, SystemProvider };
