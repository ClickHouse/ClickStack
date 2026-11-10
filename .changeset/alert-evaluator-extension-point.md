---
'@hyperdx/api': patch
---

feat: add an internal extension point for alert detection strategies; threshold alerts are evaluated as before, and the `alerts.evaluate` metric now carries an `alert_evaluator` attribute
