# Sunstead — Mafia Game Specification

**Status:** Source of truth for the `mafia` game. Code conforms to this spec, not
the reverse. This document describes the system as it _should_ be; where it differs
from current `main`, the delta is called out inline as **[FIX]**, **[NEW]**, or
**[DECISION]**.

This spec is written against the real codebase: a game-agnostic engine
(`engine/`) driving a Mafia plugin (`games/mafia/`), served over SSE by
`app/api/game/route.ts`, with a Three.js/voice client and pgvector long-term
memory. It is not a generic textbook ruleset.

---

## 0. How to use this file

**For humans and for coding assistants (Copilot / Claude) editing this repo:**

1. This document is canonical. If code and spec disagree, the **code is the bug** —
   unless you are deliberately changing the design, in which case edit this spec
   _first_, in the same PR, with a one-line rationale.
2. Before changing game logic, re-read **§3 Invariants**, **§9 Information
   boundaries**, and **§11 Change protocol**. A change that breaks an invariant is
   wrong even if it compiles and "works."
3. **Find the right layer first (§1).** Most "the AI plays badly" problems live in
   the **Agent contract (§8)** — prompts and per-agent context — _not_ the Engine.
   Do not patch the deterministic engine to fix a reasoning problem.
4. Game behavior is controlled by **one config object (§2)**, not by scattered
   `process.env` reads or hardcoded constants. New tunable behavior is added as a
   config field, never as a fresh `MAFIA_*` env var.
5. Use the vocabulary in **§12 Glossary** consistently in code, comments, prompts.

> The invariants in §3 are intentionally short — mirror them into `AGENTS.md`
> (already present and auto-read by assistants) and/or
> `.github/copilot-instructions.md` so they ride along in every assistant context.
> Keep the long-form detail here and reference this file when editing game logic.

---

## 1. System architecture

Four layers. Each owns distinct responsibilities and must not reach across the
boundary.

| Layer                              | Code                                                           | Owns                                                                                                  | Must never                                                        |
| ---------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Engine** (game-agnostic)         | `engine/orchestrator.ts`, `engine/agent.ts`, `engine/types.ts` | The turn loop, phase progression, win-check timing, concurrency, per-seat LLM calls, fallback/timeout | Know any Mafia-specific rule; decide a game outcome itself        |
| **Game plugin** (`GameDefinition`) | `games/mafia/*`                                                | Roles, phases, tools, resolution, win condition, prompts, context                                     | Mutate state outside its own tools/resolvers; read deploy secrets |
| **Host / API**                     | `app/api/game/route.ts`, `engine/human.ts`, `lib/*`            | SSE streaming, play-mode human seat, event filtering, persistence                                     | Contain game rules; leak hidden state to the client (§9)          |
| **Client / Presentation**          | `app/games/mafia/*` (TribunalScene, voice, HUD)                | Rendering what already happened; capturing human input                                                | Be a source of truth for any game state; affect game logic        |

**The load-bearing boundary:** agents **propose**, the Engine **decides**. An LLM
seat returns a tool call ("kill `p3`", "vote `p5`", a line of speech). The tool's
`execute` validates it against phase + role legality, then mutates state. An LLM
output is never trusted as ground truth, and a tool re-checks `legalIn` at call
time even though the seat was only offered legal tools (`agent.ts` does both).

---

## 2. Configuration system **[NEW — this is the settings feature]**

### 2.1 Principle

Today, behavior is split across ~12 `MAFIA_*` env vars (`MAFIA_PARALLEL`,
`MAFIA_DISCUSSION`, `MAFIA_CONTEXT_WINDOW`, `MAFIA_MODEL`, …), hardcoded constants
(`TOWN_SEATS = 5` and the `mafiaCount` clamp in `route.ts`, `DISCUSSION_ROUNDS = 2`
in `phases.ts`), and a few client-sent body fields (`mafiaCount`, `mafiaChance`).
That cannot back a settings UI.

