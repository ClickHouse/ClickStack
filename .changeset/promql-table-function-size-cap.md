---
'@hyperdx/api': patch
---

fix: cap the result size of PromQL queries on the `table-function` backend with
`max_result_bytes` (8 MB). Each row is a whole series, so `max_result_rows`
alone let one wide range query return a body large enough to run the API out of
memory. Such a query now fails with "Limit for result exceeded".
