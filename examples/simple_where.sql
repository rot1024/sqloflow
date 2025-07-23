-- Simple WHERE clause to test formatting
SELECT * FROM users
WHERE status = 'active' AND created_at > '2023-01-01' AND (role = 'admin' OR role = 'moderator');