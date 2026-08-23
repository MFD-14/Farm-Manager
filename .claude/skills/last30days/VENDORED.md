# Vendored: last30days skill

Source: https://github.com/mvanhorn/last30days-skill (MIT, © mvanhorn)
Skill version: 3.21.1

Multi-source research over the last 30 days — Reddit, X, YouTube, TikTok,
Hacker News, Polymarket, GitHub, and web search.

## What was pulled

Only the runtime surface, per the upstream `.skillignore`:

- `SKILL.md`
- `references/`
- `scripts/` (115 files, incl. `scripts/lib/vendor/bird-search`)

Left out deliberately:

- `assets/` — 14M of README demo media (mp3/jpeg/png), referenced nowhere in
  SKILL.md or the scripts. This is the bulk of the size difference.
- `agents/openai.yaml` — host-specific packaging for a non-Claude host.
- `tests/`, `docs/`, `fixtures/`, `mcp/` (a separate Go MCP server),
  `.github/`, translated READMEs, `CHANGELOG.md`.
- Dev/build scripts inside the skill tree: `build-skill.sh`, `compare.sh`,
  `test-v1-vs-v2.sh`, `test_device_auth.py`.

Result: 2.7M installed vs 17M for the full `skills/` tree.

Kept on purpose: `store.py`, `watchlist.py`, `briefing.py` (upstream marks
these optional-but-runtime), and `setup-keychain.sh` / `setup-pass.sh`
(credential-store helpers referenced from `scripts/lib`).

## Runtime requirements

**Python 3.12+ is required** — the code uses PEP 701 nested-quote f-strings
and will not parse on 3.11. This container's default `python3` is 3.11, but
`/usr/bin/python3.12` and `3.13` are present. SKILL.md carries its own
preflight that probes `python3.14 → 3.13 → 3.12 → python3` and exports
`LAST30DAYS_PYTHON`, so no patching was needed; it resolves to 3.13 here.
Override with `LAST30DAYS_PYTHON` if that ever picks wrong.

No pip dependencies (`dependencies = []` upstream). The vendored
`bird-search` X client needs Node ≥22 (`/opt/node22/bin/node` present).

All API keys are optional (`requires.env` is empty upstream) — the skill runs
keyless with reduced coverage. Optional: `SCRAPECREATORS_API_KEY`,
`OPENAI_API_KEY`, `XAI_API_KEY`, `PERPLEXITY_API_KEY`, `BRAVE_API_KEY`,
`AUTH_TOKEN`/`CT0` (X), `BSKY_HANDLE`/`BSKY_APP_PASSWORD`, and others listed
in the SKILL.md frontmatter.

Preflight: `python3.13 .claude/skills/last30days/scripts/last30days.py --preflight`

## Known environment limitation

In this remote container the agent proxy denies CONNECT to reddit.com and
news.ycombinator.com (403, network policy set when the environment was
created). The pipeline runs and exits 0, but those sources report transport
errors. This is an environment policy matter, not a defect in the skill —
it works normally where those hosts are reachable.

## Updating

Re-copy `SKILL.md`, `references/`, and `scripts/` from upstream, then delete
the four dev scripts listed above. Nothing here is patched.
