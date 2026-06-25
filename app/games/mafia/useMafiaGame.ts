'use client';

// ── useMafiaGame — the screen's game-state container ──────────────────────────
// Owns the connection to the engine (the SSE stream), every piece of game state,
// the audio/voice pacing, the phase timers, and the derived view-model the screen
// renders. The page component stays a thin layout: it reads this hook and paints.
// Pure view toggles (drawers, the intro overlay, the dev-role picker) live in the
// page, since they never touch the engine.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVoiceQueue } from './useVoiceQueue';
import { useAuth } from '../../_components/AuthProvider';
import { PHASE_SECS } from './constants';
import type { Announce, Feed, Player, Turn } from './types';

export function useMafiaGame() {
  const { profile } = useAuth();
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
  // The line currently being VOICED (driven by the audio queue when voice is on),
  // so the caption/heads match what you're hearing rather than racing ahead of it.
  const [speakingLine, setSpeakingLine] = useState<{ who: string; text: string } | null>(null);
  // True when nothing is queued/playing — used to hold your turn until the table
  // has finished talking, so you're never asked to chime in over a backlog.
  const [voiceIdle, setVoiceIdle] = useState(true);
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Seats currently mid-LLM (deliberating). A set, since at night several agents
  // think at once — each gets its own overhead bubble in the scene.
  const [thinkingIds, setThinkingIds] = useState<string[]>([]);
  // Your private role knowledge, surfaced as obvious overhead tags in the scene.
  const [findings, setFindings] = useState<Record<string, 'mafia' | 'town'>>({}); // detective results
  const [teammates, setTeammates] = useState<string[]>([]); // your Mafia allies' ids
  const [protectedId, setProtectedId] = useState<string | null>(null); // who you (doctor) shielded
  const [killVotesByAgent, setKillVotesByAgent] = useState<Record<string, string>>({}); // mafia agentId → target id, this night
  const announcedTeamRef = useRef(false);
  // Big transient announcement banner (death / doctor-save / quiet night).
  const [announce, setAnnounce] = useState<Announce | null>(null);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which night role is acting right now ('mafia' | 'detective' | 'doctor' | null),
  // driven by `wake` events so the narrator fires exactly when each role acts.
  const [nightWake, setNightWake] = useState<string | null>(null);
  // Phase countdown + the "ready to move to vote" toggle.
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [wantsSkip, setWantsSkip] = useState(false);

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

  const showAnnounce = useCallback((a: Announce) => {
    setAnnounce(a);
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnounce(null), 4200);
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const playersRef = useRef<Player[]>([]);
  playersRef.current = players;
  // Live humanId for the (deps-light) event handler, so it can tell your own line apart.
  const humanIdRef = useRef<string | null>(null);
  humanIdRef.current = humanId;
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

  // The audio queue paces the on-screen floor: a line's caption + speaking head
  // appear when its audio STARTS and clear when it ENDS, so the table never gets
  // ahead of what you're hearing. onIdle gates your turn until the room is quiet.
  useEffect(() => {
    voice.bind({
      // The transcript is filled once, in the `speak` handler. The queue only paces
      // the centre caption + speaking head so they track the ACTUAL audio.
      onStart: (item) => {
        setSpeakingId(item.id);
        setSpeakingLine({ who: item.id, text: item.text });
      },
      onEnd: (item) => {
        setSpeakingId((cur) => (cur === item.id ? null : cur));
      },
      onIdle: (v) => setVoiceIdle(v),
    });
  }, [voice]);

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
          voice.reset(); // drop any leftover spoken backlog before the phase turns over
          setPhase({ phase: e.phase, round: e.round });
          setFeed((f) => [...f, { k: 'phase', phase: e.phase, round: e.round }]);
          setKillVotesByAgent({}); // kill votes are per-night; reset each phase change
          const night = e.phase === 'NIGHT';
          setNightWake(null); // reset the narrator each phase; 'wake' events drive it at night
          if (musicRef.current) musicRef.current.volume = night ? 0.07 : 0.13;
          if (night) playSfx('night');
          break;
        }
        case 'speak': {
          const isHuman = e.agent === humanIdRef.current;
          // Reveal the line in the transcript exactly once. A seat never speaks twice
          // in a row, so an identical back-to-back line is always a stray duplicate.
          setFeed((f) => {
            const last = f[f.length - 1];
            if (last && last.k === 'speak' && last.who === e.agent && last.text === e.text) return f;
            return [...f, { k: 'speak', who: e.agent, text: e.text }];
          });
          if (!isHuman && soundOnRef.current) {
            // Voice on (AI line): the audio queue paces the caption + speaking head,
            // one line at a time, so the floor never jumps ahead to the next model.
            voice.enqueue({ id: e.agent, name: nameOf(e.agent), text: e.text });
          } else {
            // Your OWN line (no need to read it back to you) or a muted AI line: no
            // audio to pace against — hold the caption a readable, text-length beat.
            setSpeakingId(e.agent);
            setSpeakingLine({ who: e.agent, text: e.text });
            if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
            speakTimerRef.current = setTimeout(
              () => setSpeakingId((cur) => (cur === e.agent ? null : cur)),
              Math.max(2000, (e.text?.length ?? 0) * 60),
            );
          }
          break;
        }
        case 'thinking':
          setThinkingIds((cur) => (e.on ? (cur.includes(e.agent) ? cur : [...cur, e.agent]) : cur.filter((id) => id !== e.agent)));
          break;
        case 'wake':
          // A night role just started acting — narrate it now (anonymous: role only).
          setNightWake(e.role);
          break;
        case 'whisper':
          setFeed((f) => [...f, { k: 'whisper', who: e.agent, text: e.text }]);
          break;
        case 'death':
          // Hidden-role variant: mark them dead but keep their role secret.
          setPlayers((ps) => ps.map((p) => (p.id === e.target ? { ...p, alive: false } : p)));
          setFeed((f) => [...f, { k: 'system', text: `☠ ${nameOf(e.target)} was killed in the night.` }]);
          showAnnounce({ eyebrow: 'Killed in the night', title: nameOf(e.target), face: nameOf(e.target), tone: 'death' });
          playSfx('death');
          break;
        case 'reveal':
          setPlayers((ps) => ps.map((p) => (p.id === e.target ? { ...p, alive: false } : p)));
          setFeed((f) => [...f, { k: 'system', text: `🗳 ${nameOf(e.target)} was voted out.` }]);
          showAnnounce({ eyebrow: 'Voted out by the table', title: nameOf(e.target), face: nameOf(e.target), tone: 'death' });
          playSfx('reveal');
          break;
        case 'night':
          // Anonymous night outcome — no names of who was targeted or who saved them.
          if (e.outcome === 'saved') {
            setFeed((f) => [...f, { k: 'system', text: '🛡 The Mafia struck — but the doctor saved their target. No one died.' }]);
            showAnnounce({ eyebrow: "The doctor's work", title: 'A life was saved', face: null, tone: 'save' });
            playSfx('reveal');
          } else {
            setFeed((f) => [...f, { k: 'system', text: '🌙 The night passed quietly — no one died.' }]);
            showAnnounce({ eyebrow: 'Dawn breaks', title: 'A quiet night', face: null, tone: 'quiet' });
          }
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
        case 'turn_over':
          // The server passed our idle discussion turn (an eager AI filled the
          // silence instead). Clear it so the bar shows "the table is talking"
          // rather than a stale "your turn" — we'll be offered the floor again later.
          setTurn((t) => (t && t.agent === e.agent ? null : t));
          break;
        case 'win':
          voice.reset();
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
    async (m: 'watch' | 'play', devRoleArg?: string) => {
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
      setSpeakingLine(null);
      setVoiceIdle(true);
      setThinkingIds([]);
      setNightWake(null);
      if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
      setFindings({});
      setTeammates([]);
      setProtectedId(null);
      setKillVotesByAgent({});
      setAnnounce(null);
      setSecondsLeft(null);
      setWantsSkip(false);
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
          body: JSON.stringify({
            mode: m,
            ...(m === 'play' && profile?.displayName ? { playerName: profile.displayName } : {}),
            ...(devRoleArg ? { devRole: devRoleArg } : {}),
          }),
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
    [handle, voice, profile],
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

  // Pass / skip the current turn (the engine treats a null choice as no action).
  const skipTurn = useCallback(async () => {
    setTurn(null);
    try {
      await fetch('/api/game/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, skip: true }),
      });
    } catch {
      /* ignore */
    }
  }, [gameId]);

  // Ask to move to the vote. Only fast-forwards if a majority of the table agrees.
  const requestSkipDiscussion = useCallback(
    async (value: boolean) => {
      try {
        await fetch('/api/game/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId, control: 'skipDiscussion', value }),
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

  // The scene's overlay handles target-pick actions (vote / kill / investigate /
  // protect). The bottom bar handles free-text moves: DISCUSSION speech and the
  // Mafia night whisper.
  // Discussion bar stays mounted for the WHOLE discussion phase so you can always
  // see the input — it's only *enabled* on your turn (the engine won't accept a
  // move otherwise). `discussionTurn` is non-null exactly when it's your turn.
  const inDiscussion = mode === 'play' && phase?.phase === 'DISCUSSION' && !!me?.alive;
  const discussionTurn = myTurn && myTurn.phase === 'DISCUSSION' ? myTurn : null;
  // The night is silent — no whisper bar. Discussion is the only free-text phase.
  const showBar = inDiscussion;

  // Directed public statement: if you've clicked an agent during discussion, your
  // spoken line is addressed to them (prefixed with their name) — still a normal,
  // table-visible DISCUSSION speak, not a private channel.
  const addresseeId = inDiscussion && selected && selected !== humanId ? selected : null;
  const addresseeName = addresseeId ? nameOf(addresseeId) : null;
  const sendSpeech = useCallback(
    (raw: string) => {
      const text = (raw ?? '').trim();
      if (!text) return;
      const directed =
        addresseeName && !text.toLowerCase().startsWith(addresseeName.toLowerCase())
          ? `${addresseeName}, ${text}`
          : text;
      submitAction('speak', { text: directed });
    },
    [addresseeName, submitAction],
  );

  // Mafia private channel — your allies + the targets they've silently picked.
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
  // The caption follows the line currently being VOICED (audio-paced), falling back
  // to the latest emitted line if nothing is mid-playback.
  const captionVisible = !!speakingId;
  const captionWho = speakingLine?.who ?? speakingId ?? lastSpeak?.who ?? null;
  const captionText = speakingLine?.text ?? lastSpeak?.text;

  // "thinking…" cue (hidden while someone is speaking). At night the wake narrator
  // is the indicator instead, so we suppress this here. A set, since several agents
  // can deliberate at once — we surface the first that isn't the current speaker.
  const firstThinking = thinkingIds.find((id) => id !== speakingId) ?? null;
  const thinkingLabel =
    firstThinking && !speakingId && running && !winner && phase?.phase !== 'NIGHT'
      ? `${nameOf(firstThinking)} is deliberating…`
      : null;

  // ── phase timers (generous; the timer never rushes you) ─────────────────────
  // On your turn it auto-passes if you idle past the clock; during discussion an
  // expired clock raises the "ready to vote" flag (still needs a table majority).
  const phaseSecs = phase ? (PHASE_SECS[phase.phase] ?? 90) : null;
  const deadlineRef = useRef<number | null>(null);
  const expiredRef = useRef(false);
  // live values for the interval callback (avoids stale closures)
  const timerLive = useRef({ play: false, myTurn: false, phase: '', skipTurn, requestSkipDiscussion });
  timerLive.current = { play: mode === 'play', myTurn: !!myTurn, phase: phase?.phase ?? '', skipTurn, requestSkipDiscussion };

  // (re)start the clock on each phase change and whenever it becomes your turn,
  // so you always get the full, generous duration to act.
  useEffect(() => {
    if (!running || phaseSecs == null) {
      deadlineRef.current = null;
      setSecondsLeft(null);
      return;
    }
    deadlineRef.current = Date.now() + phaseSecs * 1000;
    expiredRef.current = false;
    setSecondsLeft(phaseSecs);
    setWantsSkip(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase?.phase, phase?.round, running, turn]);

  // tick + handle expiry
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      if (deadlineRef.current == null) return;
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        const l = timerLive.current;
        if (!l.play) return; // watch mode: the timer is purely visual
        if (l.myTurn) l.skipTurn();
        else if (l.phase === 'DISCUSSION') {
          setWantsSkip(true);
          l.requestSkipDiscussion(true);
        }
      }
    }, 250);
    return () => clearInterval(iv);
  }, [running]);

  useEffect(
    () => () => {
      clearTimeout(speakTimerRef.current ?? undefined);
      clearTimeout(announceTimer.current ?? undefined);
    },
    [],
  );

  return {
    // refs the page mounts
    musicRef,
    feedEndRef,
    // raw game state
    players,
    feed,
    phase,
    selected,
    setSelected,
    winner,
    running,
    mode,
    humanId,
    turn,
    voiceOn,
    setVoiceOn,
    speakingId,
    voiceIdle,
    thinkingIds,
    findings,
    teammates,
    protectedId,
    killVotesByAgent,
    announce,
    nightWake,
    secondsLeft,
    wantsSkip,
    setWantsSkip,
    // derived view-model
    me,
    myRole,
    myTurn,
    inDiscussion,
    discussionTurn,
    showBar,
    addresseeName,
    showMafiaChannel,
    killVotes,
    captionVisible,
    captionWho,
    captionText,
    thinkingLabel,
    // helpers + actions
    nameOf,
    start,
    submitAction,
    skipTurn,
    requestSkipDiscussion,
    sendSpeech,
  };
}
