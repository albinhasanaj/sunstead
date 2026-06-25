# Agentic Mafia

A self-running society of AI agents that play Mafia to win — each agent's private
scheming exposed alongside what it says aloud.

## Architecture: a game-agnostic engine + Mafia as a plug-in

The core principle: `engine/` knows nothing about Mafia. Mafia is pure data + rules
plugged in as a `GameDefinition`. Swap the module → different game, same engine.

```
engine/                 GAME-AGNOSTIC. No Mafia anywhere in here.
  types.ts              GameDefinition, AgentState, GameTool, GameEvent contracts
  orchestrator.ts       the hand-written game loop (phases, turns, win check)
  agent.ts              one agent's turn: AI SDK call → tools → events
  events.ts             typed event bus + terminal renderer
games/mafia/            the ONLY Mafia-specific code
  index.ts              the GameDefinition (the plug-in object)
  roles.ts              roles + personalities (themed as AI models) + distribution
  phases.ts             NIGHT → DISCUSSION → VOTE, turn order, resolution
  tools.ts              update_beliefs, speak, accuse, defend, vote, mafia_* ...
  winCondition.ts       all Mafia dead → village; parity → mafia
  prompts.ts            per-role system prompts + dynamic per-turn context
scripts/
  play.ts               Phase 1: run a full game live in the terminal (needs key)
  simulate.ts           engine smoke test with mock agents (NO key, NO tokens)
```

## The core pattern (one turn = one AI SDK call)

Each turn, the agent is forced (`toolChoice: 'required'`, `stepCountIs(2)`) to make
exactly two tool calls: first `update_beliefs` (private reasoning → drives the minds
panel), then one game action (`speak` / `accuse` / `vote` / `mafia_propose_kill` …).
Every tool's `legalIn` enforces phase + role, so a Villager calling
`mafia_propose_kill` is rejected — real constrained tool use.

## Stack

- **Next.js (App Router) + TypeScript**
- **Vercel AI SDK (`ai`) via AI Gateway** — one `AI_GATEWAY_API_KEY`, models as
  `creator/model` strings. **One model per seat**: each AI-named character runs on
  that lab's actual model (`GPT→openai/gpt-oss-120b`, `Claude→anthropic/claude-haiku-4.5`,
  `Gemini→google/gemini-2.5-flash`, `DeepSeek→deepseek/deepseek-v3.1`, `Qwen→alibaba/qwen3-32b`, …).
  Any gateway model works — `roles.ts` is just the default catalog.
- ElevenLabs for voice (Phase 4+), SSE for realtime transport (Phase 2+).

### Models & the free tier

On the AI Gateway **free tier** only some providers are reachable and they
rate-limit hard, so a full game can stall. Knobs:

- `MAFIA_MODEL=anthropic/claude-haiku-4.5` — force every seat onto one reliable model.
- `MAFIA_TURN_DELAY_MS=3500` — space turns to respect per-minute limits.
- `GameDefinition.fallbackModel` retries a failed turn once on a backup model.

Discussion isn't round-robin: each beat an **"urge to speak" auction** picks who
talks. A seat's urge is assembled — with **zero extra LLM calls** — from signals it
already produced in its own `update_beliefs` ("on-deck bid": `pressure`, `holding`,
`triggers`) plus the live transcript: a seat whose self-authored trigger matches the
last line jumps in *even unnamed*, a quieter seat breaks into a two-person duel
(anti-monopoly), and loud/quiet personalities fall out of each seat's trait. See
`urge()` in `games/mafia/phases.ts`; regression-tested token-free by
`pnpm tsx scripts/probe-scheduler.ts`.

- `MAFIA_DEBUG_URGE=1` — log every seat's score + the chosen floor, each beat.
- `MAFIA_LIVE_URGE=1` — **paid tier**: instead of predicting urge, poll each silent
  seat's *own* model for a genuine 1-token "hand-raise" before picking (one request
  per silent seat per beat — too many for the free tier's rate limits).

