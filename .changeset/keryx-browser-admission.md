---
'@doxajs/compiler': patch
'@doxajs/keryx': patch
'@doxajs/praxis': patch
'@doxajs/realtime': patch
---

Add framework-owned browser admission for separately addressed Keryx listeners. Generated
applications now expose a same-origin authorization route, Realtime obtains a fresh short-lived
ticket before each connection, and Keryx consumes encrypted, origin-bound tickets once locally or
atomically through Redis.
