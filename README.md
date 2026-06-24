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
  `creator/model` strings (default `anthropic/claude-sonnet-4.6`), swappable in one place.
- ElevenLabs for voice (Phase 4+), SSE for realtime transport (Phase 2+).

## Run it

```bash
pnpm install
cp .env.local.example .env.local   # then add AI_GATEWAY_API_KEY

# Phase 1 — full game, live in the terminal:
pnpm play                          # or: pnpm play GPT Claude Grok Gemini Llama

# Engine smoke test — no API key, no tokens (mock agents drive the real loop):
pnpm tsx scripts/simulate.ts

pnpm typecheck
```

## Build status

- [x] **Phase 1 — the brain, text only.** Engine + Mafia module + `takeTurn`. A full
      game plays to a winner; agents record private beliefs and act. Orchestration
      verified end-to-end via `scripts/simulate.ts` (mock policy, no LLM). Live play
      needs `AI_GATEWAY_API_KEY`.
- [ ] Phase 2 — structured events over SSE (`app/api/game/route.ts`).
- [ ] Phase 3 — UI: table view + minds panel.
- [ ] Phase 4 — ElevenLabs TTS on `speak`.
- [ ] Phase 5 — music + SFX.
- [ ] Phase 6 — human voice-in via Scribe.
- [ ] Phase 7 — Detective / Doctor roles (tools + resolution already stubbed in).
