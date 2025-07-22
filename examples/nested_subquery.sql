-- Example: Nested subqueries (2 levels)
SELECT * 
FROM orders 
WHERE amount > (
  SELECT AVG(amount) 
  FROM orders 
  WHERE customer_id IN (
    SELECT id 
    FROM customers 
    WHERE country = 'JP'
  )
);