**Target:** one typed, validated `MafiaConfig` object is resolved once per game and
stored on `state.meta.config`. **All** game logic reads from there. `process.env`
keeps only deployment secrets (API keys) and optional _defaults_ for advanced knobs
— never per-game behavior. A change to a setting is one field, read in one place.

```ts
// games/mafia/config.ts  [NEW]
export interface MafiaConfig {
  // — Table —
  tableSize: number; // total seats incl. human in play mode
  mafiaCount: number; // clamped to a strict minority (see §2.4)

  // — Roles —
  enableDetective: boolean;
  enableDoctor: boolean;
  doctorSelfProtect: boolean; // may the Doctor shield itself
  doctorRepeatProtect: boolean; // may it shield the same seat 2 nights running
  detectiveSelfInvestigate: boolean; // may the Detective investigate itself

  // — Rules —
  firstNightKill: boolean; // does the Mafia kill on round 1's night
  revealRoleOnDeath: boolean; // flip dead players' roles face-up
  allowNoLynch: boolean; // may the day end with no elimination
  dayVoteTie: "random" | "no_lynch" | "revote";
  nightKillTie: "random" | "no_kill";
  discussionRounds: number; // speaking passes per discussion (1–4)

  // — AI —
  difficulty: "casual" | "standard" | "cunning"; // selects prompt variant (§8)
  contextWindow: number; // visible transcript lines before recall kicks in
  enableMemoryRecall: boolean; // pgvector contradiction surfacing
  reactiveDiscussion: boolean; // urge-auction scheduler vs fixed seat order
  parallelNight: boolean; // resolve night actions concurrently
  parallelVote: boolean; // resolve votes concurrently
  liveUrge: boolean; // paid: poll each seat's model for a hand-raise
  modelOverride?: string; // force every seat onto one model (else per-seat)

  // — Pacing / presentation (advanced) —
  turnTimeoutMs: number;
  turnDelayMs: number;
  paceMaxMs: number;
  voiceEnabled: boolean;

  // — Determinism —
  seed?: string; // see §10; enables reproducible replay
}
```

### 2.2 Settings catalog

`User` = surfaced in the lobby for everyone. `Advanced` = behind a disclosure /
power-user. `Deploy` = env-only (secrets/infra), not a game setting.

| Field                      | Type    | Default                               | Range / values              | Tier     | Replaces                             |
| -------------------------- | ------- | ------------------------------------- | --------------------------- | -------- | ------------------------------------ |
| `tableSize`                | int     | `6`                                   | 5–10                        | User     | `TOWN_SEATS` + roster slice          |
| `mafiaCount`               | int     | `1` (≤5 seats) / `2` (6–8) / `3` (9+) | 1–3, clamped minority       | User     | `route.ts` clamp, `roleDistribution` |
| `enableDetective`          | bool    | `tableSize ≥ 5`                       | —                           | User     | `roleDistribution` (`n≥5`)           |
| `enableDoctor`             | bool    | `tableSize ≥ 6`                       | —                           | User     | `roleDistribution` (`n≥6`)           |
| `doctorSelfProtect`        | bool    | `true`                                | —                           | User     | hardcoded allow                      |
| `doctorRepeatProtect`      | bool    | `false`                               | —                           | Advanced | `lastProtect` rule                   |
| `detectiveSelfInvestigate` | bool    | `false` **[FIX]**                     | —                           | Advanced | currently _unrestricted_ in tool     |
| `firstNightKill`           | bool    | `false` **[DECISION]**                | —                           | User     | currently effectively `true`         |
| `revealRoleOnDeath`        | bool    | `false`                               | —                           | User     | hardcoded hidden                     |
| `allowNoLynch`             | bool    | `false`                               | —                           | User     | forced vote                          |
| `dayVoteTie`               | enum    | `random` **[FIX]**                    | random / no_lynch / revote  | User     | seat-order bias in `tallyVotes`      |
| `nightKillTie`             | enum    | `random`                              | random / no_kill            | Advanced | `majority()` random                  |
| `discussionRounds`         | int     | `2`                                   | 1–4                         | User     | `DISCUSSION_ROUNDS`                  |
| `difficulty`               | enum    | `standard` **[NEW]**                  | casual / standard / cunning | User     | — (prompts §8)                       |
| `contextWindow`            | int     | `15`                                  | 0 = unlimited, else ≥4      | Advanced | `MAFIA_CONTEXT_WINDOW`               |
| `enableMemoryRecall`       | bool    | `true`                                | —                           | Advanced | `recallForTurn` presence             |
| `reactiveDiscussion`       | bool    | `true`                                | —                           | Advanced | `MAFIA_DISCUSSION`                   |
| `parallelNight`            | bool    | `true`                                | —                           | Advanced | `MAFIA_PARALLEL`                     |
| `parallelVote`             | bool    | `true`                                | —                           | Advanced | `MAFIA_PARALLEL`                     |
| `liveUrge`                 | bool    | `false`                               | —                           | Advanced | `MAFIA_LIVE_URGE`                    |
| `modelOverride`            | string? | unset                                 | gateway/featherless id      | Advanced | `MAFIA_MODEL`                        |
| `turnTimeoutMs`            | int     | `30000`                               | 5k–120k                     | Advanced | `MAFIA_TURN_TIMEOUT_MS`              |
| `turnDelayMs`              | int     | `0`                                   | 0–5000                      | Advanced | `MAFIA_TURN_DELAY_MS`                |
| `paceMaxMs`                | int     | `14000`                               | 0–30000                     | Advanced | `MAFIA_PACE_MAX_MS`                  |
| `voiceEnabled`             | bool    | `true`                                | —                           | User     | —                                    |
| `seed`                     | string? | unset (random)                        | any                         | Advanced | — (§10)                              |
| API keys, gateway routing  | —       | —                                     | —                           | Deploy   | stays env                            |

