---
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: run `apk upgrade` in the HyperDX image so it picks up Alpine security fixes
(OpenSSL, zlib) released after the Node and ClickHouse base images were built,
and bump Node from 22.23.4 to 22.23.5 in the image and `.nvmrc`.
