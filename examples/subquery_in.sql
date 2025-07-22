-- Example: IN clause with subquery
SELECT u.id, u.name
FROM users u
WHERE u.id IN (
  SELECT o.user_id
  FROM orders o
  WHERE o.total_amount > 100000
);