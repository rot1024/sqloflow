CREATE TABLE customer_nation_analysis AS
SELECT
  c_nationkey,
  COUNT(*) AS customer_count,
  AVG(c_acctbal) AS avg_account_balance,
  COUNT(DISTINCT c_mktsegment) AS market_segment_count
FROM
  customer
GROUP BY
  c_nationkey
ORDER BY
  customer_count DESC;