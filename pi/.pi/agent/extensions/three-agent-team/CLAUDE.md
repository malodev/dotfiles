# CLAUDE.md — three-agent-team

Pi extension that runs the Architect → Builder → Reviewer workflow with a durable
FIFO queue, fenced execution, and crash-resumable journals. The domain language is
in [CONTEXT.md](CONTEXT.md) — use those terms (barrier, epoch, completion seal,
exact commit) rather than ad-hoc names. Owner-facing slash commands and the
workflow contract are in [README.md](README.md).

## Architecture — deepened modules

After the 2026-08-06 architecture review (`/tmp/architecture-review-20260806-235825.html`):

| Module | Interface | Depth win |
|---|---|---|
| `completion-seal.ts` | `freezeCompletionWindow`, `sealCompletion`, `resumeSealedCompletion` | 7 inline calls → 1 interface |
| `session-state.ts` | `createSessionState()` → `SessionState`, `reserveRun`/`releaseRun` | 9 slots + 12 helpers made testable |
| `git.ts` | `git()`, `gitText()`, `gitTextOrEmpty()` | One argv-only adapter, replaces scattered spawns |
| `queue.ts` | `barrier(snapshot)` | One definition, 4 callers |
| `queued-contract-amendment.ts` | `applyQueuedContractAmendment()` | Crash-resumable journaled transaction |
| `amendment-manifest.ts` | `parseAmendmentManifest()` | Strict YAML parser with exact-once edit matching |

`index.ts` is the wiring layer — commands, extension lifecycle, and the glue
between modules. Business logic lives in the modules above.

## Outstanding work

- **Candidate #6 — Fold the Goal Contract renderer into enrollment** (Speculative).
  Goal Contract text rendering is spread across `goal-contract.ts` and the
  enrollment path in `index.ts`. One module would own both.
- **Candidate #5 companion skill** (`skills/team-amend-contracts/SKILL.md`)
  is written but the skill directory is minimal — only SKILL.md. No assets or
  sub-agents yet; add them when the skill grows beyond a single recipe.

## Architectural decisions

- **Depth over ratio.** Depth is leverage at the interface, not a
  implementation-lines ÷ interface-lines ratio. A module is deep when callers get
  more capability per unit of interface they learn.
- **The interface is the test surface.** Tests cross the same seam as callers.
  If a test needs to reach past the interface, the module is the wrong shape.
- **One adapter is hypothetical; two is real.** Don't introduce a seam unless
  something actually varies across it.
- **Exact commits, never `reset --hard`.** Every commit is built with
  `git commit-tree` from an explicit path universe and installed with
  `git update-ref` compare-and-swap. This extension never adopts an arbitrary
  HEAD.
- **Queue epochs advance atomically.** A new epoch starts only when
  `expectedHead` advances outside normal task completion — always by retaining
  only nonterminal entries, never by a bespoke retention rule per call site.

## Testing

- **203 tests, all passing.** Run: `npm run test:node` (unit + integration).
- `test:unit` — fast, no git subprocess: `core.test.ts`, `git.test.ts`,
  `amendment-manifest.test.ts`, `session-state.test.ts`, `queue.test.ts`,
  `plan-manifest.test.ts`, `plan-import-strictness.test.ts`
- `test:integration` — real git repos, real validator: `queue.integration.test.ts`,
  `queued-contract-amendment.test.ts`, `completion-seal.test.ts`,
  `team-go-completion.test.ts`, `recovery-finalization.test.ts`,
  `plan-import.test.ts`, `plan-import-apply.test.ts`, `plan-import-crash.test.ts`,
  `plan-import-handler.test.ts`
- `test:production` — crash matrices and production handler tests
- `test:validator` — Python validator unit tests (`python -m unittest`)
- Integration tests write state to `defaultDurableStateRoot()`; each test cleans
  up its own `repositoryKey` subtree. If a test crashes, stale state may
  accumulate there — `rm -rf` the authorizations subdirectory if tests fail
  spuriously.

## Stale docs

Files in `docs/` (`plan.md`, `*_REPORT.md`, `*_FIX_PLAN.md`) date from the
initial build phase before the 2026-08-06 architecture review. They describe
a pre-deepening state and may reference modules or interfaces that no longer
exist. They should be archived or deleted — do not rely on them.
