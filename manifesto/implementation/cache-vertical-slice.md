# Cache Vertical Slice

- **Status:** Implemented proof
- **Completed:** 2026-07-10

Doxa owns an injectable `Cache` port with `get`, `put`, atomic `add`, atomic `increment`, `forget`,
and `remember` semantics. Values use Doxa's JSON contract, and TTL is expressed in seconds.

`MemoryCache` provides a deterministic local/test implementation with an injectable clock. Its `add`
and `increment` read/check/write paths contain no asynchronous gap, preserve an existing TTL, and
reject nonnumeric increments without mutation. `PostgresCache` provides the production-shaped proof,
owns its connection lifecycle, stores values in `doxa_cache_entries`, replaces expired entries
atomically, preserves TTL across increments, and is selected through the generated provider graph.
Feature code imports only `Cache`.

The cache schema is an explicit migration; runtime boot never creates it. Remaining MVP work is
Praxis migration/pruning commands, namespace/tag policy, metrics, and a shared adapter conformance
suite.
