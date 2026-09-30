import { describe, test, expect } from 'vitest';
import { computeOrderStats } from './computeOrderStats.js';

describe('computeOrderStats', () => {
  describe('totalValue', () => {
    test('sums numeric values', () => {
      const orders = [
        { value: 13.99, status: 'new', customerName: 'Alice' },
        { value: 3.99, status: 'new', customerName: 'Alice' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.totalValue).toBeCloseTo(17.98);
      expect(typeof stats.totalValue).toBe('number');
    });

    test('handles single order', () => {
      const orders = [
        { value: 42.5, status: 'new', customerName: 'Alice' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.totalValue).toBe(42.5);
    });
  });

  describe('averageValue', () => {
    test('computes correct average for multiple orders', () => {
      const orders = [
        { value: 10, status: 'new', customerName: 'Alice' },
        { value: 20, status: 'new', customerName: 'Alice' },
        { value: 30, status: 'new', customerName: 'Alice' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.averageValue).toBe(20);
    });

    test('rounds average to two decimal places', () => {
      // 61/3 = 20.3333... → should round to 20.33
      const orders = [
        { value: 10, status: 'new', customerName: 'Alice' },
        { value: 20, status: 'new', customerName: 'Alice' },
        { value: 31, status: 'new', customerName: 'Alice' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.averageValue).toBe(20.33);
    });

    test('handles repeating decimals in average', () => {
      // 10/3 = 3.3333... → should round to 3.33
      const orders = [
        { value: 1, status: 'new', customerName: 'Alice' },
        { value: 3, status: 'new', customerName: 'Alice' },
        { value: 6, status: 'new', customerName: 'Bob' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.averageValue).toBe(3.33);
    });

    test('returns single order value as average for one order', () => {
      const orders = [
        { value: 42.5, status: 'new', customerName: 'Alice' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.averageValue).toBe(42.5);
    });
  });

  describe('empty orders array', () => {
    test('returns zero totalOrders', () => {
      const stats = computeOrderStats([]);
      expect(stats.totalOrders).toBe(0);
    });

    test('returns zero totalValue', () => {
      const stats = computeOrderStats([]);
      expect(stats.totalValue).toBe(0);
    });

    test('returns zero averageValue (not NaN or null)', () => {
      const stats = computeOrderStats([]);
      expect(stats.averageValue).toBe(0);
      expect(typeof stats.averageValue).toBe('number');
      expect(Number.isNaN(stats.averageValue)).toBe(false);
    });

    test('returns empty byStatus', () => {
      const stats = computeOrderStats([]);
      expect(stats.byStatus).toEqual({});
    });

    test('returns empty topCustomers', () => {
      const stats = computeOrderStats([]);
      expect(stats.topCustomers).toEqual([]);
    });
  });

  describe('totalOrders', () => {
    test('counts the number of orders', () => {
      const orders = [
        { value: 10, status: 'new', customerName: 'Alice' },
        { value: 20, status: 'confirmed', customerName: 'Bob' },
        { value: 30, status: 'new', customerName: 'Alice' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.totalOrders).toBe(3);
    });
  });

  describe('byStatus', () => {
    test('counts orders by status', () => {
      const orders = [
        { value: 10, status: 'new', customerName: 'Alice' },
        { value: 20, status: 'confirmed', customerName: 'Bob' },
        { value: 30, status: 'new', customerName: 'Alice' },
        { value: 40, status: 'shipped', customerName: 'Bob' },
        { value: 50, status: 'confirmed', customerName: 'Charlie' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.byStatus).toEqual({
        new: 2,
        confirmed: 2,
        shipped: 1,
      });
    });

    test('handles single status', () => {
      const orders = [
        { value: 10, status: 'new', customerName: 'Alice' },
        { value: 20, status: 'new', customerName: 'Bob' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.byStatus).toEqual({ new: 2 });
    });
  });

  describe('topCustomers', () => {
    test('aggregates count and value per customer', () => {
      const orders = [
        { value: 100, status: 'new', customerId: 'id-Alice', customerName: 'Alice' },
        { value: 200, status: 'new', customerId: 'id-Alice', customerName: 'Alice' },
        { value: 50, status: 'new', customerId: 'id-Bob', customerName: 'Bob' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.topCustomers).toEqual([
        { customerId: 'id-Alice', name: 'Alice', count: 2, value: 300 },
        { customerId: 'id-Bob', name: 'Bob', count: 1, value: 50 },
      ]);
    });

    test('includes the customerId of each customer', () => {
      const orders = [
        { value: 8500, status: 'confirmed', customerId: 'customer-03', customerName: 'Global Logistics AG' },
        { value: 3200, status: 'confirmed', customerId: 'customer-03', customerName: 'Global Logistics AG' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.topCustomers[0]).toEqual({
        customerId: 'customer-03',
        name: 'Global Logistics AG',
        count: 2,
        value: 11700,
      });
    });

    test('groups by customerId, not by name', () => {
      const orders = [
        { value: 100, status: 'new', customerId: 'c1', customerName: 'Same Name' },
        { value: 50, status: 'new', customerId: 'c2', customerName: 'Same Name' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.topCustomers).toEqual([
        { customerId: 'c1', name: 'Same Name', count: 1, value: 100 },
        { customerId: 'c2', name: 'Same Name', count: 1, value: 50 },
      ]);
    });

    test('sorts customers by value descending', () => {
      const orders = [
        { value: 10, status: 'new', customerId: 'id-LowSpender', customerName: 'LowSpender' },
        { value: 500, status: 'new', customerId: 'id-HighSpender', customerName: 'HighSpender' },
        { value: 200, status: 'new', customerId: 'id-MidSpender', customerName: 'MidSpender' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.topCustomers[0].name).toBe('HighSpender');
      expect(stats.topCustomers[1].name).toBe('MidSpender');
      expect(stats.topCustomers[2].name).toBe('LowSpender');
    });

    test('limits to top 5 customers', () => {
      const orders = [
        { value: 100, status: 'new', customerId: 'id-A', customerName: 'A' },
        { value: 90, status: 'new', customerId: 'id-B', customerName: 'B' },
        { value: 80, status: 'new', customerId: 'id-C', customerName: 'C' },
        { value: 70, status: 'new', customerId: 'id-D', customerName: 'D' },
        { value: 60, status: 'new', customerId: 'id-E', customerName: 'E' },
        { value: 50, status: 'new', customerId: 'id-F', customerName: 'F' },
        { value: 40, status: 'new', customerId: 'id-G', customerName: 'G' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.topCustomers).toHaveLength(5);
      expect(stats.topCustomers[0].name).toBe('A');
      expect(stats.topCustomers[4].name).toBe('E');
    });

    test('sums decimal values per customer correctly', () => {
      const orders = [
        { value: 13.99, status: 'new', customerId: 'id-Alice', customerName: 'Alice' },
        { value: 3.99, status: 'new', customerId: 'id-Alice', customerName: 'Alice' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats.topCustomers[0].value).toBeCloseTo(17.98);
    });
  });

  describe('structure', () => {
    test('returns correct structure shape', () => {
      const orders = [
        { value: 10, status: 'new', customerName: 'Alice' },
      ];
      const stats = computeOrderStats(orders);
      expect(stats).toHaveProperty('totalOrders');
      expect(stats).toHaveProperty('totalValue');
      expect(stats).toHaveProperty('averageValue');
      expect(stats).toHaveProperty('byStatus');
      expect(stats).toHaveProperty('topCustomers');
      expect(Object.keys(stats)).toHaveLength(5);
    });
  });
});
