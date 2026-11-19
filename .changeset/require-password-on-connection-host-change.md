---
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: require the password when changing a connection's host

Updating a connection's host without sending its password used to keep the stored password, so it would be sent to the new host on the next query. Both `PUT /connections/:id` and `PUT /api/v2/connections/:id` now return 400 in that case. Prometheus endpoints never use the stored password, so it is cleared instead. The connection form asks for the password when the host is edited and shows the API's error message.
