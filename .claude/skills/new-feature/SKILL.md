---
name: new-feature
description: Test-first workflow for implementing a feature request or bug fix in BreakIT. Explore the code and existing tests, write failing Playwright e2e tests before the logic exists, implement, loop until green without weakening the tests, then report. Never commits without confirmation.
---

# New feature workflow

Use this for any feature request, behaviour change, or bug fix in the BreakIT
frontend. The e2e suite is the contract: tests are written before the code,
and the code is changed until they pass.

Work through the steps in order. Do not skip ahead to implementation.

## 1. Explore the codebase

Build a real understanding of the current behaviour before deciding anything.

- Trace the full code path for the request, from UI entry point to engine or
  API and back. Read the files; do not infer from names.
- Identify the *root cause* of a bug or the *actual seam* for a feature. If
  the symptom is in the UI but the cause is in the engine, say so.
- Note every place that will need to change, and every place that reads the
  same state and could be affected.
- Check whether a design spec exists under `docs/specs/` for this area and
  read it if so.

Key areas:

| Area | Where |
|---|---|
| Routing / pages | `src/main.ts`, `src/router.ts`, `src/views/` |
| Sandbox board and controls | `src/sandbox/sandbox-app.ts`, `src/ui/` |
| Simulation engine | `src/game/simulation.ts` |
| Active scenario / traffic | `src/game/scenario-runtime.ts` |
| Component types and capabilities | `src/game/component-taxonomy.ts`, `capabilities.ts`, `component-catalog.ts` |
| Challenge starters | `src/game/challenge-presets.ts` |
| API client and mapping | `src/api/client.ts` |

Watch for legacy-vs-registry type splits: the five hardcoded types in
`COMPONENT_DEFS` (`load-balancer`, `shortener`, `backend`, `database`, `redis`)
versus backend-defined types (`backend-service`, `microservice`, …). Code that
only handles the legacy names is a recurring source of bugs. Use
`getComponentDef` and the taxonomy predicates, never `COMPONENT_DEFS[type]`.

## 2. Explore the existing tests

Find what already covers this path so you extend rather than duplicate.

- Unit tests: `src/**/__tests__/*.test.ts` (Vitest).
- End-to-end tests: `e2e/*.spec.ts` (Playwright).
- Shared e2e infrastructure:
  - `e2e/fixtures/test.ts` — the `api` fixture that mocks every `/api/` call
    at the browser-context level. Use `api.install({...})` to change the data
    for a test, `api.unavailable()` for a dead backend, `api.calls(path)` to
    assert what the app sent.
  - `e2e/fixtures/api-data.ts` — canned challenges and component definitions
    in the exact backend JSON shape, plus `STARTER_PRESETS` describing each
    challenge's starter board.
  - `e2e/helpers/sandbox.ts` — `SandboxPage` page object (place components,
    drag connections, run to the report) and `readReport()`.
- Read the tests nearest to your change end to end. Note the selectors and
  helpers they use so the new tests match.

If the feature needs a new helper or fixture, add it to the shared files
rather than inlining it in one spec.

## 3. Write the e2e tests first

Write Playwright tests that describe the finished behaviour from the user's
point of view, before any implementation exists.

- Put them in the spec file for the surface they touch (`landing`,
  `challenges`, `auth`, `sandbox-scenarios`, `sandbox-editing`) or a new
  `e2e/<area>.spec.ts` if none fits.
- Assert on what the user sees: visible text, element state, counts, the
  end-of-run report. Use `window.__breakitDebug` only for engine state that
  has no visible representation, and only read-only.
- Cover the main path, at least one negative or edge path, and any reset or
  undo path the feature has.
- Run only the new tests and confirm they **fail for the right reason** — a
  missing element or wrong value, not a typo or a bad selector:

  ```bash
  npx playwright test -g "<test name>" --reporter=line
  ```

- If the new tests need a shared helper, write the helper now too.

These tests are now the contract for the rest of the task.

## 4. Implement the change

- Make the smallest change that satisfies the tests. Do not fold in adjacent
  improvements without stating them explicitly.
- Any new or changed shared logic — anything in `src/game/`, `src/api/`, or a
  helper reused across views — gets a Vitest unit test alongside the e2e
  coverage, written as you go, not after.
- If the change exposes a second bug on the same path, fix it only if it
  blocks the tests; otherwise record it for the report.
- Keep `tsc --noEmit` clean as you work.

## 5. Loop until green

Run the full gate, not just the new tests:

```bash
npx tsc --noEmit
npm run typecheck:e2e
npm test
npm run test:e2e
```

Keep changing the **implementation** until everything passes.

**Do not edit the step-3 e2e tests to make them pass.** They encode the
requested behaviour; if they fail, the code is wrong. The only acceptable
edit to an original test is when the test itself was mistaken about the
existing UI (a wrong selector, a wrong assumption about a label). If you make
such an edit, say exactly what and why in the report. Loosening an assertion,
removing a check, or adding `test.fail` to get green is never acceptable.

When the suite is green, run it once more to check for flakiness:

```bash
npx playwright test --reporter=dot
```

Simulation tests run the engine at 100x and are CPU-bound. If they time out
on a loaded machine, that is environment, not code — rerun with
`--workers=2` before concluding anything.

## 6. Report

The final message must stand on its own for someone who did not watch the
work. Include, in this order:

1. **Outcome first.** Green or not, with the numbers (tests passed per suite,
   type checks, build).
2. **Changes made and why.** Per file or per concern: what changed, the
   reason, and the root cause if it was a bug. Call out any judgement call
   you made and any scope you deliberately left out.
3. **Tests implemented, in detail.** Every new or changed test by name, what
   it asserts, and whether it is unit or e2e. State explicitly that the
   step-3 tests were not modified, or list precisely what was and why.
4. **Additional findings.** Bugs noticed but not fixed, areas worth
   improving, inconsistencies between UI rules and engine behaviour, anything
   that surprised you. Point at the file and line.

Do not pad. Leave things out rather than compress them.

## 7. Do not commit

Leave all changes uncommitted in the working tree. Only commit when the user
explicitly confirms; if a commit seems needed for some other reason, ask
first.

## Environment notes

- The suite starts its own Vite dev server on port 4273 and mocks the API in
  the browser; no backend, database, or `.NET` runtime is needed. Set
  `E2E_BASE_URL` to reuse an already running frontend.
- First run on a new machine: `npx playwright install chromium`.
- `npm run test:e2e:ui` opens Playwright UI mode; `npm run test:e2e:report`
  shows the last HTML report; failed runs leave traces and screenshots under
  `test-results/`.
