# ADR-001 — Minimal issue write contract

## Status

Accepted

## Context

The v1 command contract included `technicalSection` for a Bridge-managed
description block and `idempotencyKey` for observability. The first required
provider-specific merge and conflict behaviour; the second did not provide
deduplication or retry safety.

## Decision

Remove both fields from command and attachment metadata. A create command
contains only its routing fields, `subject`, and `description`. An update may
replace the complete description when it supplies one. Attachment replacement
remains identified by `(issueId, filename)`.

## Consequences

Bridge no longer manages a Fairlead-only portion of a provider description and
does not echo a client correlation key. A future retry-safe write design must
introduce both its storage semantics and its wire field in a new protocol
version.
