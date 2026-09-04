# Docs

This folder holds design and engineering documentation for garden. Two kinds of docs live here: **living docs** that describe current truth and are updated in place, and **point-in-time docs** (specs) that are frozen once merged and serve as the historical record of a decision.

## What's here

- `architecture.md` — living. Where code goes: the layering, the dependency rules between layers, and the state projection at the centre of the server. Read before adding or moving code.
- `testing.md` — living, current testing approach and tooling.
- `design/garden-mock.html` — a static HTML mock of the console UI, a visual reference for the design rather than a doc that gets updated in place.
- `specs/2026-09-03-garden-v1-design.md` — the v1 design spec: scope, architecture, and non-goals.

## Where does my new doc go?

- **Living doc describing current truth** (architecture, testing approach, a future schema or glossary)? Top of `docs/`, named for what it is: `architecture.md`, `testing.md`, etc.
- **Spec** (a technical decision and how it's implemented)? `docs/specs/YYYY-MM-DD-<slug>.md`.
- **PRD** (a user-facing need)? `docs/prds/YYYY-MM-DD-<slug>.md`. No PRD has been written yet, so the directory doesn't exist; the PRD issue template points here, and the first one creates it.
- **Uncommitted implementation plan**? `docs/plans/`. Gitignored, never committed — a plan is working state for the session that wrote it, not project history.

Filenames use `YYYY-MM-DD-<kebab-slug>.md`; the date is the day the doc lands, not a target date. Folders aren't pre-scaffolded — each appears the day it holds its first doc.
