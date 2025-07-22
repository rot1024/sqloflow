-- Example: Scalar subquery
SELECT o.id, o.total_amount
FROM orders o
WHERE o.total_amount = (
  SELECT MAX(total_amount)
  FROM orders
  WHERE customer_id = o.customer_id
);