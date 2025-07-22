-- Example: IN clause with correlated subquery
SELECT p.product_id, p.name
FROM products p
WHERE p.category_id IN (
  SELECT c.category_id
  FROM categories c
  WHERE c.status = 'active'
    AND c.created_date > p.launch_date
);