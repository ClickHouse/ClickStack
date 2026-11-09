---
'@hyperdx/app': minor
---

feat: split the service map by up to 3 extra group-by SQL expressions (for
example `ResourceAttributes['k8s.pod.name']`), so a node is a service plus
those values and a slow or failing pod is no longer averaged into its service.