### 2.3 Gamestyle presets **[NEW]**

A preset is a named bundle the lobby applies in one click; the user may then
fine-tune any field. Store presets as partial `MafiaConfig` patches over the
defaults.

| Preset       | Intent                   | Key overrides                                                                                               |
| ------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Classic**  | Balanced default         | defaults as above                                                                                           |
| **Casual**   | Forgiving, easy to read  | `revealRoleOnDeath: true`, `allowNoLynch: true`, `difficulty: 'casual'`, `discussionRounds: 3`              |
| **Hardcore** | Hidden, ruthless AIs     | `revealRoleOnDeath: false`, `difficulty: 'cunning'`, `firstNightKill: true`, `doctorRepeatProtect: false`   |
| **Chaos**    | Big, fast, unpredictable | `mafiaCount: 3`, `tableSize: 9`, `discussionRounds: 1`, `dayVoteTie: 'random'`, `liveUrge: true`            |
| **Speedrun** | Minimal latency          | `discussionRounds: 1`, `parallelNight: true`, `parallelVote: true`, `turnDelayMs: 0`, `voiceEnabled: false` |
| **Showcase** | Slow, voiced, dramatic   | `voiceEnabled: true`, `paceMaxMs: 14000`, `turnDelayMs: 800`, `reactiveDiscussion: true`                    |

### 2.4 Resolution & validation (invariants on config)

A single `resolveConfig(body): MafiaConfig` produces a fully-defaulted, clamped
config. It runs once in the API route; `setup()` stamps the result onto
`state.meta.config`. These constraints **must** hold after resolution:

1. `1 ≤ mafiaCount < ceil(townCount)` — Mafia is always a **strict minority** at
   game start, so no game opens already decided. (Preserves the current clamp's
   intent: `mafiaCount ≤ floor((tableSize − 1) / 2)`.)
2. `enableDetective` / `enableDoctor` may only be `true` if `tableSize` leaves at
   least one Villager seat after Mafia + specials. Specials are **town**, so they
   never worsen the parity math.
3. `contextWindow` is `0` (unlimited) or `≥ 4`; values in `1..3` are rejected (they
   make recall thrash).
4. In **play mode**, one seat is the human; `tableSize` counts that seat.
5. Every resolved field is logged to the game record alongside `seed` (§10) so the
   game is reproducible and the settings are auditable.

