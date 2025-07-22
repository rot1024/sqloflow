-- Example: CTE with JOIN
WITH recent_max AS (
  SELECT customer_id, MAX(total_amount) AS max_total
  FROM orders
  WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY customer_id
)
SELECT o.id, o.total_amount
FROM orders o
JOIN recent_max r ON r.customer_id = o.customer_id
WHERE o.total_amount = r.max_total;