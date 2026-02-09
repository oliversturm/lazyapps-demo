import { useContext, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import io from 'socket.io-client';
import { nanoid } from 'nanoid';

import { SystemContext } from '../components/SystemContext';

const applyChange = (data, changeInfo) => {
  switch (changeInfo.changeKind) {
    case 'addRow':
      return data.concat(changeInfo.details);

    case 'updateRow':
      return data.map((row) =>
        row.id === changeInfo.details.id
          ? { ...row, ...changeInfo.details }
          : row,
      );

    case 'deleteRow':
      return data.filter((row) => row.id !== changeInfo.details.id);

    default:
      return data;
  }
};

const useReadModelStore = (readModelSpec, dataLoadedAction) => {
  const { readModels, changeNotifierEndpoint } = useContext(SystemContext);
  const dispatch = useDispatch();
  const dataRef = useRef(null);
  const dataLoadedRef = useRef(false);

  useEffect(() => {
    const { endpoint, readModel, resolver, params } = readModelSpec;
    dataRef.current = null;
    dataLoadedRef.current = false;

    const correlationId = `REACT-${nanoid()}`;
    const socket = io(changeNotifierEndpoint, { query: { correlationId } });

    const runQuery = () =>
      readModels[endpoint]
        .query(correlationId, readModel, resolver, params)
        .then((data) => {
          dataRef.current = data;
          dataLoadedRef.current = true;
          dispatch(dataLoadedAction(data));
        });

    socket.on('connect', () => {
      socket.emit(
        'register',
        [
          {
            endpointName: endpoint,
            readModelName: readModel,
            resolverName: resolver,
          },
        ],
        () => runQuery(),
      );
    });

    socket.on('change', (changeInfo) => {
      if (!dataLoadedRef.current) return;
      if (changeInfo.changeKind === 'all') {
        runQuery();
      } else {
        dataRef.current = applyChange(dataRef.current, changeInfo);
        dispatch(dataLoadedAction(dataRef.current));
      }
    });

    return () => socket.disconnect();
  }, [
    readModelSpec,
    dataLoadedAction,
    readModels,
    changeNotifierEndpoint,
    dispatch,
  ]);
};

export { useReadModelStore };