### 2.5 Lobby UI requirements **[NEW]**

- **Preset picker** first (segmented control or dropdown) → applies a §2.3 patch.
- **Toggles** for every boolean User-tier field; **steppers/sliders** for numeric
  ones with the §2.2 ranges as min/max.
- A **live role-composition readout** computed from `tableSize` + `mafiaCount` +
  role toggles, e.g. _"7 players → 2 Mafia, 1 Detective, 1 Doctor, 3 Villagers"_,
  updating as settings change, with §2.4 clamps reflected immediately (grey out
  illegal combinations rather than silently correcting after submit).
- An **Advanced** disclosure hiding the Advanced-tier fields by default.
- The lobby serializes the chosen config into the POST body to `/api/game`;
  nothing game-affecting is read from env on that path.

### 2.6 Migration note

Until every read site is moved onto `state.meta.config`, an env var may _seed a
default_ inside `resolveConfig` (e.g. `MAFIA_PARALLEL=0` → `parallelNight:false`),
but **no game-logic file** (`phases.ts`, `tools.ts`, `prompts.ts`, `index.ts`,
`orchestrator.ts`) may read `process.env` directly for behavior once migrated.
That direct-read removal is the definition of "done" for this feature.

---

## 3. Invariants (MUST always hold)

Testable assertions. A violation is a defect, full stop.

1. **The Engine — never an LLM — decides every outcome:** deaths, vote tallies,
   win conditions. (`winCondition.ts`, `resolveNight`, `tallyVotes`.)
2. **No information leakage:** an agent's context and every client event in play
   mode contain only role-legal information (§9). This includes events on the
   wire, not just prompt text.
3. **Win check runs after every elimination** — after the night resolve _and_
   after the vote tally — via the orchestrator's `while (winner === null)` guard
   plus the post-turn and post-advance checks. The loop cannot run one step past a
   satisfied win condition.
4. **Win conditions are exactly:** all Mafia dead → `village`; `mafia ≥ town` →
   `mafia`; else continue. Nothing else ends the game.
5. **Phase order is fixed:** `NIGHT → DISCUSSION → VOTE → (loop)`. Dawn
   (night resolution/announcement) and Resolution (apply elimination) are folded
   into `advancePhase`, not separate phases — see §4.
6. **Agents propose, Engine validates:** every tool re-checks `legalIn` at execute
   time; illegal calls are rejected, not applied.
7. **Dead players take no turns and emit no game info:** the orchestrator skips
   `!alive` seats; resolvers and `turnOrder` filter to living players.
8. **Every game-affecting tunable comes from `state.meta.config`** (§2), resolved
   once and logged. No behavioral `process.env` reads in game-logic files.
9. **Determinism on demand:** with a `seed` set, the full game is reconstructible
   from the seed + event log (§10).

---

## 4. Phase state machine

Three phases (`PHASE` in `phases.ts`), with dawn and resolution folded into the
transition function:

```
LOBBY ─ resolveConfig + setup (assign roles, seat players) ─► NIGHT

NIGHT        (silent, hidden; parallel if config.parallelNight)
  • Mafia each lock a kill; Detective investigates; Doctor protects
  └─ advancePhase: resolveNight() → announce dawn → WIN CHECK ─► DISCUSSION | END

DISCUSSION   (open; reactive urge-auction if config.reactiveDiscussion)
  • speak / accuse / defend / claim_role across config.discussionRounds passes
  └─ advancePhase ─► VOTE

VOTE         (secret, simultaneous; parallel if config.parallelVote)
  • each living seat votes to eliminate one living player
  └─ advancePhase: tallyVotes() → apply elimination → WIN CHECK ─► NIGHT | END
```

- **Entry/exit are explicit.** A reactive DISCUSSION ends when `nextSpeaker`
  returns `null` (budget spent, or human-requested skip with majority ready). A
  parallel phase ends when all concurrent actors have acted.
