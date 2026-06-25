// Shared, cross-cutting constants for the Mafia screen. Component-specific
// styling (the intro slot-machine, the night narrator beats) lives alongside the
// component that owns it; this file holds values used across the page + drawers.

// Generous per-phase countdowns (seconds). The timer is a safety net + a skip
// target, never a rush — it's long enough to always finish your move.
export const PHASE_SECS: Record<string, number> = { NIGHT: 90, DISCUSSION: 240, VOTE: 60 };

export const ROLE_STYLE: Record<string, string> = {
  mafia: 'bg-red-500/15 text-red-300 border-red-500/30',
  villager: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  detective: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  doctor: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  unknown: 'border-neutral-700 text-neutral-500',
};

// Shared style for the floating top-right controls (same look as the Transcript button).
export const FLOAT_BTN =
  'flex items-center gap-1.5 rounded-lg border border-neutral-700/70 bg-neutral-950/70 px-3 py-1.5 text-xs text-neutral-300 backdrop-blur transition hover:bg-neutral-800/80 hover:text-neutral-100';
