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
          setPlayers((ps) => ps.map((p) => (p.id === e.target ? { ...p, alive: false, role: e.role } : p)));
          setFeed((f) => [...f, { k: 'system', text: `☠ ${nameOf(e.target)} was killed in the night (${e.role}).` }]);
          playSfx('death');
          break;
        case 'reveal':
          setPlayers((ps) => ps.map((p) => (p.id === e.target ? { ...p, alive: false, role: e.role } : p)));
          setFeed((f) => [...f, { k: 'system', text: `🗳 ${nameOf(e.target)} was voted out — they were ${e.role}.` }]);
          playSfx('reveal');
          break;
        case 'vote':
          setFeed((f) => [...f, { k: 'vote', who: e.agent, target: e.target }]);
          break;
        case 'knowledge':
          setFeed((f) => [...f, { k: 'knowledge', who: e.agent, text: e.text }]);
          break;
        case 'request_action':
          setTurn(e as Turn);
          break;
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
    [nameOf, voice, playSfx],
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
      if (tool === 'protect') setFeed((f) => [...f, { k: 'system', text: `🛡 You protected ${args.target} tonight.` }]);
      if (tool === 'investigate') setFeed((f) => [...f, { k: 'system', text: `🔎 You investigated ${args.target}…` }]);
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
    [gameId],
  );

  const myTurn = turn && humanId && turn.agent === humanId ? turn : null;
  const me = humanId ? players.find((p) => p.id === humanId) : null;
  const myRole = me?.role ?? 'unknown';
  // The scene's own overlay handles target-pick actions (vote / kill / investigate /
  // protect). The ActionBar only needs to appear for free-text moves: DISCUSSION
  // speech and the Mafia night whisper.
  const textTurn = myTurn && (myTurn.phase === 'DISCUSSION' || myTurn.legal.includes('mafia_discuss')) ? myTurn : null;

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

  useEffect(() => () => clearTimeout(speakTimerRef.current ?? undefined), []);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 font-mono">
      <audio ref={musicRef} hidden />
      <header className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <Link
            href="/explore"
            className="text-xs text-neutral-500 transition hover:text-amber-300"
            title="Back to the catalog"
          >
            ← lobby
          </Link>
          <Link href="/" className="text-lg font-bold tracking-tight transition hover:text-amber-200">
            🎭 Agentic Mafia
          </Link>
          {phase && (
            <span className="text-xs text-neutral-400">
              {phase.phase} · round {phase.round}
            </span>
          )}
          {mode === 'play' && me && (
            <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${ROLE_STYLE[me.role] ?? 'border-neutral-700'}`}>
              you are {me.role}
            </span>
          )}
          {winner && <span className="text-xs font-bold text-amber-400">🏆 {winner.toUpperCase()} WINS</span>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setVoiceOn((v) => !v)}
            title={voiceOn ? 'Mute voices' : 'Enable voices'}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-900"
          >
            {voiceOn ? '🔊' : '🔇'}
          </button>
          <button
            onClick={() => start('watch')}
            disabled={running}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm font-semibold hover:bg-neutral-900 disabled:opacity-50"
          >
            Watch
          </button>
          <button
            onClick={() => start('play')}
            disabled={running}
            className="rounded bg-amber-500 px-4 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {running && mode === 'play' ? 'Playing…' : 'Join game'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-[260px_1fr] h-[calc(100vh-57px)]">
        {/* table */}
        <aside className="overflow-y-auto border-r border-neutral-800 p-3 space-y-2">
          <h2 className="px-1 text-xs uppercase tracking-wider text-neutral-500">The table</h2>
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
        </aside>

        {/* 3D Tribunal scene (the hero) + a compact transcript overlay */}
        <section className="flex flex-col overflow-hidden bg-black">
          <div className="relative flex-1 overflow-hidden">
            <TribunalScene
              players={players}
              phase={phase?.phase ?? 'DISCUSSION'}
              myId={humanId}
              myRole={myRole}
              speakingId={speakingId}
              accusedId={selected && selected !== humanId ? selected : null}
              turn={turn}
              onSelect={(id) => setSelected(id || null)}
              onAction={submitAction}
            />
            {players.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="text-sm text-neutral-500">Press “Watch” to convene the tribunal, or “Join game” to take a seat.</p>
              </div>
            )}
            {/* fading lower-third caption: who's speaking, with their face + line */}
            <div
              className={`pointer-events-none absolute bottom-4 left-1/2 w-[min(680px,calc(100%-2rem))] -translate-x-1/2 transition-opacity duration-500 ${
                captionVisible && captionWho ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {captionWho && (
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-t from-black/85 via-black/60 to-black/25 px-4 py-3 shadow-lg shadow-black/50 backdrop-blur-md">
                  <PlayerFace name={nameOf(captionWho)} size={46} />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/90">{nameOf(captionWho)}</div>
                    <div className="line-clamp-2 text-sm leading-snug text-neutral-100">{lastSpeak?.text}</div>
                  </div>
                </div>
              )}
            </div>

            {/* toggle for the full transcript drawer */}
            <button
              onClick={() => setShowLog((v) => !v)}
              title="Open the full transcript"
              className="absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-lg border border-neutral-700/70 bg-neutral-950/70 px-3 py-1.5 text-xs text-neutral-300 backdrop-blur transition hover:bg-neutral-800/80 hover:text-neutral-100"
            >
              📜 Transcript
            </button>

            {/* slide-out full conversation history */}
            <div
              className={`absolute inset-y-0 right-0 z-20 flex w-[340px] max-w-[85%] transform flex-col border-l border-neutral-800 bg-neutral-950/95 backdrop-blur transition-transform duration-300 ${
                showLog ? 'translate-x-0' : 'translate-x-full'
              }`}
            >
              <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
                <h3 className="text-xs uppercase tracking-wider text-neutral-400">Full transcript</h3>
                <button onClick={() => setShowLog(false)} className="text-neutral-500 transition hover:text-neutral-200" title="Close">
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                {feed.length === 0 && <p className="text-sm text-neutral-600">Nothing said yet.</p>}
                {feed.map((it, i) => (
                  <FeedLine key={i} it={it} nameOf={nameOf} />
                ))}
                <div ref={feedEndRef} />
              </div>
            </div>
          </div>
          {textTurn && <ActionBar turn={textTurn} onSubmit={submitAction} />}
        </section>
      </div>
    </main>
  );
}

function ActionBar({ turn, onSubmit }: { turn: Turn; onSubmit: (tool: string, args: any) => void }) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState('');
  const [discussKind, setDiscussKind] = useState<'speak' | 'accuse' | 'defend'>('speak');
  const ptt = usePushToTalk((t) => setText((prev) => (prev ? `${prev} ${t}` : t)));

  const alive = turn.alive;
  const phase = turn.phase;

  const Mic = () => (
    <button
      type="button"
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
      title="Hold to talk"
      className={`rounded border px-3 py-1.5 text-sm transition ${
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
    <div className="border-t border-amber-500/30 bg-neutral-900/80 px-5 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
        Your turn · {phase}
        <span className="font-normal normal-case text-neutral-500">· hold 🎤 to speak your move</span>
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
          <button onClick={submitDiscussion} className="rounded bg-amber-500 px-4 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-amber-400">
            Send
          </button>
        </div>
      )}

      {/* VOTE and the night target-picks (kill / investigate / protect) are driven
          by clicking a face in the 3D scene + its action buttons. Here we only keep
          the free-text Mafia night whisper. */}
      {phase === 'NIGHT' && (
        <div className="space-y-2">
          {turn.teammates.length > 0 && (
            <div className="text-xs text-fuchsia-300/80">Your Mafia team: {turn.teammates.map((t) => t.name).join(', ') || '—'}</div>
          )}
          {turn.legal.includes('mafia_discuss') && (
            <div className="flex items-end gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="whisper to your team…"
                className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
              />
              <Mic />
              <button
                onClick={() => text && onSubmit('mafia_discuss', { message: text })}
                className="rounded border border-fuchsia-500/40 px-3 py-1.5 text-sm font-semibold text-fuchsia-200 hover:bg-fuchsia-500/10"
              >
                Whisper
              </button>
            </div>
          )}
          <div className="text-xs text-neutral-500">Click a face in the scene, then use the on-screen buttons to act.</div>
        </div>
      )}
    </div>
  );

  function submitDiscussion() {
    if (discussKind === 'speak' && text.trim()) onSubmit('speak', { text });
    else if (discussKind === 'accuse' && target && text.trim()) onSubmit('accuse', { target, reason: text });
    else if (discussKind === 'defend' && text.trim()) onSubmit('defend', { argument: text });
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