- **Naming.** The spec uses the code's names — `DISCUSSION`, not "Day". An earlier
  draft's five-phase naming was wrong for this engine; the code is authoritative.

---

## 5. Night resolution order

`resolveNight()` is deterministic and ordered. Resolution must follow this order
regardless of the order actions were submitted:

```
1. Protections        Doctor's protected seat recorded (config.doctorRepeatProtect
                      gates the consecutive-night repeat).
2. Kill selection     Tally Mafia proposals → target via majority(); ties resolved
                      by config.nightKillTie ('random' default; 'no_kill' option).
3. Investigations     Detective reads target's STATIC role now (before deaths apply),
                      so investigating a seat that dies tonight still yields a result.
4. Apply death        If a target was chosen, is alive, and was NOT protected → dies.
5. Announce dawn      Build the public + event announcement per §9.
```

**Edge cases — defined, not implicit:**

- Target already dead / unresolved name → action fizzles silently, no error line.
- **Mafia self-target** → rejected by `mafia_propose_kill` ("pick a town player").
- **Detective self-target** → rejected unless `config.detectiveSelfInvestigate`.
  **[FIX]** The current `investigate` tool has no self-exclusion; add one mirroring
  the `vote` tool's self-check so an AI Detective can't waste a night on itself.
- **Doctor self-target** → allowed iff `config.doctorSelfProtect`.
- Protected target attacked → kill fails. **Announced anonymously only.** **[FIX]**
  Current `resolveNight` pushes a public NARRATOR line stating that _the doctor
  shielded their target_, which both confirms an attack happened and reveals a
  Doctor exists — visible to the Mafia in the shared transcript. Replace with a
  neutral line (e.g. _"Dawn breaks. No one died."_) unless `revealRoleOnDeath` or a
  future `announceSaves` flag is set. The `{type:'night', outcome:'saved'}` event is
  already anonymous and stays.

---

## 6. Roles

Current set (`roles.ts`). Each declares alignment, night action, what it learns,
and what it must never see.

| Role      | Align | Night action            | Learns                            | Self-target                                 | Must NEVER know                                    |
| --------- | ----- | ----------------------- | --------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| Mafia     | Mafia | Propose 1 kill (shared) | Fellow Mafia + their locked picks | n/a (teammate-blocked)                      | Detective/Doctor identities, investigation results |
| Detective | Town  | Investigate 1 player    | That player's alignment           | Per `detectiveSelfInvestigate` (default no) | The Mafia roster, who the Doctor shielded          |
| Doctor    | Town  | Protect 1 player        | Nothing                           | Per `doctorSelfProtect` (default yes)       | The Mafia roster, the night's kill target          |
| Villager  | Town  | None                    | Nothing                           | n/a                                         | Any hidden role                                    |

`roleDistribution(n, mafiaCount)` builds the multiset; **adding a role is not done**
until it has (a) a row here, (b) a resolution step in §5, (c) a config gate in §2,
and (d) an information-boundary row in §9.

---

## 7. Win conditions

Checked after every elimination (Invariant 3), in `winCondition.ts`:

- `mafiaAlive === 0` → **village wins.**
- `mafiaAlive ≥ townAlive` → **mafia wins** (parity — Mafia can no longer be
  out-voted).
- Otherwise → continue.

Mafia do **not** need to kill everyone; parity is the win. A no-information day
elimination is therefore mathematically Mafia-favorable — it spends a town life
toward parity. This fact must be encoded in town agents' guidance (§8).

---

## 8. AI agent contract _(where "dumb" lives — fix here, not the Engine)_

### 8.1 Turn shape

Every turn is one LLM call split into two **forced** steps (`agent.ts`): first the
private `update_beliefs` (`prep: true` — records reasoning + suspicions + the
on-deck speaking "bid"; does not end the turn), then **exactly one** turn-ending
public action. Forcing the action in its own step is what stops a weak model from
"deliberating" and saying nothing. This two-channel design (private prep vs public
action) satisfies the separation an earlier draft described as one JSON object — it
is an intentional, better-fitting divergence; keep it.

