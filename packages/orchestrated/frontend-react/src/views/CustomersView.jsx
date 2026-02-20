import React, { useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import Button from '../components/Button';
import CustomerTable from '../components/CustomerTable';

import { useReadModelStore } from '../hooks/useReadModelStore';
import { useForgetSubject } from '../components/SystemContext';
import { dataLoaded as customersViewDataLoaded, dataChanged as customersViewDataChanged } from '../state/customersView.slice';
import { customerView, orderView } from '../state/navigation.slice';

const CustomersView = () => {
  const dispatch = useDispatch();
  const forgetSubject = useForgetSubject();
  const onNewCustomer = useCallback(() => {
    dispatch(customerView());
  }, [dispatch]);
  const rowEdit = useCallback(
    id => {
      dispatch(customerView(id));
    },
    [dispatch]
  );
  const onPlaceOrder = useCallback(
    id => {
      dispatch(orderView(id));
    },
    [dispatch]
  );
  const onForget = useCallback(
    (id, name) => {
      if (confirm(`Forget customer "${name}"? This cannot be undone.`)) {
        forgetSubject(id);
      }
    },
    [forgetSubject]
  );

  const readModelSpec = useMemo(
    () => ({
      endpoint: 'customers',
      readModel: 'overview',
      resolver: 'all',
      params: {},
    }),
    []
  );
  useReadModelStore(readModelSpec, customersViewDataLoaded, customersViewDataChanged);

  const { data } = useSelector(({ customersView }) => customersView);

  return (
    <div>
      <CustomerTable
        data={data}
        rowEdit={rowEdit}
        onPlaceOrder={onPlaceOrder}
        onForget={onForget}
      />
      <Button kind="separate" onClick={onNewCustomer} text="New Customer" />
    </div>
  );
};

export default React.memo(CustomersView);
