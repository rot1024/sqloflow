-- Example: Simple IN clause with DISTINCT subquery
SELECT name, email
FROM users
WHERE id IN (
  SELECT DISTINCT user_id
  FROM orders
  WHERE total > 100
);