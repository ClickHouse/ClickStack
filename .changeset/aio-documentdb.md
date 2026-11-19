---
'@hyperdx/api': minor
---

feat: store all-in-one metadata in DocumentDB instead of MongoDB 4.0.5

DocumentDB is MIT licensed and runs on Postgres 18, which removes the SSPL
licence and the critical OpenSSL 1.1.1k CVEs that came with the bundled MongoDB.
Metadata still lives on the `/data/db` mount, now under `/data/db/pgdata`. The
image cannot read the MongoDB files already there and starts with an empty
database, so users, sources, dashboards and alerts saved by an older image need
to be moved across once:

1. Stop the old container, then start its MongoDB on its own:
   `docker run -d --name old-mongod -v <volume>:/data/db --entrypoint mongod <old-image> --dbpath /data/db --bind_ip_all`
2. Dump it with the 4.0 tools, since newer `mongodump` refuses MongoDB 4.0:
   `docker run --rm --network container:old-mongod mongo:4.0.5 mongodump --db hyperdx --archive > hyperdx.archive`
3. Remove `old-mongod`, start the new image with the same `/data/db` volume and
   wait for the UI to load.
4. Restore into it, then restart the container:
   `docker run --rm -i --network container:<new-container> mongo:7.0 mongorestore --uri "mongodb://hyperdx:hyperdx@localhost:10260/?authMechanism=SCRAM-SHA-256" --ssl --tlsInsecure --drop --archive < hyperdx.archive`

The old MongoDB files stay in `/data/db` until you delete them.
