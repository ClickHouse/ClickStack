---
'@hyperdx/api': patch
---

fix: read request bodies only after the caller is authenticated. An anonymous
request could make the API parse up to 32 MB before answering 401. Public
routes such as login and register now accept bodies up to 100 KB; signed-in
users and API keys keep the 32 MB limit.
