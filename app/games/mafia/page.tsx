'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceQueue } from './useVoiceQueue';
import { usePushToTalk } from './usePushToTalk';

// ── shapes mirrored from engine/types GameEvent (kept loose on the client) ──────
type Player = { id: string; name: string; role: string; model?: string | null; alive: boolean; human?: boolean };
type Beliefs = { reasoning: string; suspicions: Record<string, number> };
type Turn = {
  agent: string;
  phase: string;
  legal: string[];
  alive: { id: string; name: string }[];
  killTargets: { id: string; name: string }[];
  teammates: { id: string; name: string }[];
};
type Feed =
  | { k: 'phase'; phase: string; round: number }
  | { k: 'speak'; who: string; text: string }
  | { k: 'whisper'; who: string; text: string }
  | { k: 'system'; text: string }
  | { k: 'vote'; who: string; target: string }
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
  const [beliefs, setBeliefs] = useState<Record<string, Beliefs>>({});
  const [phase, setPhase] = useState<{ phase: string; round: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<'watch' | 'play'>('watch');
  const [gameId, setGameId] = useState<string | null>(null);
  const [humanId, setHumanId] = useState<string | null>(null);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);

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
          setSelected((s) => s ?? e.players.find((p: Player) => p.human)?.id ?? e.players[0]?.id ?? null);
          break;
        case 'phase': {
          setPhase({ phase: e.phase, round: e.round });
          setFeed((f) => [...f, { k: 'phase', phase: e.phase, round: e.round }]);
          const night = e.phase === 'NIGHT';
          if (musicRef.current) musicRef.current.volume = night ? 0.07 : 0.13;
          if (night) playSfx('night');
          break;
        }
        case 'beliefs':
          setBeliefs((b) => ({ ...b, [e.agent]: { reasoning: e.reasoning, suspicions: e.suspicions } }));
          break;
        case 'speak':
          setFeed((f) => [...f, { k: 'speak', who: e.agent, text: e.text }]);
          voice.enqueue(nameOf(e.agent), e.text);
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
      setBeliefs({});
      setWinner(null);
      setPhase(null);
      setTurn(null);
      setSelected(null);
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
  const sel = selected ? players.find((p) => p.id === selected) : null;
  const selBeliefs = selected ? beliefs[selected] : undefined;
  const me = humanId ? players.find((p) => p.id === humanId) : null;

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

      <div className="grid grid-cols-[260px_1fr_340px] h-[calc(100vh-57px)]">
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

        {/* transcript + action bar */}
        <section className="flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
            {feed.length === 0 && <p className="text-sm text-neutral-600">The table is quiet…</p>}
            {feed.map((it, i) => (
              <FeedLine key={i} it={it} nameOf={nameOf} />
            ))}
            <div ref={feedEndRef} />
          </div>
          {myTurn && <ActionBar turn={myTurn} onSubmit={submitAction} />}
        </section>

        {/* minds panel */}
        <aside className="overflow-y-auto border-l border-neutral-800 p-4">
          <h2 className="text-xs uppercase tracking-wider text-neutral-500">Inside the mind</h2>
          {!sel && <p className="mt-2 text-sm text-neutral-600">Select a player.</p>}
          {sel && (
            <>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-base font-bold">
                  {sel.name}
                  {sel.human && <span className="ml-1 text-xs text-amber-400">(you)</span>}
                </span>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${ROLE_STYLE[sel.role] ?? 'border-neutral-700'}`}>
                  {sel.role === 'unknown' ? '?' : sel.role}
                </span>
              </div>
              <div className="truncate text-[11px] text-neutral-500">{sel.human ? 'human player' : sel.model}</div>
              {!sel.alive && <div className="mt-1 text-xs text-red-400">☠ eliminated</div>}

              {mode === 'play' && !sel.human ? (
                <p className="mt-6 text-xs text-neutral-600">
                  Hidden — you’re in the game. Their thoughts unlock when you’re only watching.
                </p>
              ) : (
                <>
                  <h3 className="mt-4 text-xs uppercase tracking-wider text-neutral-500">Suspicion</h3>
                  <div className="mt-2 space-y-1.5">
                    {selBeliefs && Object.keys(selBeliefs.suspicions).length > 0 ? (
                      Object.entries(selBeliefs.suspicions)
                        .sort((a, b) => b[1] - a[1])
                        .map(([id, lvl]) => (
                          <div key={id} className="flex items-center gap-2">
                            <span className="w-20 truncate text-xs text-neutral-400">{nameOf(id)}</span>
                            <div className="h-2 flex-1 rounded bg-neutral-800">
                              <div
                                className="h-2 rounded bg-gradient-to-r from-amber-500 to-red-500"
                                style={{ width: `${Math.round(Math.max(0, Math.min(1, lvl)) * 100)}%` }}
                              />
                            </div>
                            <span className="w-8 text-right text-[10px] text-neutral-500">{Math.round(lvl * 100)}%</span>
                          </div>
                        ))
                    ) : (
                      <p className="text-xs text-neutral-600">{sel.human ? 'You keep your own counsel.' : 'No reads yet.'}</p>
                    )}
                  </div>

                  <h3 className="mt-4 text-xs uppercase tracking-wider text-neutral-500">Current thinking</h3>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-neutral-300">
                    {sel.human ? 'That’s up to you.' : selBeliefs?.reasoning ?? '…'}
                  </p>
                </>
              )}
            </>
          )}
        </aside>
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

      {phase === 'VOTE' && (
        <div className="flex items-end gap-2">
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm">
            <option value="">vote to eliminate…</option>
            {alive.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => target && onSubmit('vote', { target })}
            className="rounded bg-amber-500 px-4 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-amber-400"
          >
            Vote
          </button>
        </div>
      )}

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
          <div className="flex items-end gap-2">
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm">
              <option value="">choose tonight’s kill…</option>
              {turn.killTargets.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => target && onSubmit('mafia_propose_kill', { target })}
              className="rounded bg-red-600 px-4 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-red-500"
            >
              Kill
            </button>
          </div>
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
        <p className="text-sm">
          <span className="font-semibold text-amber-200">{nameOf(it.who)}:</span>{' '}
          <span className="text-neutral-200">{it.text}</span>
        </p>
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
    case 'system':
      return <p className="text-center text-sm font-medium text-red-300/90">{it.text}</p>;
    case 'win':
      return <p className="my-2 text-center text-base font-bold text-amber-400">🏆 {it.winner.toUpperCase()} WINS</p>;
    case 'error':
      return <p className="text-xs text-red-400">⚠ {it.text}</p>;
  }
}
