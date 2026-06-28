// ── Seeded PRNG (spec §10) ──────────────────────────────────────────────────────
// Determinism on demand: with config.seed set, every game-affecting random draw —
// role shuffle, kill/vote tiebreaks, urge jitter, the human pity roll — comes from
// ONE seeded stream, so seed + event log fully reconstruct a game. No game-affecting
// code calls Math.random() directly. The stream is created from the config seed and
// stashed on state.meta._rng; all draws go through the helpers below in a fixed order.

import type { GameState } from '../../engine/types';

// Mulberry32 — small, fast, good-enough distribution for game logic (not crypto).
export function makeRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The game's RNG, lazily seeded from config and memoised on state.meta. Created once;
// every later call returns the same advancing stream so draws stay deterministic.
export function rngFor(state: GameState): () => number {
  const meta = state.meta as Record<string, unknown>;
  if (typeof meta._rng !== 'function') {
    const seed = (state.meta.config?.seed as string | undefined) || 'mafia';
    meta._rng = makeRng(seed);
  }
  return meta._rng as () => number;
}

// Shuffle with an explicit rng — used by setup(), which deals roles before the rng
// has been stashed on state.meta.
export function shuffleWith<T>(rng: () => number, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const rngFloat = (state: GameState): number => rngFor(state)();
export const rngInt = (state: GameState, n: number): number => Math.floor(rngFor(state)() * n);
export const rngPick = <T>(state: GameState, arr: T[]): T => arr[rngInt(state, arr.length)];
export function rngShuffle<T>(state: GameState, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rngInt(state, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
