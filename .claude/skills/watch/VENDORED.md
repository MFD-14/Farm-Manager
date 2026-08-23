# Vendored: watch skill

Source: https://github.com/bradautomates/claude-video (MIT, © Bradley Bonanno)
Skill version: 0.2.0

Only the runtime surface is vendored here, per the upstream `.skillignore`:
`skills/watch/SKILL.md` + `skills/watch/scripts/*.py`. Tests, CI workflows,
release tooling (`build-skill.sh`), the SessionStart hook, and the
Codex/Agents packaging manifests are intentionally not pulled — they are
development/packaging artifacts, not needed to run `/watch`.

## Runtime requirements

The scripts are pure Python stdlib. External binaries only:

- `ffmpeg` / `ffprobe` — frame extraction
- `yt-dlp` — video download + caption fetch

Optional: `GROQ_API_KEY` or `OPENAI_API_KEY` in `~/.config/watch/.env` for
Whisper transcription fallback. Without a key, videos lacking native captions
return frames only.

Preflight: `python3 .claude/skills/watch/scripts/setup.py --check`

## Updating

Re-copy `SKILL.md` and `scripts/*.py` from upstream; nothing here is patched.
