---
'@hyperdx/otel-collector': minor
---

chore(otel-collector): bump base collector to v0.165.0

Upgrade the custom OTel Collector base from contrib v0.155.0 (core 1.61.0) to
v0.165.0 (core 1.71.0), picking up upstream Go and dependency CVE fixes in the
collector and OpAMP supervisor binaries.

A custom supervisor config that sets `reports_remote_config` must drop it: the
supervisor refuses to start with it from v0.163.0, and `accepts_remote_config`
now covers both.

`k8sattributes` now emits the stable Kubernetes semantic conventions only. Pod,
node and namespace `labels.*` and `annotations.*` become `label.*` and
`annotation.*`, and `container.image.tag` becomes `container.image.tags`. Set
`OTEL_AGENT_FEATURE_GATE_ARG=--feature-gates=-processor.k8sattributes.DontEmitV0K8sConventions`
to keep emitting the legacy names alongside the new ones while you migrate.
