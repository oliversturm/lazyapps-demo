import React from 'react';
import { Table, Tbody, Td, Th, Thead, Tr } from './Table';
import { Working } from './Working';
import Button from './Button.jsx';
import { useAuth } from './AuthProvider';

const displayValue = (value) =>
  value && typeof value === 'object' && typeof value.text === 'string'
    ? value.text
    : value;

const OrderConfirmationRequestsTable = ({ data, onConfirm }) => {
  const { roles } = useAuth();
  const canConfirm = (roles || []).includes('admin') || (roles || []).includes('customer-service');
  return data ? (
    <Table>
      <Thead>
        <Tr>
          <Th>Order Id</Th>
          <Th>Text</Th>
          <Th>Value</Th>
          <Th>Customer</Th>
          <Th>Status</Th>
          <Th>Action</Th>
        </Tr>
      </Thead>
      <Tbody>
        {data.map((row) => (
          <Tr key={row.id}>
            <Td>{row.id}</Td>
            <Td>{row.text}</Td>
            <Td>{row.value}</Td>
            <Td>{displayValue(row.customerName)}</Td>
            <Td warn={row.status !== 'confirmed'}>{row.status}</Td>
            <Td>
              {row.status === 'unconfirmed' && canConfirm && (
                <Button
                  kind="inline"
                  onClick={() => onConfirm(row.id)}
                  text="Confirm"
                />
              )}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  ) : (
    <Working />
  );
};

export default React.memo(OrderConfirmationRequestsTable);
