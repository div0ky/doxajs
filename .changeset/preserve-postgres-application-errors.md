---
'@doxajs/postgres-drizzle': patch
---

Preserve application and framework errors thrown through PostgreSQL read, write, and shared
framework transactions. Only errors originating from the PostgreSQL driver are translated into a
`PersistenceError` after transaction cleanup.
