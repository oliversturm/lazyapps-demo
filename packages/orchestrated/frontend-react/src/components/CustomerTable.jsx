import React from 'react';
import Button from './Button';
import { Table, Tbody, Td, Th, Thead, Tr } from './Table';
import { Working } from './Working';

const isForgotten = (value) =>
  value && typeof value === 'object' && value.forgotten === true;

const displayValue = (value) =>
  isForgotten(value) ? value.text : value;

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
          return (
            <Tr key={row.id}>
              <Td>
                <Button
                  kind="inline"
                  onClick={() => rowEdit(row.id)}
                  text="Edit"
                  disabled={forgotten}
                />
                <Button
                  kind="inline"
                  onClick={() => onPlaceOrder(row.id)}
                  text="Place Order"
                  disabled={forgotten}
                />
                {!forgotten && (
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
