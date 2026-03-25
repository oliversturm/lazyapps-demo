import React from 'react';
import Button from './Button';
import { Table, Tbody, Td, Th, Thead, Tr } from './Table';
import { Working } from './Working';
import { useAuth } from './AuthProvider';

const isStructured = (value) =>
  value && typeof value === 'object' && typeof value.text === 'string';

const isForgotten = (value) =>
  isStructured(value) && value.forgotten === true;

const isRestricted = (value) =>
  isStructured(value) && value.restricted === true;

const isUnauthorized = (value) =>
  isStructured(value) && value.unauthorized === true;

const displayValue = (value) =>
  isStructured(value) ? value.text : value;

const CustomerTable = ({ data, rowEdit, onPlaceOrder, onForget }) => {
  const { roles, sub } = useAuth();
  const isAdmin = (roles || []).includes('admin');
  return data ? (
    <Table>
      <Thead>
        <Tr>
          <Th />
          <Th>Id</Th>
          <Th>Name</Th>
        </Tr>
      </Thead>
      <Tbody>
        {data.map((row) => {
          const forgotten = isForgotten(row.name);
          const restricted = isRestricted(row.name);
          const unauthorized = isUnauthorized(row.name);
          const unavailable = forgotten || restricted || unauthorized;
          const isOwner = row.id === sub;
          const canAct = isAdmin || isOwner;
          return (
            <Tr key={row.id}>
              <Td>
                {canAct && (
                  <>
                    <Button
                      kind="inline"
                      onClick={() => rowEdit(row.id)}
                      text="Edit"
                      disabled={unavailable}
                    />
                    <Button
                      kind="inline"
                      onClick={() => onPlaceOrder(row.id)}
                      text="Place Order"
                      disabled={unavailable}
                    />
                    {!unavailable && (
                      <Button
                        kind="inline"
                        onClick={() => onForget(row.id, row.name)}
                        text="Forget"
                      />
                    )}
                  </>
                )}
              </Td>
              <Td>{row.id}</Td>
              <Td>{displayValue(row.name)}</Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  ) : (
    <Working />
  );
};

export default React.memo(CustomerTable);
