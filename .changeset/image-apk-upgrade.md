---
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: run `apk upgrade` in the HyperDX image so it picks up Alpine security fixes
(OpenSSL, zlib) released after the Node and ClickHouse base images were built.
