# Conventional Commit — Reference

Spec: https://www.conventionalcommits.org/en/v1.0.0/#specification

---

## Types

| Type | Use for |
|------|---------|
| `feat` | New feature or user-visible capability |
| `fix` | Bug fix |
| `refactor` | Code restructuring with no behavior change |
| `perf` | Performance improvement |
| `test` | Adding or correcting tests |
| `docs` | Documentation only (README, CLAUDE.md, comments, design docs) |
| `style` | Formatting, whitespace, linting — zero logic change |
| `build` | Build system or dependency changes (pyproject.toml, package.json, uv.lock, Dockerfile) |
| `ci` | CI/CD config (GitHub Actions, compose.yaml, .dockerignore) |
| `chore` | Maintenance that fits no other type (rename, move, cleanup) |
| `revert` | Reverts a previous commit |

---

## Scope — choosing the right one

Pick the smallest module or layer that fully describes what changed.
Omit scope only when the change genuinely touches the whole repo.

| Area | Scope examples |
|------|---------------|
| Backend services | `auth` `quiz` `grading` `snapshots` `llm` `session` `sync` |
| Backend infra | `db` `migrations` `config` `email` |
| Routes | `routes` or specific area e.g. `teacher-routes` |
| Frontend | `ui` `quiz-page` `admin` `api-client` |
| Build/infra | `docker` `deps` `ci` |
| Cross-cutting | leave scope out |

---

## Grouping heuristic (Step 3B)

Cluster unstaged files in this priority order:

1. **Same feature / vertical slice** — route + service + migration + frontend that implement one thing
2. **Same layer** — all service changes, all migration files, all route files (when they don't belong to one feature)
3. **Build & dependencies** — `pyproject.toml`, `uv.lock`, `package.json`, `pnpm-lock.yaml` always together
4. **Config & infra** — `Dockerfile`, `compose.yaml`, `.env.example`, nginx conf
5. **Docs** — `README.md`, `CLAUDE.md`, `docs/**` files
6. **Tests** — test files matching a module, separate commit if unrelated to other changes

Never mix unrelated domains (e.g. auth fix + docs update) in one commit.

---

## Body guidelines

- Blank line between description and body (required by spec)
- Explain **what** changed and **why**, not *how* (the diff already shows how)
- Use bullet list (`-`) for multiple independent changes
- Wrap at ~72 chars per line
- Reference issues in footer: `Closes #42` / `Refs #17` / `See #8`

---

## Examples

```
feat(auth): add JWT secret length validation at startup

Raise EnvironmentError at boot if JWT_SECRET is shorter than 32 chars.
Prevents silent use of weak secrets in production deployments.
```

```
fix(snapshots): catch UniqueViolation on concurrent slug INSERT

Two concurrent requests could race for the same slug; the second INSERT
raised an unhandled psycopg UniqueViolation → 500.
Now catches it and raises Conflict(409) with a descriptive message.
```

```
fix(routes): validate snapshot_id and class_ids types before DB call

- snapshot_id: coerce to int with try/except → 400 on invalid value
- class_ids: check isinstance(list) → 400 on wrong type
- overrides: cast score_id keys to int to prevent silent key-mismatch
  that silently discarded manual score overrides
```

```
build(docker): run app container as non-root user

Add useradd + USER appuser directive. All root-level operations
(COPY entrypoint, chmod, chown -R) complete before the USER switch
so they don't fail with permission errors at build time.
```

```
refactor(grading): extract _parse_json_field helper and guard JSONDecodeError

Centralises JSONB/string coercion used in save_answer and submit_plan.
Catches json.JSONDecodeError to prevent raw stack traces leaking in
error responses when plan or progression fields are malformed.
```

```
docs(llm-grading): incorporate architecture review observations

- Closed-session pending policy: teacher's responsibility to complete
- Protect manual_override from automatic LLM re-evaluation by default;
  force_override_manual=true + explicit UI confirmation required to bypass
- AES-256-GCM with per-credential nonce; re_encrypt_all() for key rotation
- prompt_version slug = first 8 hex chars of SHA-256 content hash
- SSRF: schema allowlist, private-range block, DNS pre-resolution,
  no implicit redirect re-resolution, no second DNS lookup post-validate
```

```
feat(llm-grading)!: replace keyword fallback with pending state for open answers

Open questions without LLM evaluation now stay pending (0 pts) instead
of being silently graded by keyword matching, which was too imprecise.
Frontend shows a provisional-score banner until all open answers are graded.

BREAKING CHANGE: score_open() is no longer called from grade_open_answer().
Existing scores with llm_status='fallback' remain valid but will not be
recalculated automatically.
```

---

## Sensitive file checklist

Files to **never** stage or commit:

- `.env` `.env.*` `*.env` `.env.local` `.env.production`
- `*.pem` `*.key` `*.pfx` `*.p12` `*.crt` (private certs)
- `*secret*` `*credential*` `*password*` `*token*` (unless clearly non-sensitive)
- `uv.lock` `pnpm-lock.yaml` — **safe** to commit (dependency lock files)
- `__pycache__/` `*.pyc` `node_modules/` — never commit
- Database dump files (`*.sql`, `*.dump`) unless explicitly asked

When uncertain, skip the file and flag it in the summary.
