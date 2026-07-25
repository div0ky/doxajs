---
'@doxajs/compiler': patch
'@doxajs/core': patch
'@doxajs/keryx': patch
'@doxajs/praxis': patch
'@doxajs/realtime': patch
'@doxajs/runtime': patch
'@doxajs/testing': patch
---

Replace Keryx's alpha protocol and process-local publication model with the production role
contract. `doxa add keryx` now enables framework-owned composition, web roles own authenticated
protocol v2 sockets and signed publish ingress, worker-only roles publish without opening a
listener, and Redis topology provides atomic message deduplication, cross-replica fanout,
distributed presence, readiness loss, and recovery. Realtime now waits for the authenticated
`connected` frame and exposes connection, subscription, and structured error state.
