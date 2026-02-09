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
    }),
    [aggregates, readModelEndpoints, commandEndpoint, changeNotifierEndpoint],
  );
  return (
    <SystemContext.Provider value={context}>{children}</SystemContext.Provider>
  );
};

export { SystemContext, SystemProvider };
