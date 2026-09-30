const computeOrderStats = (orders) => {
  const totalValue = orders.reduce((sum, o) => sum + o.value, 0);
  return {
    totalOrders: orders.length,
    totalValue,
    averageValue: orders.length
      ? Math.round((totalValue / orders.length) * 100) / 100
      : 0,
    byStatus: orders.reduce((acc, o) => {
      acc[o.status] = (acc[o.status] || 0) + 1;
      return acc;
    }, {}),
    // Grouped by customerId (not name) so each entry carries the ID the
    // LLM needs for follow-up queries like query_orders({ customerId })
    topCustomers: Object.values(
      orders.reduce((acc, o) => {
        if (!acc[o.customerId])
          acc[o.customerId] = {
            customerId: o.customerId,
            name: o.customerName,
            count: 0,
            value: 0,
          };
        acc[o.customerId].count++;
        acc[o.customerId].value += o.value;
        return acc;
      }, {}),
    )
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
  };
};

export { computeOrderStats };
