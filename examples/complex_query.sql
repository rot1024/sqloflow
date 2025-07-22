-- Example: Complex query with all clauses
SELECT 
  category,
  COUNT(*) as total_products,
  AVG(price) as avg_price,
  MAX(price) as max_price
FROM products
WHERE status = 'active' AND price > 10
GROUP BY category
HAVING COUNT(*) > 5
ORDER BY total_products DESC, avg_price ASC
LIMIT 10 OFFSET 20;