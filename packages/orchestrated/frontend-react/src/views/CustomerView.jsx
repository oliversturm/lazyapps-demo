import React, { useMemo, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { withFormik } from 'formik';

import Button from '../components/Button';
import CustomerForm from '../components/CustomerForm';
import { useReadModel, useCommands } from '../components/SystemContext';
import customerEditSchema from '../schemas/customerEditSchema';

import { dataLoaded as customerViewDataLoaded } from '../state/customerView.slice';
import { customersView } from '../state/navigation.slice';
import { Working } from '../components/Working';

const isStructured = (value) =>
  value && typeof value === 'object' && typeof value.text === 'string';

const isFieldUnavailable = (value) =>
  isStructured(value) &&
  (value.forgotten === true ||
    value.restricted === true ||
    value.unauthorized === true);

const FormikCustomerForm = withFormik({
  mapPropsToValues: ({ data }) => customerEditSchema.cast(data || {}),
  validationSchema: customerEditSchema,
  // This option is important if the data value passed from "outside"
  // can change after initial mount - otherwise Formik doesn't notice
  // that change.
  enableReinitialize: true,
  handleSubmit: (
    changedObject,
    {
      setSubmitting,
      props: { updateCustomer, createCustomer, data, customerId },
    }
  ) => {
    (data ? updateCustomer : createCustomer)(customerId, changedObject).then(
      () => {
        setSubmitting(false);
      }
    );
  },
})(CustomerForm);

const CustomerView = () => {
  const dispatch = useDispatch();
  const dataLoaded = useCallback(
    data => {
      dispatch(customerViewDataLoaded(data));
    },
    [dispatch]
  );
  const onCancel = useCallback(() => {
    dispatch(customersView());
  }, [dispatch]);
  const { updateCustomer, createCustomer } = useCommands({
    chainHandler: onCancel,
  });

  const { customerId } = useSelector(state => state.navigation);
  const readModelSpec = useMemo(
    () => ({
      endpoint: 'customers',
      readModel: 'editing',
      resolver: 'byId',
      params: { id: customerId },
    }),
    [customerId]
  );
  useReadModel(readModelSpec, dataLoaded);

  const data = useSelector(({ customerView: { data } }) => data);
  const dataObject = (data && data.length && data[0]) || null;

  const unavailable =
    dataObject &&
    (isFieldUnavailable(dataObject.name) ||
      isFieldUnavailable(dataObject.location));

  if (unavailable) {
    return (
      <div className="container">
        <div className="p-4 bg-red-100 border border-red-300 rounded my-4">
          <p className="font-bold text-red-800">Access Denied</p>
          <p className="text-red-700">
            You are not authorized to edit this customer, or the customer data is
            no longer available.
          </p>
          <Button onClick={onCancel} kind="separate" text="Back to Customers" />
        </div>
      </div>
    );
  }

  return data ? (
    <div className="container">
      <div className="font-bold text-lg">{`${
        dataObject ? 'Edit' : 'Create'
      } Customer`}</div>
      <FormikCustomerForm
        customerId={customerId}
        data={dataObject}
        onCancel={onCancel}
        updateCustomer={updateCustomer}
        createCustomer={createCustomer}
      />
    </div>
  ) : (
    <Working />
  );
};

export default React.memo(CustomerView);
