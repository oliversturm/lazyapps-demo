import React, { useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import OrderConfirmationRequestsTable from '../components/OrderConfirmationRequestsTable';
import { useCommands } from '../components/SystemContext';

import { useReadModelStore } from '../hooks/useReadModelStore';
import { dataLoaded as orderConfirmationRequestsViewDataLoaded } from '../state/orderConfirmationRequestsView.slice';

const OrderConfirmationRequestsView = () => {
  const { confirmOrder } = useCommands();

  const onConfirm = useCallback((id) => {
    confirmOrder(id);
  }, []);

  const readModelSpec = useMemo(
    () => ({
      endpoint: 'orders',
      readModel: 'confirmationRequests',
      resolver: 'all',
      params: {},
    }),
    [],
  );
  useReadModelStore(readModelSpec, orderConfirmationRequestsViewDataLoaded);

  const { data } = useSelector(
    ({ orderConfirmationRequestsView }) => orderConfirmationRequestsView,
  );

  return <OrderConfirmationRequestsTable data={data} onConfirm={onConfirm} />;
};

export default React.memo(OrderConfirmationRequestsView);
