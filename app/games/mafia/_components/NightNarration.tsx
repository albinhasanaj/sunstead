'use client';

// Night narrator — announces each role's wake-up EXACTLY when it acts, driven by
// `wake` events from the engine (so the table truly takes turns: Mafia, then the
// Detective, then the Doctor — never all at once). Before any role has acted it
// shows the "night falls" hush. Your own role is highlighted; the event is
// anonymous (role only), so it never names who's acting.
const NIGHT_BEATS: Record<string, { eyebrow: string; text: string; color: string }> = {
  '': { eyebrow: 'Night falls', text: 'the town closes its eyes…', color: '#a5b4fc' },
  mafia: { eyebrow: 'The Mafia awaken', text: 'they choose tonight’s victim', color: '#e0454f' },
  detective: { eyebrow: 'The Detective awakens', text: 'seeking out the guilty', color: '#5fd0ff' },
  doctor: { eyebrow: 'The Doctor awakens', text: 'shielding a soul from harm', color: '#2dd4bf' },
};

export default function NightNarration({ wake, myRole }: { wake: string | null; myRole: string }) {
  const b = NIGHT_BEATS[wake ?? ''] ?? NIGHT_BEATS[''];
  const mine = !!wake && wake === myRole;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[26%] z-30 flex justify-center px-6">
      {/* re-key on `wake` so each new actor animates in fresh */}
      <div key={wake ?? 'sleep'} className="night-beat text-center">
        <div className="text-xs font-semibold uppercase tracking-[0.5em]" style={{ color: mine ? b.color : b.color + 'b0', textShadow: `0 0 18px ${b.color}66` }}>
          {b.eyebrow}
          {mine && ' — that’s you'}
        </div>
        <div className="mt-2 text-lg font-light tracking-[0.22em] text-indigo-50/85">{b.text}</div>
      </div>
      <style>{`
        @keyframes nightBeat { 0%{opacity:0; transform:translateY(8px)} 30%{opacity:1; transform:none} 100%{opacity:1} }
        .night-beat { animation: nightBeat .6s ease forwards; }
      `}</style>
    </div>
  );
}
