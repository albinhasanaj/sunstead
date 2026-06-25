'use client';

import { useEffect, useRef, useState } from 'react';

// ── Menu → gameplay transition ───────────────────────────────────────────────
// Play: a slot-machine that "shuffles" through the roles, then lands on the one
// the engine actually dealt you (revealed by the `setup` event) with a flourish.
// Watch: a short cinematic title beat. Either way it eases out into the scene —
// and conveniently masks the silent first NIGHT while the AI agents act.
const REVEAL_ROLES = ['mafia', 'detective', 'doctor', 'villager'] as const;
const ROLE_META: Record<string, { tag: string; color: string; blurb: string }> = {
  mafia: { tag: 'Mafia', color: '#e0454f', blurb: 'Deceive the town. Strike in the night.' },
  villager: { tag: 'Villager', color: '#34d399', blurb: 'Unmask the Mafia before they pick you off.' },
  detective: { tag: 'Detective', color: '#5fd0ff', blurb: 'Investigate one suspect each night.' },
  doctor: { tag: 'Doctor', color: '#2dd4bf', blurb: 'Shield one soul from death each night.' },
  unknown: { tag: 'Town', color: '#9aa3c0', blurb: 'Take your seat at the table.' },
};

export default function IntroOverlay({ mode, role, onDone }: { mode: 'play' | 'watch'; role: string; onDone: () => void }) {
  const [label, setLabel] = useState<string>(REVEAL_ROLES[0]);
  const [landed, setLanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const roleRef = useRef(role);
  roleRef.current = role;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // Watch: just a title beat, then ease out.
  useEffect(() => {
    if (mode !== 'watch') return;
    const t1 = setTimeout(() => setClosing(true), 2000);
    const t2 = setTimeout(() => doneRef.current(), 2650);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [mode]);

  // Play: decelerating shuffle, then land on the dealt role once it's known.
  useEffect(() => {
    if (mode !== 'play') return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const startedAt = performance.now();
    const MIN_SPIN = 2200; // always spin at least this long
    const MAX_WAIT = 6500; // safety: never hang if setup never arrives
    let delay = 55;

    const land = () => {
      const known = roleRef.current && roleRef.current !== 'unknown';
      const final = known ? roleRef.current : 'villager';
      setLabel(final);
      setLanded(true);
      setTimeout(() => setClosing(true), 2100);
      setTimeout(() => doneRef.current(), 2750);
    };

    const tick = () => {
      if (stopped) return;
      i = (i + 1) % REVEAL_ROLES.length;
      setLabel(REVEAL_ROLES[i]);
      const elapsed = performance.now() - startedAt;
      const known = roleRef.current && roleRef.current !== 'unknown';
      if ((elapsed > MIN_SPIN && known) || elapsed > MAX_WAIT) {
        land();
        return;
      }
      // ramp the interval up near the end for a slot-machine "settle"
      delay = elapsed > MIN_SPIN - 800 ? Math.min(delay + 20, 200) : 55;
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [mode]);

  const meta = ROLE_META[label] ?? ROLE_META.unknown;

  return (
    <div
      className={`absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/85 backdrop-blur-lg transition-opacity duration-700 ${
        closing ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <style>{`
        @keyframes introIn { from { opacity:0; transform:translateY(10px) scale(.94); } to { opacity:1; transform:none; } }
        @keyframes introFlick { 0% { opacity:.25; transform:translateY(-6px) scale(.9); } 100% { opacity:1; transform:none; } }
        @keyframes introPop { 0% { transform:scale(.5); opacity:0; } 55% { transform:scale(1.14); opacity:1; } 100% { transform:scale(1); } }
        @keyframes introPulse { 0%,100% { opacity:.3; transform:scale(1); } 50% { opacity:.6; transform:scale(1.08); } }
        @keyframes introRing { 0% { transform:scale(.5); opacity:.85; } 100% { transform:scale(2.1); opacity:0; } }
        @keyframes introShimmer { 0%,100% { opacity:.25; } 50% { opacity:1; } }
      `}</style>

      {mode === 'watch' ? (
        <div style={{ animation: 'introIn .6s ease both' }} className="flex flex-col items-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.5em] text-amber-300/70">The Tribunal</p>
          <h2 className="mt-4 bg-gradient-to-b from-white to-neutral-400 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
            The table convenes
          </h2>
          <div className="mt-6 flex gap-1.5">
            {[0, 1, 2].map((n) => (
              <span key={n} className="h-1.5 w-1.5 rounded-full bg-amber-300" style={{ animation: `introShimmer 1s ease ${n * 0.18}s infinite` }} />
            ))}
          </div>
        </div>
      ) : (
        <div className="relative flex flex-col items-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.5em] text-neutral-400">
            {landed ? 'Your role' : 'Dealing roles'}
          </p>

          {/* glowing disc behind the role name */}
          <div className="relative mt-7 flex h-44 w-44 items-center justify-center">
            {landed && (
              <span
                className="absolute inset-0 rounded-full"
                style={{ border: `2px solid ${meta.color}`, animation: 'introRing .9s ease-out forwards' }}
              />
            )}
            <span
              className="absolute h-36 w-36 rounded-full blur-2xl"
              style={{ background: meta.color, opacity: landed ? 0.45 : 0.18, animation: landed ? 'none' : 'introPulse 1.1s ease-in-out infinite', transition: 'opacity .5s' }}
            />
            <span
              className="absolute h-40 w-40 rounded-full"
              style={{ border: `1px solid ${meta.color}55` }}
            />
            <div
              key={label + (landed ? '-final' : '')}
              style={{
                color: meta.color,
                textShadow: `0 0 28px ${meta.color}aa`,
                animation: landed ? 'introPop .65s cubic-bezier(.2,.9,.3,1.4) both' : 'introFlick .13s ease both',
              }}
              className="text-3xl font-bold uppercase tracking-[0.12em]"
            >
              {meta.tag}
            </div>
          </div>

          <p
            className="mt-7 h-5 max-w-xs text-center text-sm text-neutral-300 transition-opacity duration-500"
            style={{ opacity: landed ? 1 : 0 }}
          >
            {landed ? meta.blurb : ''}
          </p>
        </div>
      )}
    </div>
  );
}
