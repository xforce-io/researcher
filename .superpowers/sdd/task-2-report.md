# Task 2 report

## RED evidence

Before the production routing change, ran:

```sh
npx vitest run tests/commands/runtime-selection.test.ts
```

Both tests failed for the intended missing-selection mechanism:

- The success case could not read `grok-args.json` (`ENOENT`), proving the configured fake Grok executable was never invoked.
- The failure case resolved with `{ outcome: 'no-queries' }` instead of rejecting, proving the configured non-zero Grok process was bypassed.

The test fixes `RESEARCHER_MILKIE_BIN` to a deterministic successful fake before dynamically importing `runRun`; this makes the RED failure attributable specifically to the hard-coded default adapter rather than an unavailable local Milkie installation.

## GREEN evidence

After replacing production defaults with `createAgentRuntime()`, ran:

```sh
npx vitest run tests/commands/runtime-selection.test.ts
```

Result: 1 file, 2 tests passed. The success test verifies exactly one Grok `-p` invocation and returns `no-queries`; the failure test verifies `soul.err` contains `GROK_CLI_EXIT`.

Also ran the required focused regression suite:

```sh
npx vitest run tests/commands/runtime-selection.test.ts tests/commands/run.test.ts tests/commands/add.test.ts tests/commands/read.test.ts tests/commands/onboard.test.ts tests/web/topic-setup.test.ts
```

Result: 6 files, 20 tests passed.

## Changes

- Replaced default `MilkieAdapter` construction with `createAgentRuntime()` in `run`, `add`, `read`, `onboard`, and web topic setup.
- Kept `runRun` and web topic setup's explicit injected runtime paths unchanged.
- Left `src/web/library-read.ts` on its independent `OpenAITextAdapter` provider.
- Added deterministic production `runRun` integration coverage for configured Grok CLI success and failure artifacts.

## Commit

`7110c0c feat: select configured agent runtime`

## Concerns

None. The new test deliberately imports `runRun` after setting its fallback Milkie environment because `MilkieAdapter` resolves its executable at module load; this isolates and proves the runtime-factory selection behavior.

## Grok-only onboarding preflight repair

### RED evidence

With `runtime: grok-cli`, a fake Grok adapter, and `RESEARCHER_MILKIE_BIN=__researcher_missing_milkie__`, ran:

```sh
npm test -- tests/commands/onboard.test.ts
```

Result: 1 failed test. `runOnboard` threw `milkie CLI not found` from `preFlight` before the fake Grok adapter could invoke.

### GREEN evidence

After constructing the configured runtime before preflight and restricting the existing `milkie --help` check to the Milkie runtime, reran:

```sh
npm test -- tests/commands/onboard.test.ts
```

Result: 1 file, 4 tests passed. The new Grok-only case reached exactly one fake Grok invocation with no Milkie binary; the new default-runtime case still rejects when Milkie is unavailable.

### Files and commit

- `src/commands/onboard.ts`
- `tests/commands/onboard.test.ts`
- `8ae94f9 fix: skip Milkie preflight for Grok onboarding`
