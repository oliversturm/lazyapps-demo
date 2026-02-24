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
    topCustomers: Object.entries(
      orders.reduce((acc, o) => {
        if (!acc[o.customerName])
          acc[o.customerName] = { count: 0, value: 0 };
        acc[o.customerName].count++;
        acc[o.customerName].value += o.value;
        return acc;
      }, {}),
    )
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
  };
};

export { computeOrderStats };
