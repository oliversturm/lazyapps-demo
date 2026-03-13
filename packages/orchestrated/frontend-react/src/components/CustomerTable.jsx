import React from 'react';
import Button from './Button';
import { Table, Tbody, Td, Th, Thead, Tr } from './Table';
import { Working } from './Working';

const isStructured = (value) =>
  value && typeof value === 'object' && typeof value.text === 'string';

const isForgotten = (value) =>
  isStructured(value) && value.forgotten === true;

const isRestricted = (value) =>
  isStructured(value) && value.restricted === true;

const displayValue = (value) =>
  isStructured(value) ? value.text : value;

const CustomerTable = ({ data, rowEdit, onPlaceOrder, onForget }) => {
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
          const unavailable = forgotten || restricted;
          return (
            <Tr key={row.id}>
              <Td>
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
