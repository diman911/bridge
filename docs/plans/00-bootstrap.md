# Bootstrap: Phase 1 of the integration connector bridge

**Status:** draft

Concrete first steps for _this_ repo. Full design (transports,
responsibility boundaries, all four delivery phases, open questions) is
[`../../../chrome-extension/docs/plans/integration-connector-gateway.md`](../../../chrome-extension/docs/plans/integration-connector-gateway.md)
("Phase 1 — establish the contract") — read that first. This file only
exists to make Phase 1 actionable and to track the one decision that gates
everything else.

## Decided: extension compatibility and contract distribution

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

The wire contract is versioned JSON. A version marker appears on commands and
capability manifests. Bridge rejects an incompatible version clearly, while an
extension tolerates additive capability fields it does not know. New
connectors ship in the unified Bridge release and are added to the Control
Plane catalog; the extension must not need provider-specific code for a
connector that stays within the standard protocol fields.

## Protocol v1 decisions

- Supported providers: Jira Cloud and GitHub Issues.
- Operations: create issue, update issue, search issues, and fetch issue.
- Standard write fields: `title` and `description`. Connector-specific form
  fields are out of scope for v1.
- Create/update are synchronous, one provider mutation per operation. The
  result reports the provider response outcome and issue reference.
- v1 has no exactly-once guarantee after an uncertain network failure. Keep
  an idempotency field only if it is useful for observability/future evolution;
  do not claim retry-safe deduplication.
- HAR files and screenshots are native tracker attachments. Commands carry
  short-lived references to separately stored, sanitized Data Plane evidence,
  never binary attachment data or a full recording.
- Control Plane owns tracker-instance configuration and Bridge routing. The
  extension receives only the resolved Bridge address and capabilities; Bridge
  resolves the tracker endpoint/configuration and the caller's personal
  OAuth/PAT credential from Control Plane per command.
- Still open: whether attachment failure after a successful issue mutation is
  reported as partial success or fails the command overall.

## Phase 1 task list

1. **Stabilize the contract** in `packages/bridge-core` (this repo).
   Replace the first draft in `src/types.ts` / `src/connector.ts` with the
   versioned v1 command, read-operation, result, evidence-reference and
   capability schemas above. Include validation and conformance tests.
2. **Vendor the stabilized contract into `../chrome-extension`.**
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

The only protocol-v1 product decision still open here is attachment failure
after a successful issue mutation: return partial success with per-file errors,
or fail the overall command. The source plan carries the remaining transport
and Control Plane questions.
