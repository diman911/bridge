# Bootstrap: Phase 1 of the integration connector bridge

**Status:** draft

Concrete first steps for _this_ repo. Full design (transports,
responsibility boundaries, all four delivery phases, open questions) is
[`../../../chrome-extension/docs/plans/integration-connector-gateway.md`](../../../chrome-extension/docs/plans/integration-connector-gateway.md)
("Phase 1 — establish the contract") — read that first. This file only
exists to make Phase 1 actionable and to track the one decision that gates
everything else.

## Decision needed first: how does the extension consume the contract types?

Phase 1 requires `../chrome-extension` to refactor its built-in Jira/GitHub
paths onto the shared action contract defined here. That means the contract
types in `packages/bridge-core` need to reach a _different repository_.
Options:

| Option                                                                                                                                                                | Trade-off                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Publish `@fairlead/bridge-core` to a registry** (private npm registry or GitHub Packages), consumed as a normal `devDependency`/`dependency` in `chrome-extension` | Versioned, no drift once adopted; requires org registry infra to exist — unconfirmed, check with whoever owns `../control-plane`'s deploy tooling         |
| **Vendor a copy** of the types into `chrome-extension`                                                                                                                | Zero infra, but two copies drift — explicitly the failure mode `docs/processes/ai-workflow.md` warns against for specs; same risk applies to shared types |
| **Codegen from a schema** (e.g. JSON Schema/OpenAPI as source of truth, generate both sides)                                                                          | Most robust long-term, most setup cost; premature before the shape in `packages/bridge-core/src/types.ts` has stabilized                                 |

**Decided: vendoring.** Copy the contract types from `packages/bridge-core`
into `chrome-extension` directly — no registry, no codegen. `bridge-core` is
the source of truth: the contract changes on this repo's side first, and
`chrome-extension` is always the catching-up side, never the other way
around. Because the extension ships through Chrome Web Store review (slower,
less predictable rollout than this repo's own deploys), the contract needs an
explicit compatibility rule rather than assuming both sides update in lockstep
— concretely, a version marker on the capability manifest/command payload so
Bridge can tell which contract version a given extension build is speaking
and either translate for it or reject cleanly, instead of assuming the latest
shape. Revisit registry-publish or codegen later if manual vendoring/sync
becomes the bottleneck once the contract shape has stabilized.

## Phase 1 task list

1. **Stabilize the contract** in `packages/bridge-core` (this repo).
   `src/types.ts` / `src/connector.ts` are a first draft only — the plan's
   "Generic integration contract" section lists the concepts; verdict
   mappings, capability manifest shape, and the exact action list still
   need to be checked against what `jira-client.ts` and `github-client.ts`
   actually support today (see step 3) before calling this stable.
2. **Resolve the cross-repo distribution decision above.**
3. **In `../chrome-extension`: introduce a shared tracker interface.**
   Per `../chrome-extension/docs/specs/issue-tracker-integration.md`,
   there is currently no `ITrackerClient` — `submit.ts` branches on
   `profile.bugTracker` and calls `jira-client.ts`/`github-client.ts`
   directly. This step makes both clients implement `Connector` from this
   package (once distributed), without changing runtime behavior — pure
   refactor, no new transport yet.
4. **In `../control-plane`: add Bridge/connector routing.** Nothing
   today provides a `bridge_id` or capability data to the extension —
   `docs/specs/cp-auth.md` in `chrome-extension` documents `cpFetch()`
   (bearer session) and `getDpToken()` (short-lived token exchange for the
   Data Plane) as the existing CP-auth patterns; a Bridge-routing
   endpoint would likely follow the same token-exchange shape, but this is
   unbuilt and out of this repo's control. Track as an external dependency
   with location TBD in `../control-plane` — don't invent the endpoint
   contract here without confirming with that repo's owner first.
5. **Preserve current behavior throughout.** No-auth direct Jira/GitHub
   and local export must keep working exactly as they do today
   (`../chrome-extension/docs/plans/integration-connector-gateway.md`,
   "Responsibility boundaries" — the extension keeps a direct Jira/GitHub
   mode). Phase 1 is a refactor onto a shared contract, not a behavior
   change.

## Non-goals for this phase

- No `bridge-worker` or `bridge-runner` implementation (Phase 2/3 of the
  source plan).
- No new connector beyond Jira/GitHub.
- No Log Source connector work (separate concern in the source plan).

## Open questions carried forward

See the source plan's "Open questions" section for the full list
(synchronous vs. async actions, audit retention, evidence attachment
policy, credential modes). The one that blocks _this_ phase specifically
is the cross-repo distribution decision above; the rest can be deferred to
Phase 2+.
