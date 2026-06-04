# CHARTER — <project>

> Shared anchor for all pillars. Each active pillar gets a slice of this file
> (shared core + its own excerpt) synced into its read-only
> `.researcher/charter.md` on every run; the researcher pipeline reads that to
> stay anchored. Edit THIS file — never the synced copy.
>
> Drift surfaces as a `## Charter tension` for human adjudication — **both
> ways**: the pillar may have drifted (fix the pillar), or research may have
> found something real that should update this CHARTER. An anchor, not a
> straitjacket.
>
> **Slicing contract (do not break):**
> - shared core = everything before the first `### ` heading below (north star
>   + invariants — every pillar receives this).
> - per-pillar excerpt = a `### ` block whose heading contains the
>   backtick-wrapped pillar path, e.g. `` ### `trace` ``, until the next
>   `##`/`###` heading.
> - `### ` is therefore RESERVED for per-pillar excerpts. Do not use `### ` for
>   anything else in this file.

---

## 0. North star (shared invariant)

<One paragraph: the overarching goal every pillar serves. Why these pillars,
together, are the foundation for the program — and what is lost without them.>

## 1. Pillar map & shared concept boundaries (shared invariant)

```
<optional ASCII diagram of how the pillars relate — supply axes, schema layer,
cross-cutting axes, feedback layer, etc.>
```

Locked invariants (shared by all pillars; none may redefine these):

- <invariant 1 — a concept that must mean the same thing in every pillar>
- <invariant 2 — a boundary rule for what belongs to which pillar>
- <naming rule — name = function; precise scope lives in each pillar's thesis>

## 2. Per-pillar excerpts (mandate / boundary / interfaces)

<Add one `### ` block per pillar as it starts research. Each pillar receives
shared core (§0 + §1) PLUS its own block below.>

### `<pillar-path>` —— <one-line role>
- **Mandate**: <what this pillar owns and is accountable for>
- **Boundary**: manages <X>; does NOT manage <Y> (that belongs to `<other-pillar>`).
- **Interfaces**: <what it consumes / produces / who observes or governs it>

> Repeat the `### ` block above for each additional pillar.
