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
      // The forget cascade (FORGET_RELATED_SUBJECT to orders) is handled by
      // the orders readmodel projection, not the frontend. The frontend only
      // sends FORGET_SUBJECT for the customer aggregate.
      forgetSubject: (subjectId) =>
        postCommand(commandEndpoint, {
          aggregateName: 'customer',
          aggregateId: subjectId,
          command: 'FORGET_SUBJECT',
          payload: { subjectId },
          correlationId: `REACT-${nanoid()}`,
        }),
    }),
    [aggregates, readModelEndpoints, commandEndpoint, changeNotifierEndpoint],
  );
  return (
    <SystemContext.Provider value={context}>{children}</SystemContext.Provider>
  );
};

export { SystemContext, SystemProvider };
