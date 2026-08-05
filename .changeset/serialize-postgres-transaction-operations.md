---
'@doxajs/core': patch
'@doxajs/postgres-drizzle': patch
'@doxajs/runtime': patch
---

Serialize concurrent model and framework operations on each PostgreSQL transaction client, drain
queued work before cleanup, and report Promise.all overlaps without production warning-log noise.
