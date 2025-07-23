-- Example SQL with complex WHERE clause to test formatting
SELECT 
    p.product_id,
    p.name,
    p.price,
    p.category,
    c.customer_name,
    o.order_date
FROM products p
JOIN orders o ON p.product_id = o.product_id
JOIN customers c ON o.customer_id = c.customer_id
WHERE (p.category = 'Electronics' OR p.category = 'Computers' OR p.category = 'Phones')
  AND p.price > 100
  AND p.status = 'active'
  AND (o.order_date >= '2023-01-01' AND o.order_date <= '2023-12-31')
  AND (c.country = 'USA' OR (c.country = 'Canada' AND c.province IN ('ON', 'BC', 'QC')))
  AND p.stock_quantity > 0
  AND (p.discount > 0.1 OR (p.featured = true AND p.rating >= 4.5));