### 8.2 Input contract (per-agent context — `prompts.ts`)

An agent receives only:

- its own role + role-legal private knowledge (`agent.private.knowledge`,
  suspicions, Mafia teammates + their locked picks at night),
- the **windowed** public transcript (`contextWindow`), with a marker that older
  lines scrolled out, plus any pgvector-recalled prior statements as **DATA**,
- the current phase and the legal tool set (`toolsFor` pre-filters by phase+role).

It must never receive: the full role table, another seat's private reasoning, a
night action it isn't party to, or a save/target it shouldn't see.

### 8.3 Behavioral rules (MUST)

- Act only on information in context. **Never claim knowledge the role can't have**
  (a Villager "knowing" someone is Mafia is a hallucination or a leak — both bugs).
- Stay consistent with your own prior public statements; the memory-recall block
  exists to surface contradictions and weight them as Mafia tells.
- **Town plays to win, not to be honest. [FIX]** This is the single biggest current
  gap: the Villager/Detective/Doctor prompts say only _"find and vote out all the
  Mafia."_ They must also instruct: apply pressure, withhold information, bluff when
  useful, and reason about **vote math / parity** (a no-info lynch helps Mafia; at
  parity the game is lost). A perfectly truthful, debate-club town loses.
- **Mafia** blends in as a confused villager; never over-defends a teammate. **[FIX]**
  The current Mafia prompt covers blending and not-over-defending but omits the
  named plays from §12 — add **bussing** (voting out your own teammate for cover)
  and **counterclaiming** (claiming a town power role to muddy a real claimant) as
  explicitly available tools.
- Speak briefly and in-character; no stage directions or narration. Never reference
  being a language model outside the game's fiction.

### 8.4 Difficulty tiers map to prompt variants (`config.difficulty`) **[NEW]**

- `casual` — straightforward reads, minimal bluffing, no counterclaim/bus; town may
  over-share. (Easiest for a human to beat / read.)
- `standard` — the full §8.3 contract.
- `cunning` — aggressive bluffing, parity-aware vote manipulation, proactive
  bussing/counterclaiming, deliberate misdirection from town power roles.

Difficulty changes prompt _content only_; it never changes engine rules or
information boundaries.

### 8.5 Known dumbness failure modes (guard against)

| Symptom                              | Real cause                               | Fix location                              |
| ------------------------------------ | ---------------------------------------- | ----------------------------------------- |
| Town plays honestly, loses           | objective under-specified                | §8.3 town prompt                          |
| No notion of "don't waste the lynch" | parity not encoded                       | §8.3 town prompt                          |
| Mafia never bus/counterclaim         | plays not named                          | §8.3 mafia prompt                         |
| "Knows" hidden info                  | leakage or hallucination                 | §9 / context build                        |
| Round-to-round amnesia               | history scrolled out, recall off/failing | `contextWindow`, `enableMemoryRecall`     |
| Accusing dead players                | dead not flagged                         | already handled in `instruction()` — keep |
| Turn ends with no action             | both steps spent on beliefs              | already fixed by forced 2-step — keep     |

---

## 9. Information boundaries

The API route's play-mode `emit` filter is the wire-level guard. It currently drops
`beliefs`, `whisper` (unless human Mafia), other seats' `action`, and other seats'
`knowledge`. The per-agent prompt is the context-level guard. Both must enforce
this matrix:

| Fact                               | Mafia                       | Detective | Doctor | Villager |
| ---------------------------------- | --------------------------- | --------- | ------ | -------- |
| Own role                           | ✅                          | ✅        | ✅     | ✅       |
| Fellow Mafia + their picks         | ✅                          | ❌        | ❌     | ❌       |
| Own investigation results          | —                           | ✅        | —      | —        |
| Public deaths & votes              | ✅                          | ✅        | ✅     | ✅       |
| Any seat's private reasoning       | ❌                          | ❌        | ❌     | ❌       |
| Night kill target (pre-dawn)       | ✅ (proposer)               | ❌        | ❌     | ❌       |
| A dead player's role (hidden game) | only if `revealRoleOnDeath` |           |        |          |

