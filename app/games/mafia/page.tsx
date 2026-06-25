'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVoiceQueue } from './useVoiceQueue';
import { usePushToTalk } from './usePushToTalk';
import TribunalScene, { PlayerFace } from './TribunalScene';

// ── shapes mirrored from engine/types GameEvent (kept loose on the client) ──────
type Player = { id: string; name: string; role: string; model?: string | null; alive: boolean; human?: boolean };
type NameRef = { id: string; name: string };
type Turn = {
  agent: string;
  phase: string;
  legal: string[];
  alive: NameRef[];
  killTargets: NameRef[];
  investigateTargets: NameRef[];
  protectTargets: NameRef[];
  teammates: NameRef[];
};
type Feed =
  | { k: 'phase'; phase: string; round: number }
  | { k: 'speak'; who: string; text: string }
  | { k: 'whisper'; who: string; text: string }
  | { k: 'system'; text: string }
  | { k: 'vote'; who: string; target: string }
  | { k: 'knowledge'; who: string; text: string }
  | { k: 'win'; winner: string }
  | { k: 'error'; text: string };

const ROLE_STYLE: Record<string, string> = {
  mafia: 'bg-red-500/15 text-red-300 border-red-500/30',
  villager: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  detective: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  doctor: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  unknown: 'border-neutral-700 text-neutral-500',
};

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [phase, setPhase] = useState<{ phase: string; round: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<'watch' | 'play'>('watch');
  const [gameId, setGameId] = useState<string | null>(null);
  const [humanId, setHumanId] = useState<string | null>(null);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  // Who currently holds the floor in the 3D scene. Set on `speak`, cleared after a
  // beat (or replaced by the next speaker) so heads turn to whoever is talking.
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  // Drives the menu→gameplay transition overlay ('play' = role reveal, 'watch' = cinematic).
  const [intro, setIntro] = useState<null | 'play' | 'watch'>(null);
  // Your private role knowledge, surfaced as obvious overhead tags in the scene.
  const [findings, setFindings] = useState<Record<string, 'mafia' | 'town'>>({}); // detective results
  const [teammates, setTeammates] = useState<string[]>([]); // your Mafia allies' ids
  const [protectedId, setProtectedId] = useState<string | null>(null); // who you (doctor) shielded
  const [killVotesByAgent, setKillVotesByAgent] = useState<Record<string, string>>({}); // mafia agentId → target id, this night
  const announcedTeamRef = useRef(false);
  // Big transient death/elimination announcement banner.
  const [announce, setAnnounce] = useState<{ name: string; sub: string } | null>(null);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const voice = useVoiceQueue();
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const soundOnRef = useRef(true);

  const playSfx = useCallback((cue: string) => {
    if (!soundOnRef.current) return;
    try {
      const a = new Audio(`/api/sfx?cue=${cue}`);
      a.volume = 0.5;
      void a.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }, []);

  const showAnnounce = useCallback((name: string, sub: string) => {
    setAnnounce({ name, sub });
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnounce(null), 4200);
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const playersRef = useRef<Player[]>([]);
  playersRef.current = players;
  const nameOf = useCallback((id: string) => playersRef.current.find((p) => p.id === id)?.name ?? id, []);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [feed, turn]);

  // Keep all audio (voices, music, SFX) in sync with the 🔊 toggle.
  useEffect(() => {
    voice.setEnabled(voiceOn);
    soundOnRef.current = voiceOn;
    if (!voiceOn) musicRef.current?.pause();
    else if (musicRef.current?.src) void musicRef.current.play().catch(() => {});
  }, [voiceOn, voice]);

  const handle = useCallback(
    (e: any) => {
      switch (e.type) {
        case 'game':
          setGameId(e.gameId);
          setMode(e.mode);
          setHumanId(e.humanId);
          break;
        case 'setup':
          setPlayers(e.players.map((p: Player) => ({ ...p, alive: true })));
          setPhase({ phase: e.phase, round: e.round });
          // Only auto-select the human (for the minds panel); in watch mode leave
          // nothing selected so the scene's heads follow the speaker rather than
          // locking onto a default "accused" player.
          setSelected((s) => s ?? e.players.find((p: Player) => p.human)?.id ?? null);
          break;
        case 'phase': {
          setPhase({ phase: e.phase, round: e.round });
          setFeed((f) => [...f, { k: 'phase', phase: e.phase, round: e.round }]);
          setKillVotesByAgent({}); // kill votes are per-night; reset each phase change
          const night = e.phase === 'NIGHT';
          if (musicRef.current) musicRef.current.volume = night ? 0.07 : 0.13;
          if (night) playSfx('night');
          break;
        }
        case 'speak':
          setFeed((f) => [...f, { k: 'speak', who: e.agent, text: e.text }]);
          voice.enqueue(nameOf(e.agent), e.text);
          setSpeakingId(e.agent);
          if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
          speakTimerRef.current = setTimeout(
            () => setSpeakingId((cur) => (cur === e.agent ? null : cur)),
            Math.max(2000, (e.text?.length ?? 0) * 60),
          );
          break;
        case 'whisper':
          setFeed((f) => [...f, { k: 'whisper', who: e.agent, text: e.text }]);
          break;
        case 'death':
          // Hidden-role variant: mark them dead but keep their role secret.
          setPlayers((ps) => ps.map((p) => (p.id === e.target ? { ...p, alive: false } : p)));
          setFeed((f) => [...f, { k: 'system', text: `☠ ${nameOf(e.target)} was killed in the night.` }]);
          showAnnounce(nameOf(e.target), 'Killed in the night');
          playSfx('death');
          break;
        case 'reveal':
          setPlayers((ps) => ps.map((p) => (p.id === e.target ? { ...p, alive: false } : p)));
          setFeed((f) => [...f, { k: 'system', text: `🗳 ${nameOf(e.target)} was voted out.` }]);
          showAnnounce(nameOf(e.target), 'Voted out by the table');
          playSfx('reveal');
          break;
        case 'vote':
          setFeed((f) => [...f, { k: 'vote', who: e.agent, target: e.target }]);
          break;
        case 'action':
          // A Mafia teammate's kill proposal (only reaches you when you're Mafia).
          if (e.kind === 'propose_kill' && e.target) setKillVotesByAgent((m) => ({ ...m, [e.agent]: e.target }));
          break;
        case 'knowledge':
          setFeed((f) => [...f, { k: 'knowledge', who: e.agent, text: e.text }]);
          // A detective finding about a specific player → mark them in the scene.
          if (e.target) setFindings((m) => ({ ...m, [e.target]: e.result === 'MAFIA' ? 'mafia' : 'town' }));
          break;
        case 'request_action': {
          const t = e as Turn;
          setTurn(t);
          // Capture (and announce, once) your Mafia teammates so the scene can tag them.
          if (t.teammates?.length) {
            setTeammates(t.teammates.map((x) => x.id));
            if (!announcedTeamRef.current) {
              announcedTeamRef.current = true;
              const names = t.teammates.map((x) => x.name).join(', ');
              setFeed((f) => [...f, { k: 'system', text: `🕴 Your Mafia ${t.teammates.length > 1 ? 'allies' : 'ally'}: ${names}` }]);
            }
          }
          break;
        }
        case 'win':
          setWinner(e.winner);
          setFeed((f) => [...f, { k: 'win', winner: e.winner }]);
          playSfx('win');
          if (musicRef.current) musicRef.current.volume = 0.05;
          break;
        case 'done':
          setTurn(null);
          break;
        case 'error':
          setFeed((f) => [...f, { k: 'error', text: e.message }]);
          break;
      }
    },
    [nameOf, voice, playSfx, showAnnounce],
  );

  const start = useCallback(
    async (m: 'watch' | 'play') => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setPlayers([]);
      setFeed([]);
      setWinner(null);
      setPhase(null);
      setTurn(null);
      setSelected(null);
      setSpeakingId(null);
      setFindings({});
      setTeammates([]);
      setProtectedId(null);
      setKillVotesByAgent({});
      setAnnounce(null);
      announcedTeamRef.current = false;
      setMode(m);
      setRunning(true);
      voice.reset();

      // Start the looping tension bed (first load generates it server-side, ~5s).
      const bed = musicRef.current;
      if (bed && soundOnRef.current) {
        bed.src = '/api/music';
        bed.loop = true;
        bed.volume = 0.12;
        void bed.play().catch(() => {});
      }

      try {
        const res = await fetch('/api/game', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: m }),
          signal: ac.signal,
        });
        if (!res.body) throw new Error('no stream');
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const blocks = buf.split('\n\n');
          buf = blocks.pop() ?? '';
          for (const block of blocks) {
            const line = block.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            handle(JSON.parse(line.slice(6)));
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') setFeed((f) => [...f, { k: 'error', text: err?.message ?? 'stream failed' }]);
      } finally {
        setRunning(false);
      }
    },
    [handle, voice],
  );

  const submitAction = useCallback(
    async (tool: string, args: any) => {
      setTurn(null);
      // Local confirmation for your own secret night actions.
      if (tool === 'protect') {
        setProtectedId(args.target ?? null);
        setFeed((f) => [...f, { k: 'system', text: `🛡 You protected ${nameOf(args.target)} tonight.` }]);
      }
      if (tool === 'investigate') setFeed((f) => [...f, { k: 'system', text: `🔎 You investigated ${nameOf(args.target)}…` }]);
      // Show your own kill vote immediately (the engine echoes it back too).
      if (tool === 'mafia_propose_kill' && humanId && args.target) setKillVotesByAgent((m) => ({ ...m, [humanId]: args.target }));
      try {
        await fetch('/api/game/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId, tool, args }),
        });
      } catch {
        /* ignore */
      }
    },
    [gameId, nameOf, humanId],
  );

  const myTurn = turn && humanId && turn.agent === humanId ? turn : null;
  const me = humanId ? players.find((p) => p.id === humanId) : null;
  const myRole = me?.role ?? 'unknown';

  // The scene's overlay handles target-pick actions (vote / kill / investigate /
  // protect). The bottom bar handles free-text moves: DISCUSSION speech and the
  // Mafia night whisper.
  // Discussion bar stays mounted for the WHOLE discussion phase so you can always
  // see the input — it's only *enabled* on your turn (the engine won't accept a
  // move otherwise). `discussionTurn` is non-null exactly when it's your turn.
  const inDiscussion = mode === 'play' && phase?.phase === 'DISCUSSION' && !!me?.alive;
  const discussionTurn = myTurn && myTurn.phase === 'DISCUSSION' ? myTurn : null;
  const nightWhisper = myTurn && myTurn.phase === 'NIGHT' && myTurn.legal.includes('mafia_discuss') ? myTurn : null;
  const showBar = inDiscussion || !!nightWhisper;

  // Mafia private channel — surface teammates' whispers + kill proposals live.
  const whispers = useMemo(() => feed.filter((f): f is Extract<Feed, { k: 'whisper' }> => f.k === 'whisper'), [feed]);
  const showMafiaChannel = mode === 'play' && myRole === 'mafia' && phase?.phase === 'NIGHT' && !!me?.alive;
  // target id → names of the Mafia who voted to kill them (for obvious scene markers)
  const killVotes = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const [agent, target] of Object.entries(killVotesByAgent)) {
      if (!target) continue;
      (m[target] ??= []).push(nameOf(agent));
    }
    return m;
  }, [killVotesByAgent, nameOf]);

  // Latest spoken line drives the fading lower-third caption.
  const lastSpeak = useMemo(() => {
    for (let i = feed.length - 1; i >= 0; i--) {
      const f = feed[i];
      if (f.k === 'speak') return f;
    }
    return null;
  }, [feed]);
  const captionVisible = !!speakingId;
  const captionWho = speakingId ?? lastSpeak?.who ?? null;

  useEffect(
    () => () => {
      clearTimeout(speakTimerRef.current ?? undefined);
      clearTimeout(announceTimer.current ?? undefined);
    },
    [],
  );

  return (
    <main className="fixed inset-0 bg-black text-neutral-100 font-mono">
      <audio ref={musicRef} hidden />

      {/* The 3D Tribunal scene fills the whole screen; everything else floats on top. */}
      <div className="absolute inset-0">
        <TribunalScene
          players={players}
          phase={phase?.phase ?? 'DISCUSSION'}
          myId={humanId}
          myRole={myRole}
          speakingId={speakingId}
          accusedId={selected && selected !== humanId ? selected : null}
          turn={turn}
          findings={findings}
          teammates={teammates}
          protectedId={protectedId}
          killVotes={killVotes}
          onSelect={(id) => setSelected(id || null)}
          onAction={submitAction}
        />
      </div>

      {/* role badge (play mode) — top-left, mirroring the floating controls */}
      {mode === 'play' && me && (
        <div className={`absolute left-3 top-3 z-30 rounded-lg border px-2.5 py-1.5 text-[10px] uppercase tracking-wider ${ROLE_STYLE[me.role] ?? 'border-neutral-700'}`}>
          you are {me.role}
        </div>
      )}

      {/* floating controls — top-right cluster, all styled like the Transcript button.
          Sits above the drawers (z-50) so each button always toggles its panel. */}
      <div className="absolute right-3 top-3 z-50 flex items-center gap-2">
        <Link href="/explore" title="Back to the lobby" className={FLOAT_BTN}>
          ← Lobby
        </Link>
        <button onClick={() => setShowPlayers((v) => !v)} title="The table" className={FLOAT_BTN}>
          👥 Players
        </button>
        <button onClick={() => setShowLog((v) => !v)} title="Full transcript" className={FLOAT_BTN}>
          📜 Transcript
        </button>
        <button onClick={() => setVoiceOn((v) => !v)} title={voiceOn ? 'Mute voices' : 'Enable voices'} className={FLOAT_BTN}>
          {voiceOn ? '🔊' : '🔇'}
        </button>
      </div>

      {/* full-screen menu — a dark overlay over the scene; the text and buttons
          float free (no card). Doubles as the entry and game-over screen. */}
      {!running && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center px-6 text-center bg-gradient-to-b from-black/70 via-black/80 to-black/90 backdrop-blur-md">
          <p className="text-[11px] font-semibold uppercase tracking-[0.45em] text-amber-300/70">The Tribunal</p>
          <h1 className="mt-3 bg-gradient-to-b from-white to-neutral-400 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
            Agentic Mafia
          </h1>

          {winner ? (
            <p className="mt-5 text-sm font-semibold text-amber-400">{winner.toUpperCase()} prevails — run it back?</p>
          ) : (
            <p className="mt-5 max-w-md text-sm leading-relaxed text-neutral-400">
              A table of AI minds, and one of them is lying.
              <br />
              Watch them deliberate — or take a seat and bluff.
            </p>
          )}

          <div className="mt-10 flex flex-col items-center gap-3">
            <button
              onClick={() => {
                setIntro('play');
                start('play');
              }}
              className="tribunal-action tribunal-action--join min-w-[240px] text-center"
            >
              {winner ? 'Play again' : 'Join the table'}
            </button>
            <button
              onClick={() => {
                setIntro('watch');
                start('watch');
              }}
              className="tribunal-action min-w-[240px] text-center"
            >
              Watch the agents
            </button>
          </div>
        </div>
      )}

      {/* menu → gameplay transition (role reveal for play, cinematic for watch) */}
      {intro && <IntroOverlay mode={intro} role={myRole} onDone={() => setIntro(null)} />}

      {/* dramatic death / elimination announcement */}
      {announce && (
        <div key={announce.name + announce.sub} className="pointer-events-none absolute inset-x-0 top-[20%] z-30 flex justify-center px-6">
          <div className="death-banner flex flex-col items-center gap-3 rounded-2xl border border-red-500/30 bg-black/55 px-10 py-6 text-center shadow-2xl shadow-red-950/40 backdrop-blur-md">
            <span className="text-[11px] font-semibold uppercase tracking-[0.45em] text-red-300/80">{announce.sub}</span>
            <span className="flex items-center gap-3 text-4xl font-bold tracking-tight text-red-50">
              <PlayerFace name={announce.name} size={48} />
              {announce.name}
            </span>
            <span className="text-xs uppercase tracking-[0.3em] text-neutral-400">is dead</span>
          </div>
          <style>{`
            @keyframes deathBannerIn {
              0% { opacity: 0; transform: translateY(-14px) scale(.92); }
              12% { opacity: 1; transform: translateY(0) scale(1.03); }
              22% { transform: scale(1); }
              82% { opacity: 1; }
              100% { opacity: 0; transform: translateY(-8px) scale(.98); }
            }
            .death-banner { animation: deathBannerIn 4.2s ease forwards; }
          `}</style>
        </div>
      )}

      {/* fading lower-third caption: who's speaking, with their face + line.
          Click it (while visible) to open the full transcript. */}
      <div
        className={`absolute left-1/2 z-20 w-[min(680px,calc(100%-2rem))] -translate-x-1/2 transition-all duration-500 ${
          showBar ? 'bottom-28' : 'bottom-4'
        } ${captionVisible && captionWho ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        {captionWho && (
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            title="Open the full transcript"
            className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-t from-black/85 via-black/60 to-black/25 px-4 py-3 text-left shadow-lg shadow-black/50 backdrop-blur-md transition hover:border-white/25 hover:from-black/90"
          >
            <PlayerFace name={nameOf(captionWho)} size={46} />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/90">{nameOf(captionWho)}</div>
              <AutoScrollText text={lastSpeak?.text} />
            </div>
          </button>
        )}
      </div>

      {/* Mafia private channel — see what your partner is thinking / proposing */}
      {showMafiaChannel && (
        <div className="absolute left-3 top-16 z-30 flex max-h-[42vh] w-72 flex-col rounded-xl border border-fuchsia-500/30 bg-neutral-950/80 backdrop-blur">
          <div className="border-b border-fuchsia-500/20 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fuchsia-300">🤫 Mafia channel</div>
            <div className="mt-0.5 truncate text-[10px] text-fuchsia-300/60">
              {teammates.length ? `with ${teammates.map((id) => nameOf(id)).join(', ')}` : 'you’re the lone wolf'}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
            {whispers.length === 0 ? (
              <p className="text-[11px] text-neutral-500">No whispers yet. Your partner is deciding…</p>
            ) : (
              whispers.slice(-12).map((w, i) => (
                <p key={i} className="text-xs leading-snug text-fuchsia-200/90">
                  <span className="font-semibold">{nameOf(w.who)}:</span> {w.text}
                </p>
              ))
            )}
          </div>
        </div>
      )}

      {/* free-text action bar — DISCUSSION speech (always visible during the phase,
          enabled on your turn) / Mafia night whisper. Pinned to the bottom. */}
      {showBar && (
        <div className="absolute inset-x-0 bottom-0 z-30">
          <ActionBar
            phase={nightWhisper ? 'NIGHT' : 'DISCUSSION'}
            turn={nightWhisper ?? discussionTurn}
            players={players}
            onSubmit={submitAction}
          />
        </div>
      )}

      {/* left drawer — the table (toggled by the Players button) */}
      <div
        className={`absolute inset-y-0 left-0 z-40 flex w-[300px] max-w-[85%] transform flex-col border-r border-neutral-800 bg-neutral-950/95 backdrop-blur transition-transform duration-300 ${
          showPlayers ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="border-b border-neutral-800 px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider text-neutral-400">The table</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {players.length === 0 && <p className="px-1 text-sm text-neutral-600">Watch the agents, or join in.</p>}
          {players.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                selected === p.id ? 'border-amber-500/60 bg-neutral-900' : 'border-neutral-800 hover:bg-neutral-900/60'
              } ${p.alive ? '' : 'opacity-40'} ${turn && turn.agent === p.id ? 'ring-1 ring-amber-400/60' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className={`font-semibold ${p.alive ? '' : 'line-through'}`}>
                  {p.name}
                  {p.human && <span className="ml-1 text-[10px] text-amber-400">(you)</span>}
                </span>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${ROLE_STYLE[p.role] ?? 'border-neutral-700 text-neutral-400'}`}>
                  {p.role === 'unknown' ? '?' : p.role}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-neutral-500">{p.human ? 'human player' : p.model}</div>
            </button>
          ))}
        </div>
      </div>

      {/* right drawer — the full transcript (toggled by the Transcript button) */}
      <div
        className={`absolute inset-y-0 right-0 z-40 flex w-[340px] max-w-[85%] transform flex-col border-l border-neutral-800 bg-neutral-950/95 backdrop-blur transition-transform duration-300 ${
          showLog ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="border-b border-neutral-800 px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider text-neutral-400">Full transcript</h3>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {feed.length === 0 && <p className="text-sm text-neutral-600">Nothing said yet.</p>}
          {feed.map((it, i) => (
            <FeedLine key={i} it={it} nameOf={nameOf} />
          ))}
          <div ref={feedEndRef} />
        </div>
      </div>
    </main>
  );
}

// Caption text that auto-scrolls through itself when a line is too long to fit the
// fixed-height bar — pauses at the top, eases down to reveal the rest, then settles.
function AutoScrollText({ text }: { text?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = 0;
    const overflow = el.scrollHeight - el.clientHeight;
    if (overflow <= 2) return;
    let raf = 0;
    let stopped = false;
    let startTs: number | null = null;
    const START_DELAY = 800; // dwell at the top so the start is readable
    const SPEED = 0.024; // px per ms
    const duration = overflow / SPEED;
    const step = (ts: number) => {
      if (stopped) return;
      if (startTs == null) startTs = ts;
      const elapsed = ts - startTs;
      const p = Math.max(0, Math.min(1, (elapsed - START_DELAY) / duration));
      el.scrollTop = overflow * p;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [text]);
  return (
    <div ref={ref} className="max-h-[4.5rem] overflow-hidden text-sm leading-snug text-neutral-100">
      {text}
    </div>
  );
}

// Shared style for the floating top-right controls (same look as the Transcript button).
const FLOAT_BTN =
  'flex items-center gap-1.5 rounded-lg border border-neutral-700/70 bg-neutral-950/70 px-3 py-1.5 text-xs text-neutral-300 backdrop-blur transition hover:bg-neutral-800/80 hover:text-neutral-100';

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

function IntroOverlay({ mode, role, onDone }: { mode: 'play' | 'watch'; role: string; onDone: () => void }) {
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

function ActionBar({
  phase,
  turn,
  players,
  onSubmit,
}: {
  phase: string;
  turn: Turn | null; // non-null only when it's actually your turn
  players: Player[];
  onSubmit: (tool: string, args: any) => void;
}) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState('');
  const [discussKind, setDiscussKind] = useState<'speak' | 'accuse' | 'defend'>('speak');
  const ptt = usePushToTalk((t) => setText((prev) => (prev ? `${prev} ${t}` : t)));

  const myTurn = !!turn; // can you actually act right now?
  // alive others for the accuse dropdown — from the turn payload, else the roster.
  const alive = turn?.alive ?? players.filter((p) => p.alive && !p.human).map((p) => ({ id: p.id, name: p.name }));

  const Mic = () => (
    <button
      type="button"
      disabled={!myTurn}
      onMouseDown={ptt.start}
      onMouseUp={ptt.stop}
      onMouseLeave={() => ptt.status === 'recording' && ptt.stop()}
      onTouchStart={(e) => {
        e.preventDefault();
        ptt.start();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        ptt.stop();
      }}
      title={myTurn ? 'Hold to talk' : 'Wait for your turn'}
      className={`rounded border px-3 py-1.5 text-sm transition disabled:opacity-40 ${
        ptt.status === 'recording'
          ? 'border-red-500 bg-red-500/20 text-red-300'
          : ptt.status === 'transcribing'
            ? 'border-amber-500/50 text-amber-300'
            : 'border-neutral-700 hover:bg-neutral-800'
      }`}
    >
      {ptt.status === 'recording' ? '● rec' : ptt.status === 'transcribing' ? '…' : '🎤'}
    </button>
  );

  return (
    <div className="border-t border-amber-500/30 bg-neutral-900/85 px-5 py-3 backdrop-blur">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
        {myTurn ? (
          <>
            Your turn · {phase}
            <span className="font-normal normal-case text-neutral-500">· hold 🎤 to speak your move</span>
          </>
        ) : (
          <span className="text-neutral-500">
            {phase} · <span className="text-amber-300/70">the table is talking…</span> compose your move — you’ll send it on your turn
          </span>
        )}
      </div>

      {phase === 'DISCUSSION' && (
        <div className="flex flex-wrap items-end gap-2">
          <select
            value={discussKind}
            onChange={(e) => setDiscussKind(e.target.value as any)}
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm"
          >
            <option value="speak">Speak</option>
            <option value="accuse">Accuse</option>
            <option value="defend">Defend self</option>
          </select>
          {discussKind === 'accuse' && (
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm">
              <option value="">who?</option>
              {alive.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={discussKind === 'accuse' ? 'why are they Mafia?' : 'say something…'}
            className="min-w-[240px] flex-1 rounded border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && submitDiscussion()}
          />
          <Mic />
          <button
            onClick={submitDiscussion}
            disabled={!myTurn}
            className="rounded bg-amber-500 px-4 py-1.5 text-sm font-semibold text-neutral-950 transition hover:bg-amber-400 disabled:cursor-default disabled:bg-neutral-700 disabled:text-neutral-400"
          >
            {myTurn ? 'Send' : 'Waiting…'}
          </button>
        </div>
      )}

      {/* VOTE and the night target-picks (kill / investigate / protect) are driven
          by clicking a face in the 3D scene + its action buttons. Here we only keep
          the free-text Mafia night whisper. */}
      {phase === 'NIGHT' && (
        <div className="space-y-2">
          {!!turn && turn.teammates.length > 0 && (
            <div className="text-xs text-fuchsia-300/80">Your Mafia team: {turn.teammates.map((t) => t.name).join(', ') || '—'}</div>
          )}
          <div className="flex items-end gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="whisper to your team…"
              className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
            />
            <Mic />
            <button
              onClick={() => myTurn && text && onSubmit('mafia_discuss', { message: text })}
              disabled={!myTurn}
              className="rounded border border-fuchsia-500/40 px-3 py-1.5 text-sm font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/10 disabled:opacity-40"
            >
              Whisper
            </button>
          </div>
          <div className="text-xs text-neutral-500">Click a face in the scene, then use the on-screen buttons to act.</div>
        </div>
      )}
    </div>
  );

  function submitDiscussion() {
    if (!myTurn) return;
    if (discussKind === 'speak' && text.trim()) onSubmit('speak', { text });
    else if (discussKind === 'accuse' && target && text.trim()) onSubmit('accuse', { target, reason: text });
    else if (discussKind === 'defend' && text.trim()) onSubmit('defend', { argument: text });
    setText('');
  }
}

function FeedLine({ it, nameOf }: { it: Feed; nameOf: (id: string) => string }) {
  switch (it.k) {
    case 'phase':
      return (
        <div className="my-3 flex items-center gap-3 text-xs uppercase tracking-widest text-amber-400/80">
          <div className="h-px flex-1 bg-neutral-800" />
          {it.phase} · round {it.round}
          <div className="h-px flex-1 bg-neutral-800" />
        </div>
      );
    case 'speak':
      return (
        <div className="flex items-start gap-2">
          <PlayerFace name={nameOf(it.who)} size={22} />
          <p className="text-sm">
            <span className="font-semibold text-amber-200">{nameOf(it.who)}:</span>{' '}
            <span className="text-neutral-200">{it.text}</span>
          </p>
        </div>
      );
    case 'whisper':
      return (
        <p className="text-sm italic text-fuchsia-300/80">
          🤫 <span className="font-semibold">[mafia] {nameOf(it.who)}:</span> {it.text}
        </p>
      );
    case 'vote':
      return (
        <p className="text-xs text-yellow-300/80">
          🗳 {nameOf(it.who)} → {nameOf(it.target)}
        </p>
      );
    case 'knowledge':
      return (
        <p className="text-sm text-sky-300/90">
          🔎 <span className="font-semibold">{nameOf(it.who)} learned:</span> {it.text}
        </p>
      );
    case 'system':
      return <p className="text-center text-sm font-medium text-red-300/90">{it.text}</p>;
    case 'win':
      return <p className="my-2 text-center text-base font-bold text-amber-400">🏆 {it.winner.toUpperCase()} WINS</p>;
    case 'error':
      return <p className="text-xs text-red-400">⚠ {it.text}</p>;
  }
}
