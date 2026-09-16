# AI Development Workflow

Rules for working with AI tools (Claude Code, Codex) on this repo. Adapted
from the same convention used across the Fairlead ecosystem's other repos
(`../chrome-extension`, `../control-plane`); kept independently per-repo
rather than shared, so expect drift over time — if a rule here looks
outdated versus a sibling repo, this file wins for _this_ repo.

## Before starting

1. `AGENTS.md` at repo root is auto-loaded — no manual context feeding.
   Codex reads it directly; Claude Code doesn't auto-load `AGENTS.md`
   natively, so `CLAUDE.md` at repo root imports it (`@AGENTS.md`) — edit
   `AGENTS.md`, never `CLAUDE.md`.
2. For non-trivial work, read
   [`../../../chrome-extension/docs/plans/integration-connector-gateway.md`](../../../chrome-extension/docs/plans/integration-connector-gateway.md)
   (the authoritative design for this whole repo) and the relevant
   `docs/specs/*` before touching a subsystem's contract.
3. Know which GitHub Issue (if any) this work closes.

## Where things live

| Kind of content                          | Home                                   | Genre                                 |
| ---------------------------------------- | -------------------------------------- | ------------------------------------- |
| Current-state contract for a subsystem   | `docs/specs/`                          | reference — no changelog narrative    |
| Point-in-time architectural decision     | `docs/architecture/decisions/ADR-*.md` | historical record — links commits/PRs |
| Open multi-step engineering roadmap      | `docs/plans/`                          | working log — closes out when done    |
| Tactical idea, bug, small tech-debt item | GitHub Issue                           | tracked, not filed as a doc           |

**Deciding Issue vs. `docs/plans/`:** if the item is small and
self-contained (one function, one listener, a config knob) → GitHub Issue,
labeled `enhancement` or `tech-debt`. If it needs real design discussion
that spans files/subsystems and carries constraints future implementers
must not silently violate → `docs/plans/<slug>.md`.

## Spec conventions (`docs/specs/`)

- **Name by subsystem, not by feature.** One file per independently
  understandable contract, not one file per thing that shipped.
- **`docs/specs/README.md`** is the index — file → what it covers → which
  package. Update it when adding or retiring a spec file.
- **Reference tone, not narrative.** No dates, no commit hashes, no "found
  in review, fixed in X" — that belongs in git history / the PR that made
  the change, since the spec update lands in the same PR as the code (see
  Definition of Done below). Prefer tables over prose paragraphs.
- **Point at code, don't copy it.** Reference a type/function by name and
  file instead of pasting the definition — a pasted copy goes stale at the
  next refactor.
- **Known gaps → link a GitHub Issue**, don't re-explain the gap in prose.
- **No inline commit/PR links.** `git blame`/`git log` on the spec file
  itself is the audit trail for why it reads as it does. (ADRs are the
  exception — see below.)

## `docs/plans/` conventions

Active-development design doc: narrative, dated updates, commit
references, and open questions are all fine _while the plan is in
flight_ — this is a working log, not a reference doc. Once every item in
a plan has shipped or is superseded:

1. Extract anything of lasting contract value into the owning
   `docs/specs/*` file(s).
2. Either delete the plan file (git history preserves it) or mark it
   `Status: closed — see docs/specs/X.md` and delete the changelog body.

Don't let a plan and a spec both carry the same design content
indefinitely — one of them is stale by construction. This applies across
the `../chrome-extension` plan and this repo too: once a phase of
`integration-connector-gateway.md` ships here, extract the shipped
contract into this repo's own `docs/specs/`, and trim that phase out of
the source plan rather than letting both describe it.

## ADR conventions

Every architectural decision gets an ADR in
`docs/architecture/decisions/`. Unlike specs, ADRs _are_ point-in-time
records — commit/PR links are expected there, not a smell.

## GitHub Issues

- New feature / bug / tactical tech-debt → GitHub Issue.
- An issue may link _forward_ to a spec section so implementers land on
  current-state truth. Specs don't link back to the issues that produced
  them — that direction is what turns a spec into a changelog.

## Definition of done

- If a change affects logic or a contract, the relevant `docs/specs/*`
  file is updated in the **same PR**.
- If the change is architectural, an ADR is added or updated.
- If the change closes a `docs/plans/` item, update that plan (mark done,
  or close/extract per the plan lifecycle above).
- If the change ships a phase of the source plan in
  `../chrome-extension/docs/plans/integration-connector-gateway.md`,
  update that document too (it isn't this repo's to silently drift out of
  sync with).

## Documentation as code

Store architecture diagrams in text form (Mermaid) so AI tools can update
them alongside code.
