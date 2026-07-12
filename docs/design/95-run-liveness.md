# 95 · Run 假 RUNNING 鲁棒性（P0）

Issue: https://github.com/xforce-io/researcher/issues/95  
Branch: `feat/95-run-liveness`

## Problem

UI can show `RUNNING` + elapsed time while no child process is alive. The copy
claimed the clock proved liveness — false.

## P0 fixes

1. **Unknown / finished task SSE** — `subscribe` immediately `onEnd`s with
   `status: 'error'` / reason `unknown` (or replays terminal status). Stream closes.
2. **Frontend disconnect** — stop timer on `end` or repeated SSE errors; never
   claim “clock = alive”.
3. **Stable CLI entry** — resolve `dist/cli.js` from `import.meta.url`, not
   `process.argv[1]`. Validate path exists before fork; surface fork errors as log lines.

## Out of scope

- Durable task store across serve restarts
- Auto-kill hung children
- Heartbeat-based stall detector (follow-up)