**Open boundary defects to fix:**

- **[FIX] `death` / `reveal` events carry `role` on the wire.** The play-mode `emit`
  filter does not strip it, so in a hidden-role game every dead seat's true role is
  shipped to the human's browser even though the UI ignores it. Strip `role` from
  these events in play mode unless `revealRoleOnDeath` is set. Defense-in-depth:
  "if a fact isn't ✅, it must not appear anywhere the client can read it."
- **[FIX / DECIDE] `wake` events leak role composition over rounds.** `onTurnStart`
  emits an anonymous `wake` for mafia/detective/doctor each night; across rounds the
  _absence_ of a wake reveals that a special role has died. Compounding bug: under
  the default `parallelNight: true`, the orchestrator's parallel branch never calls
  `onTurnStart`, so the wake narration is **dead code** today. Decide the intent:
  either (a) wire `onTurnStart` into the parallel branch _and_ keep wakes
  non-attributable enough to avoid the composition leak, or (b) drop the wake event
  and narrate night generically. Don't leave it half-wired.

---

## 10. Determinism & replay **[NEW]**

Invariant 9 requires reproducibility when a `seed` is set. Today outcomes depend on
un-logged `Math.random()`: role shuffle (`index.ts`), Mafia kill tiebreak and urge
jitter (`phases.ts`), and the human "pity" Mafia roll (`route.ts`).

- Introduce a single seeded PRNG (`makeRng(seed)`), threaded through setup,
  tiebreaks, urge jitter, and the pity roll. No game-affecting code calls
  `Math.random()` directly.
- When `seed` is unset, generate one, log it, and use it — so any game can be
  replayed after the fact.
- The seed + the event log together fully reconstruct a game. This is what makes
  the §11 "did behavior change?" question answerable, and lets you A/B prompt
  changes (§8) on identical setups instead of fighting RNG + model variance.

> Priority: this is real infrastructure. Build it when you need deterministic
> debugging or fair prompt A/Bs; it is not a blocker for the §8 dumbness fix.

---

## 11. Change protocol (run before merging ANY change)

If any answer is "no," the change isn't ready.

- [ ] Do all §3 invariants still hold?
- [ ] Did I edit the correct **layer** (§1)? Reasoning/skill → §8 prompts; rules →
      game plugin; orchestration → engine.
- [ ] Is there any new path by which an agent or the client receives info it isn't
      entitled to (§9) — in prompt text **or** in a wire event?
- [ ] Does the win check still run after both the night resolve and the vote tally?
- [ ] Is the §5 night resolution order intact (protect → kill → investigate →
      apply → announce), or intentionally changed _and_ re-documented?
- [ ] New/changed role? Updated §6 table, §5 step, §2 config gate, §9 boundary?
- [ ] New tunable behavior? Added as a **config field** (§2), not a `process.env`
      read in a game-logic file (Invariant 8)?
- [ ] If determinism matters here: does the outcome route through the seeded RNG,
      not raw `Math.random()` (§10)?
- [ ] §12 vocabulary used consistently in code, comments, and prompts?

---

## 12. Glossary

- **Parity** — `mafia ≥ town`; the Mafia win condition.
- **Wagon** — the accumulating set of votes forming on one player.
- **Claim** — an agent publicly stating its role (truthfully or not).
- **Counterclaim** — a second agent claiming the _same_ power role to discredit a
  real claimant (a Mafia play against a revealed Detective).
- **Bus** — Mafia voting to eliminate their own teammate for town credibility.
- **Read** — an agent's belief about another player's alignment.
- **No-lynch** — a day ending with no elimination (only if `allowNoLynch`).
- **Urge / bid** — a seat's self-rated pressure to take the discussion floor,
  scored by the reactive scheduler (`urge()` in `phases.ts`).
- **Recall** — pgvector retrieval of prior statements that scrolled out of the
  context window, surfaced as contradiction-spotting DATA.
- **Watch vs play mode** — watch = all-AI table; play = one human seat with the
  §9 event filter active.
