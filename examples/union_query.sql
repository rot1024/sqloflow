-- Example: UNION ALL query combining users and organizations
SELECT id, name, 'user' AS source
FROM users
UNION ALL
SELECT id, company_name AS name, 'org' AS source
FROM organizations;