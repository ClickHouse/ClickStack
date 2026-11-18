---
'@hyperdx/app': patch
'@hyperdx/api': patch
---

feat: Name PromQL sources "Time Series" or "Prometheus" by their connection

The source type for a PromQL source now reads "Time Series" when it queries a
ClickHouse TimeSeries table and "Prometheus" when it queries an external
Prometheus API. Where no connection is known yet, such as the source form before
a connection is picked or a data source variable's kinds, it reads "Time Series
/ Prometheus". The stored kind is still `promql`.

The PromQL source created by onboarding auto-detection and the local dev default
sources is now named "Time Series" instead of "PromQL".
