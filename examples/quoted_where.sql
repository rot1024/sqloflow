-- Test SQL with quoted strings in WHERE clause
SELECT * FROM users
WHERE status = 'pending' AND name = "John's Pizza" AND city IN ('New York', 'Los Angeles');