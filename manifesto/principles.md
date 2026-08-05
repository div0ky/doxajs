# Doxa Principles

These principles are the working tests derived from the [Doxa Manifesto](index.md). They are not a
second manifesto. They exist to make the manifesto useful when choosing APIs, dependencies, and
runtime behavior.

## 1. Doxa owns application semantics

Application code should speak in Doxa and domain vocabulary. A dependency may execute the work, but
it must not decide what a controller, action, model, job, listener, transaction, or application
lifecycle means.

If replacing an infrastructure engine requires rewriting feature code, its boundary has leaked.

## 2. The correct path is the short path

Safe defaults should require less code than bypassing them. Transactions, validation, authorization,
context propagation, durable side effects, observability, and graceful shutdown should compose
through the ordinary programming model.

An escape hatch can be available without becoming the path examples teach first.

## 3. Automatic behavior must remain explainable

Automation is welcome when its phase, ordering, inputs, outputs, and failure behavior are known.
Every automatic behavior should be visible in documentation and inspectable through diagnostics.

If the framework cannot explain what it did, the behavior is too magical.

## 4. Features describe capabilities, not assembly

A feature should reveal the domain operations and interfaces it offers. It should not read like a
manual wiring diagram for routers, database clients, queues, telemetry exporters, and shutdown
hooks.

Infrastructure assembly belongs at the application boundary.

## 5. One concept gets one dominant vocabulary

Doxa should not expose several equivalent ways to express routine work. Aliases and parallel
abstractions increase the amount a developer must learn and make tooling less decisive.

When the ecosystem uses conflicting terms, Doxa chooses one and translates at the adapter boundary.

## 6. Persistence is explicit about durability

Models represent durable domain state, not convenient wrappers around database records. Mutating
operations use a defined unit of work. Entity-state persistence, journal entries, and outbox
messages must agree atomically about what happened.

Lifecycle hooks may participate in defined phases, but they must not hide remote side effects inside
an ambiguous save operation.

## 7. Context follows the work

Actor, tenant, correlation, causation, locale, trace, and other execution metadata should flow
through requests, actions, events, and jobs without application code repeatedly forwarding it.

Propagation rules must be deterministic, and intentional context changes must be visible.

## 8. Boundaries are protected by contracts

An adapter is justified when a dependency's native API would otherwise shape application code. The
contract should model the capability Doxa promises, not every feature of every possible
implementation.

Adapters earn their keep through conformance suites, framework fakes, and replaceability.

## 9. Compatibility is a framework responsibility

A Doxa release is a tested system, not a suggestion that a set of semver ranges might coexist.
Dependency selection, version alignment, configuration defaults, failure behavior, and upgrade notes
belong to the framework release.

Applications upgrade Doxa. They should not independently reconstruct Doxa's compatibility matrix.

## 10. Tooling is part of the framework

Diagnostics, generators, test harnesses, contract output, and lifecycle inspection are not polish to
add after the runtime works. They are how a convention-heavy framework stays understandable.

Every major abstraction should answer: how will a developer inspect, generate, fake, and debug it?

## 11. The kernel grows only from demonstrated need

Doxa should implement the smallest application kernel that can uphold its programming model. Focused
libraries remain preferable for focused technical work.

New kernel concepts require an application-level capability that cannot be expressed coherently by
an existing concept or an adapter.

## 12. Coherence outranks surface area

A smaller set of deeply integrated capabilities is more valuable than a longer feature checklist.
Doxa should add a capability only when it participates in the same lifecycle, context, failure,
testing, and observability model as the rest of the framework.

## 13. Paths organize people, not runtime behavior

Feature declarations and imports define application ownership. Folder and file paths may guide
developers, generators, and source diagnostics, but they must not activate behavior, select scope,
or change manifest identity.

Concrete collaborators should be autowired from declared roots and remain directly unit testable.
Cross-feature sharing must be intentional rather than emerge from a global service namespace.

## 14. Opinionated, safe magic is the product

Doxa should decide every routine choice it can decide safely. It should infer behavior when the
compiler can prove the result, generate repetitive declarations when explicit artifacts are still
valuable, and fail before boot when an application is ambiguous or unsafe.

Do not turn an ordinary design decision into application configuration. A preference is justified
only when applications have a consequential reason to differ and Doxa cannot choose safely on their
behalf. Strong defaults are framework expertise made useful.

The ordinary path must be difficult to misuse and have one consistent shape that is equally clear to
developers, the compiler, and Gnosis. If Gnosis must guess which of several equivalent patterns an
application intended, Doxa has failed to be opinionated enough.

Magic is good when it removes incidental decisions while remaining deterministic, inspectable, and
explainable. Ceremony is justified only when it communicates consequential intent that Doxa cannot
safely infer.

## 15. Build the essential whole

A narrow capability completed across compilation, runtime, security, testing, diagnostics,
documentation, and failure behavior is better than a broad capability completed halfway. Scope may
shrink; integrity may not.

Every new capability starts at no. It must prove that it solves a demonstrated application problem
and changes an important outcome. Merely useful, familiar, flexible, or easy to imagine is not
enough.

## 16. Count the whole cost and prefer less software

The cost of a capability includes its code, permutations, dependencies, security surface,
documentation, diagnostics, tests, compatibility, support, upgrades, and eventual removal. Evaluate
that whole chain before accepting the first line of implementation.

Restate hard problems until the smallest coherent solution appears. Reuse an existing concept, solve
today's demonstrated case, and omit speculative flexibility. Less framework produces fewer ways to
fail and leaves Doxa cheaper to understand and change.

## 17. Solve roots and leave human room

Doxa should solve general application problems deeply, then let developers express uncommon local
conventions in ordinary domain code. Do not grow a specialized subsystem for every workflow people
can state clearly with existing primitives.

An application-owned solution is not a framework failure. Forcing every possible human convention
into framework configuration often is.

## 18. Context outranks consistency

Consistent vocabulary, guarantees, and lifecycle semantics matter. Repeated surface shapes do not
outrank the job being done. APIs, diagnostics, generators, and tools may differ when their contexts
require different information or interaction.

Choose the clearest design for the immediate task. Never preserve symmetry at the cost of
comprehension, safety, or progress.

## 19. One product gets one interface

Ordinary and administrative work should share the same Doxa concepts, application graph,
authorization model, diagnostics, and tooling surface wherever their authority permits. Do not
create a second framework inside the framework for operators or maintainers.

Separate interfaces require a demonstrated security or operational boundary. Convenience alone does
not justify duplicated concepts, screens, commands, or lifecycle behavior.

## A decision test

Before adopting a framework design, ask:

1. Does application code use Doxa and domain vocabulary?
2. Is there one obvious path for ordinary work?
3. Can a developer explain its lifecycle and failure behavior?
4. Can diagnostics show what the framework resolved or executed?
5. Can tests replace it through a Doxa-owned fake or override?
6. Does it preserve transaction and delivery guarantees?
7. Does it keep infrastructure types out of feature code?
8. Can Doxa maintain its compatibility contract over time?
9. Is the capability worth increasing the kernel's conceptual size?
10. Is the ordinary API obvious, safely magical, hard to misuse, and deterministic enough for Gnosis
    to understand without guessing?
11. Does this need to be configurable, or should Doxa decide it?
12. Is the smallest complete capability narrower than the proposal?
13. Does the outcome matter enough to own its full lifetime cost?
14. Can existing concepts and application code solve the root problem?
15. Does context justify any inconsistency or separate interface?

A proposal that repeatedly fails these questions is not yet a Doxa design, even if its local API
looks convenient.
