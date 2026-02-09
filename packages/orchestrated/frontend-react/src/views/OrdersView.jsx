import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import OrderTable from '../components/OrderTable';

import { useReadModelStore } from '../hooks/useReadModelStore';
import { dataLoaded as ordersViewDataLoaded, dataChanged as ordersViewDataChanged } from '../state/ordersView.slice';

const OrdersView = () => {
  const readModelSpec = useMemo(
    () => ({
      endpoint: 'orders',
      readModel: 'overview',
      resolver: 'all',
      params: {},
    }),
    []
  );
  useReadModelStore(readModelSpec, ordersViewDataLoaded, ordersViewDataChanged);

  const { data } = useSelector(({ ordersView }) => ordersView);

  return <OrderTable data={data} />;
};

export default React.memo(OrdersView);