In **play** mode you're not a scheduled seat — you **interject in real time**. The AIs
talk among themselves (the auction above) but their beats **pace to your voice**: after
each line the loop waits for the client to finish voicing it before the next, so the
table never runs ahead of what you hear. Speak whenever (hold the mic / type) and your
line is folded in at the next beat so the AIs react to *it* — you're always first
priority, and while you're composing no AI takes the floor.

- `MAFIA_PACE_MAX_MS=14000` — safety cap on how long a beat waits for the voice ack.

Mechanics: the client posts `voiceDone` (line finished voicing), `composing` (mic/typing
heartbeat), and `say` (your line) to `/api/game/action`; the SSE loop's `beatHook`
([app/api/game/route.ts](app/api/game/route.ts)) paces + injects accordingly.

Prompt caching is on (`caching: 'auto'`, AI Gateway v4 — needs `ai@7`): the stable
system + transcript prefix is cached, cheaper + faster. Measured on the free tier it
engages for OpenAI and Google (cache reads), but **not** Anthropic.

Verified clean full game:
`MAFIA_MODEL=anthropic/claude-haiku-4.5 MAFIA_TURN_DELAY_MS=3500 pnpm play`.
With paid credits, drop the env overrides and each seat runs its own real model.

## Run it

```bash
pnpm install
cp .env.local.example .env.local   # then add AI_GATEWAY_API_KEY

# Phase 1 — full game, live in the terminal:
pnpm play                          # or: pnpm play GPT Claude Grok Gemini Llama

# Engine smoke test — no API key, no tokens (mock agents drive the real loop):
pnpm tsx scripts/simulate.ts

# The web app (watch OR play):
MAFIA_MODEL=anthropic/claude-haiku-4.5 MAFIA_TURN_DELAY_MS=3000 pnpm dev
#   open http://localhost:3000 →  "Watch" (spectate all minds)  or  "Join game" (play a seat)

pnpm typecheck
```

## Watch vs Play

- **Watch** — every seat is an AI; god view: all roles, live suspicion bars, the
  Mafia's private night channel. This is the "watch them scheme" mode.
- **Join game** — you take one of the seats with a random role (you might be Mafia).
  Fog of war: other roles, AI private reasoning, and the Mafia channel are hidden
  (unless you're Mafia). You act by typing — the server loop pauses on your turn and
  resumes when you submit (`POST /api/game/action`). Voice-in replaces typing in Phase 6.

## Build status

- [x] **Phase 1 — the brain, text only.** Engine + Mafia module + `takeTurn`. Full
      game to a winner; agents record private beliefs and act. Verified via
      `scripts/simulate.ts` (mock, no LLM) and live play with real deception.
- [x] **Phase 2 — structured events over SSE** (`app/api/game/route.ts`).
- [x] **Phase 3 — UI**: table view + transcript + minds panel (deliberately simple;
      a 3D UI replaces it later).
- [x] **Human-in-the-loop**: watch or play a seat via text, with fair fog of war
      (`engine/human.ts`, `app/api/game/action`, `lib/gameSessions.ts`).
- [x] **Phase 4 — voice**: ElevenLabs TTS per seat (`voice/tts.ts`, `voice/voiceMap.ts`,
      `app/api/tts`). The client plays spoken lines in order via an audio queue;
      🔊 master toggle. `eleven_flash_v2_5` (~0.6s/line).
- [x] **Phase 5 — score**: ElevenLabs Music bed that ducks at night + SFX cues on
      night/death/reveal/win (`voice/score.ts`, `app/api/music`, `app/api/sfx`).
      Generated audio is cached in-process (one bed + 4 cues ≈ a few credits total).
- [x] **Phase 6 — human voice-in**: push-to-talk → ElevenLabs Scribe STT → your
      move (`voice/stt.ts`, `app/api/stt`, `usePushToTalk`). Hold 🎤 on your turn.
- [x] **Phase 7 — Detective / Doctor**: dealt in for 5+/6+ player tables. Detective
      investigates (private `knowledge` events, fog-of-war redacted in play mode);
      Doctor protects (cancels the night kill). Human special roles get night-action
      pickers in the UI. Default table is now 6 (2 Mafia + Detective + Doctor + 2 Villagers).
