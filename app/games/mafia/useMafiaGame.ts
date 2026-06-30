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
import { PHASE_SECS, MAFIA_CHANCE_START, MAFIA_CHANCE_STEP, MAFIA_CHANCE_KEY } from './constants';
import type { Announce, Feed, Player, Turn } from './types';
import type { MafiaConfig } from '@/games/mafia/config';

export function useMafiaGame() {
  const { profile, userId } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [feed, setFeed] = useState<Feed[]>([]);
  const [phase, setPhase] = useState<{ phase: string; round: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  // Endgame recap data: how each seat met its end (for the unmasking list), and every
  // face the human voted to lynch (for their personal vote-accuracy stat).
  const [fate, setFate] = useState<Record<string, 'killed' | 'lynched'>>({});
  const [humanVotes, setHumanVotes] = useState<string[]>([]);
  // The vote-reveal cutscene: ordered voter ids, each one's target, and how many have
  // been flipped so far. Null when not revealing. Drives the papers, camera and tally.
  const [voteReveal, setVoteReveal] = useState<{ order: string[]; votes: Record<string, string>; step: number } | null>(null);
  // Who has LOCKED IN a vote this round (ids only — never their choice), for the live
  // checkmarks; and the human's own confirmed target (to keep their slip filled in).
  const [committedVoters, setCommittedVoters] = useState<string[]>([]);
  const [myConfirmedVote, setMyConfirmedVote] = useState<string | null>(null);
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
  // The current speaker's PUBLIC expression (emotion + intensity + who they're looking
  // at), synced to the line actually playing — drives body language + gaze in the scene.
  const [speakerExpr, setSpeakerExpr] = useState<{ emotion: string; intensity: number; lookingAt: string | null } | null>(null);
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
  // You (the human) were eliminated — holds the cause + your now-sealed fate; null
  // while you're alive. Set the instant you die (so it immediately suppresses the
  // game-over menu, even if the same vote ends the round), while `deathReady` arms a
  // beat later — letting the death announcement + sting land before the screen takes
  // over the view.
  const [eliminated, setEliminated] = useState<{ cause: 'voted' | 'killed'; role: string } | null>(null);
  const [deathReady, setDeathReady] = useState(false);
  // True once you choose to keep watching after dying: the camera drops into the free
  // spectator vantage (same POV as watch-the-agents) for the rest of the round.
  const [spectating, setSpectating] = useState(false);
  const deathTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Personal "pity" odds of drawing Mafia (play mode). Persisted per-browser: it
  // climbs each game you're not Mafia and resets the game you are. We keep a ref in
  // lockstep so `start` can read the live value without re-creating the callback.
  const [mafiaChance, setMafiaChance] = useState<number>(MAFIA_CHANCE_START);
  const mafiaChanceRef = useRef(MAFIA_CHANCE_START);
  mafiaChanceRef.current = mafiaChance;
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(MAFIA_CHANCE_KEY));
      if (Number.isFinite(stored) && stored >= 0) setMafiaChance(Math.min(100, stored));
    } catch {
      /* localStorage unavailable — start from the default */
    }
  }, []);

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

  // Your own death: let the announcement banner + sting play, then raise the
  // full-screen death screen. We capture your role now (you always know your own).
  const armDeathScreen = useCallback((cause: 'voted' | 'killed', e: { target?: string; role?: string }) => {
    const role = e.role ?? playersRef.current.find((p) => p.id === e.target)?.role ?? 'unknown';
    setEliminated({ cause, role }); // immediate → the game-over menu can't sneak in first
    setDeathReady(false);
    if (deathTimerRef.current) clearTimeout(deathTimerRef.current);
    deathTimerRef.current = setTimeout(() => setDeathReady(true), 2400);
  }, []);

  // Stage 5 hero-line gating (config-driven, client-side so it knows the round + cap).
  // heroCfg comes from the server-echoed config; heroUsed resets each new round.
  const heroCfgRef = useRef<{ model?: string; minIntensity: number; perRound: number } | null>(null);
  const heroUsedRef = useRef(0);
  const heroRoundRef = useRef(0);

  const abortRef = useRef<AbortController | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const playersRef = useRef<Player[]>([]);
  playersRef.current = players;
  // Live humanId for the (deps-light) event handler, so it can tell your own line apart.
  const humanIdRef = useRef<string | null>(null);
  humanIdRef.current = humanId;
  // Live gameId, so the control-POST helpers below stay stable (no deps) and can be
  // called from the voice queue's listeners without going stale across games.
  const gameIdRef = useRef<string | null>(null);
  gameIdRef.current = gameId;
  const nameOf = useCallback((id: string) => playersRef.current.find((p) => p.id === id)?.name ?? id, []);

  // ── vote-reveal cutscene plumbing ──
  // Votes arrive from the engine in one burst at tally, immediately followed by the
  // elimination. We capture the burst, HOLD every event that follows (the lynch reveal,
  // the next phase) and replay them only once the seat-by-seat reveal has finished — so
  // the papers/tally tell the story before the body drops.
  const voteBufRef = useRef<{ voter: string; target: string }[]>([]);
  const holdRef = useRef(false); // buffering post-burst events?
  const heldRef = useRef<any[]>([]); // events parked until the cutscene ends
  const revealStartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRef = useRef<((e: any) => void) | null>(null); // late-bound, to flush held events

  // End the hold: stop buffering and replay the parked events in arrival order.
  const releaseHold = useCallback(() => {
    if (revealSafetyRef.current) { clearTimeout(revealSafetyRef.current); revealSafetyRef.current = null; }
    holdRef.current = false;
    setVoteReveal(null);
    setCommittedVoters([]); // fresh checkmarks for any runoff that follows
    setMyConfirmedVote(null);
    const ev = heldRef.current;
    heldRef.current = [];
    for (const e of ev) handleRef.current?.(e);
  }, []);

  // The full burst has landed (fired from a setTimeout(0) after the synchronous flush):
  // turn it into an ordered reveal the driver effect walks through.
  const startVoteReveal = useCallback(() => {
    revealStartRef.current = null;
    const buf = voteBufRef.current;
    voteBufRef.current = [];
    if (!buf.length) { releaseHold(); return; }
    const votes: Record<string, string> = {};
    for (const v of buf) votes[v.voter] = v.target;
    // Drop all the lines into the transcript up front; the cutscene paces the visuals.
    setFeed((f) => [...f, ...buf.map((v) => ({ k: 'vote' as const, who: v.voter, target: v.target }))]);
    setVoteReveal({ order: buf.map((v) => v.voter), votes, step: 0 });
    revealSafetyRef.current = setTimeout(releaseHold, 45000); // never strand the game (≈4.5s/voter)
  }, [releaseHold]);

  const postControl = useCallback((body: Record<string, unknown>) => {
    const id = gameIdRef.current;
    if (!id) return;
    fetch('/api/game/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: id, ...body }) }).catch(() => {});
  }, []);
  // Tell the loop a line finished voicing → it may advance to the next AI beat (this
  // is what paces AI talk to the audio instead of racing ahead).
  const ackVoiceDone = useCallback(() => postControl({ control: 'voiceDone' }), [postControl]);
  // Tell the loop you're actively composing (mic held / typing) → it holds the floor
  // for you and won't let an AI take over until you send or stop.
  const signalComposing = useCallback(() => postControl({ control: 'composing' }), [postControl]);

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
        setSpeakerExpr({ emotion: item.emotion ?? 'neutral', intensity: item.intensity ?? 0.4, lookingAt: item.lookingAt ?? null });
      },
      onEnd: (item) => {
        setSpeakingId((cur) => (cur === item.id ? null : cur));
        setSpeakerExpr(null); // next line's onStart sets it again; gaze relaxes between lines
        ackVoiceDone(); // a voiced AI line just finished → let the loop play the next beat
      },
      onIdle: (v) => setVoiceIdle(v),
    });
  }, [voice, ackVoiceDone]);

  const handle = useCallback(
    (e: any) => {
      // While the vote-reveal cutscene is running, park everything that follows the vote
      // burst (the elimination, the next phase) so it lands AFTER the reveal, not on top.
      if (holdRef.current && e.type !== 'vote') {
        heldRef.current.push(e);
        return;
      }
      switch (e.type) {
        case 'game':
          setGameId(e.gameId);
          setMode(e.mode);
          setHumanId(e.humanId);
          // Honor the server-resolved config (e.g. voiceEnabled may have been clamped).
          if (e.config && typeof e.config.voiceEnabled === 'boolean') setVoiceOn(e.config.voiceEnabled);
          // Stage 5: capture the hero-line gating config (off unless heroLineModel set).
          if (e.config) {
            heroCfgRef.current = {
              model: typeof e.config.heroLineModel === 'string' ? e.config.heroLineModel : undefined,
              minIntensity: Number.isFinite(e.config.heroLineMinIntensity) ? e.config.heroLineMinIntensity : 0.85,
              perRound: Number.isFinite(e.config.heroLinesPerRound) ? e.config.heroLinesPerRound : 1,
            };
          }
          break;
        case 'setup': {
          setPlayers(e.players.map((p: Player) => ({ ...p, alive: true })));
          setPhase({ phase: e.phase, round: e.round });
          // Only auto-select the human (for the minds panel); in watch mode leave
          // nothing selected so the scene's heads follow the speaker rather than
          // locking onto a default "accused" player.
          const meSeat = e.players.find((p: Player) => p.human);
          setSelected((s) => s ?? meSeat?.id ?? null);
          // Pity timer (play mode only): now that this game's role is sealed, reset
          // the odds if you drew Mafia, otherwise nudge them up for next time.
          if (meSeat) {
            const next = meSeat.role === 'mafia' ? MAFIA_CHANCE_START : Math.min(100, mafiaChanceRef.current + MAFIA_CHANCE_STEP);
            mafiaChanceRef.current = next;
            setMafiaChance(next);
            try {
              localStorage.setItem(MAFIA_CHANCE_KEY, String(next));
            } catch {
              /* localStorage unavailable — keep the in-memory value */
            }
          }
          break;
        }
        case 'phase': {
          voice.reset(); // drop any leftover spoken backlog before the phase turns over
          if (e.round !== heroRoundRef.current) { heroRoundRef.current = e.round; heroUsedRef.current = 0; } // new round → refill the hero cap
          setPhase({ phase: e.phase, round: e.round });
          setFeed((f) => [...f, { k: 'phase', phase: e.phase, round: e.round }]);
          setKillVotesByAgent({}); // kill votes are per-night; reset each phase change
          setCommittedVoters([]); // fresh slate of vote checkmarks each phase
          setMyConfirmedVote(null);
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
            // Stage 5 gate: a rare decisive line gets the richer v3 read IF the config
            // enables it, the line clears the intensity threshold, and this round's cap
            // isn't spent. Everything else stays on the fast flash path (Stage 1).
            const hc = heroCfgRef.current;
            const intensity = typeof e.intensity === 'number' ? e.intensity : 0.4;
            let hero = false;
            if (hc?.model && intensity >= hc.minIntensity && heroUsedRef.current < hc.perRound) {
              hero = true;
              heroUsedRef.current += 1;
            }
            // Voice on (AI line): the audio queue paces the caption + speaking head,
            // one line at a time, so the floor never jumps ahead to the next model. The
            // expression rides the item so it lands exactly when this line plays.
            voice.enqueue({ id: e.agent, name: nameOf(e.agent), text: e.text, emotion: e.emotion, intensity: e.intensity, lookingAt: e.lookingAt, hero });
          } else {
            // Your OWN line (no need to read it back to you) or a muted AI line: no
            // audio to pace against — hold the caption a readable, text-length beat.
            setSpeakingId(e.agent);
            setSpeakingLine({ who: e.agent, text: e.text });
            setSpeakerExpr({ emotion: e.emotion ?? 'neutral', intensity: e.intensity ?? 0.4, lookingAt: e.lookingAt ?? null });
            if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
            speakTimerRef.current = setTimeout(() => {
              setSpeakingId((cur) => (cur === e.agent ? null : cur));
              setSpeakerExpr(null);
              if (!isHuman) ackVoiceDone(); // muted: pace the next AI beat to reading speed
            }, Math.max(2000, (e.text?.length ?? 0) * 60));
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
          // Mark them dead. The role is present on the wire only when the game reveals
          // it (config.revealRoleOnDeath) or it's your own death — otherwise it stays secret.
          setPlayers((ps) => ps.map((p) => (p.id === e.target ? { ...p, alive: false, ...(e.role ? { role: e.role } : {}) } : p)));
          setFate((m) => ({ ...m, [e.target]: 'killed' }));
          setFeed((f) => [...f, { k: 'system', text: `☠ ${nameOf(e.target)} was killed in the night.${e.role && e.target !== humanIdRef.current ? ` (was ${e.role})` : ''}` }]);
          showAnnounce({ eyebrow: 'Killed in the night', title: nameOf(e.target), face: nameOf(e.target), tone: 'death' });
          playSfx('death');
          if (e.target === humanIdRef.current) armDeathScreen('killed', e);
          break;
        case 'reveal':
          setPlayers((ps) => ps.map((p) => (p.id === e.target ? { ...p, alive: false, ...(e.role ? { role: e.role } : {}) } : p)));
          setFate((m) => ({ ...m, [e.target]: 'lynched' }));
          setFeed((f) => [...f, { k: 'system', text: `🗳 ${nameOf(e.target)} was voted out.${e.role && e.target !== humanIdRef.current ? ` (was ${e.role})` : ''}` }]);
          showAnnounce({ eyebrow: 'Voted out by the table', title: nameOf(e.target), face: nameOf(e.target), tone: 'death' });
          playSfx('reveal');
          if (e.target === humanIdRef.current) armDeathScreen('voted', e);
          break;
        case 'night':
          // Anonymous night outcome — no names of who was targeted or who saved them.
          if (e.outcome === 'saved') {
            setFeed((f) => [...f, { k: 'system', text: '🛡 The Mafia struck — but the doctor saved their target. No one died.' }]);
            showAnnounce({ eyebrow: "The doctor's work", title: 'A life was saved', face: null, tone: 'save' });
            playSfx('reveal');
          } else if (e.outcome === 'night0') {
            // The opening night is a guaranteed no-kill by the rules — frame it that
            // way, not as a mysteriously "quiet" night.
            setFeed((f) => [...f, { k: 'system', text: '🌙 No one can be killed on the first night — the hunt begins.' }]);
            showAnnounce({ eyebrow: 'Dawn breaks', title: 'A peaceful first night', face: null, tone: 'quiet' });
          } else {
            setFeed((f) => [...f, { k: 'system', text: '🌙 The night passed quietly — no one died.' }]);
            showAnnounce({ eyebrow: 'Dawn breaks', title: 'A quiet night', face: null, tone: 'quiet' });
          }
          break;
        case 'vote':
          // Don't render the vote live — capture the burst and reveal it seat-by-seat.
          // Engage the hold so the elimination that follows is deferred to the cutscene's
          // end, and kick off the reveal once the whole synchronous burst has landed.
          holdRef.current = true;
          voteBufRef.current.push({ voter: e.agent, target: e.target });
          if (!revealStartRef.current) revealStartRef.current = setTimeout(startVoteReveal, 0);
          break;
        case 'action':
          // A Mafia teammate's kill proposal (only reaches you when you're Mafia).
          if (e.kind === 'propose_kill' && e.target) setKillVotesByAgent((m) => ({ ...m, [e.agent]: e.target }));
          // A vote commitment (target stripped server-side) → check this voter off.
          if (e.kind === 'vote') setCommittedVoters((s) => (s.includes(e.agent) ? s : [...s, e.agent]));
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
        case 'win': {
          voice.reset();
          setWinner(e.winner);
          // Unmask every seat for the endgame reveal: fold the now-public roles into
          // player state so the scene can flip their true allegiance up overhead.
          if (e.roles?.length) {
            const roleById = new Map<string, string>((e.roles as { id: string; role: string }[]).map((r) => [r.id, r.role]));
            setPlayers((ps) => ps.map((p) => (roleById.has(p.id) ? { ...p, role: roleById.get(p.id)! } : p)));
          }
          setFeed((f) => [...f, { k: 'win', winner: e.winner }]);
          playSfx('win');
          if (musicRef.current) musicRef.current.volume = 0.05;
          break;
        }
        case 'done':
          setTurn(null);
          break;
        case 'error':
          setFeed((f) => [...f, { k: 'error', text: e.message }]);
          break;
      }
    },
    [nameOf, voice, playSfx, showAnnounce, ackVoiceDone, armDeathScreen, startVoteReveal],
  );
  handleRef.current = handle; // late binding so releaseHold can flush parked events

  // Vote-reveal driver: flip one slip every beat (dropping its line into the feed), then
  // hold on the final tally before releasing the elimination.
  useEffect(() => {
    if (!voteReveal) return;
    const { order, step } = voteReveal;
    if (step < order.length) {
      // ~4.5s per voter: a front shot of them, the hold + 180° flip, then a beat to read.
      const t = setTimeout(() => setVoteReveal((prev) => (prev ? { ...prev, step: prev.step + 1 } : prev)), 4500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(releaseHold, 1600); // linger on the full table, then the body drops
    return () => clearTimeout(t);
  }, [voteReveal, releaseHold]);

  const start = useCallback(
    async (m: 'watch' | 'play', devRoleArg?: string, config?: Partial<MafiaConfig>) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setPlayers([]);
      setFeed([]);
      setWinner(null);
      setFate({});
      setHumanVotes([]);
      // tear down any in-flight vote-reveal cutscene
      setVoteReveal(null);
      setCommittedVoters([]);
      setMyConfirmedVote(null);
      voteBufRef.current = [];
      heldRef.current = [];
      holdRef.current = false;
      if (revealStartRef.current) { clearTimeout(revealStartRef.current); revealStartRef.current = null; }
      if (revealSafetyRef.current) { clearTimeout(revealSafetyRef.current); revealSafetyRef.current = null; }
      setPhase(null);
      setTurn(null);
      setSelected(null);
      setSpeakingId(null);
      setSpeakingLine(null);
      setSpeakerExpr(null);
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
      setEliminated(null);
      setDeathReady(false);
      setSpectating(false);
      if (deathTimerRef.current) clearTimeout(deathTimerRef.current);
      announcedTeamRef.current = false;
      setMode(m);
      setRunning(true);
      // Mint the game (session) id client-side so the game is addressable immediately:
      // we reflect it in the URL (?id=…) and hand it to the API, which keys the DB row,
      // long-term memory, and the SSE session off the same id. The server echoes it back
      // on the 'game' event (same value), keeping everything in lockstep.
      const id = crypto.randomUUID();
      setGameId(id);
      gameIdRef.current = id;
      try {
        window.history.replaceState(null, '', `${window.location.pathname}?id=${id}`);
      } catch {
        /* history unavailable — the id still drives the game, just not the URL */
      }
      // Voice is a config toggle — default the mute state to it (server echoes the
      // resolved value on the 'game' event, which we honor too).
      setVoiceOn(config?.voiceEnabled !== false);
      voice.prime(); // we're in the Play/Watch click gesture — wake the audio context now
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
            id,
            mode: m,
            ...(userId ? { userId } : {}),
            ...(m === 'play' && profile?.displayName ? { playerName: profile.displayName } : {}),
            ...(devRoleArg ? { devRole: devRoleArg } : {}),
            ...(config ? { config } : {}),
            ...(m === 'play' ? { mafiaChance: mafiaChanceRef.current } : {}),
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
    [handle, voice, profile, userId],
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
      // Remember who you voted to lynch, for the endgame recap's vote-accuracy stat,
      // and check yourself off / keep your slip filled in for the rest of the phase.
      if (tool === 'vote' && args.target) {
        setHumanVotes((v) => [...v, args.target]);
        setMyConfirmedVote(args.target);
        if (humanId) setCommittedVoters((s) => (s.includes(humanId) ? s : [...s, humanId]));
      }
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

  // Dev/testing: force the discussion to end and jump straight to the vote.
  const skipToVote = useCallback(async () => {
    try {
      await fetch('/api/game/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, control: 'forceVote' }),
      });
    } catch {
      /* ignore */
    }
  }, [gameId]);

  // You chose to keep watching after dying: drop the death screen and switch to the
  // free spectator camera (same POV as watch-the-agents) for the rest of the round.
  const spectate = useCallback(() => {
    if (deathTimerRef.current) clearTimeout(deathTimerRef.current);
    setEliminated(null);
    setDeathReady(false);
    setSpectating(true);
    setMode('watch');
  }, []);

  // Dev/testing only: take your own life so you can reach the death screen without
  // waiting to be voted out or killed. Removes you from the live game server-side
  // (the round plays on without your turns) and raises the death screen locally.
  const suicide = useCallback(() => {
    const id = humanIdRef.current;
    if (!id) return;
    setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, alive: false } : p)));
    setFeed((f) => [...f, { k: 'system', text: `☠ ${nameOf(id)} met a sudden end.` }]);
    showAnnounce({ eyebrow: 'A sudden end', title: nameOf(id), face: nameOf(id), tone: 'death' });
    playSfx('death');
    armDeathScreen('killed', { target: id });
    postControl({ control: 'suicide' }); // tell the loop to drop our seat so it continues
  }, [nameOf, showAnnounce, playSfx, armDeathScreen, postControl]);

  // Dev/testing only: populate plausible roles for any STILL-HIDDEN seats (and seed a
  // couple of your votes) so the endgame recap + reveal have real data to show without
  // playing a game to completion. Known roles (watch mode) are left untouched.
  const devSimulateEnd = useCallback(() => {
    if (!players.length) return;
    let mafiaLeft = Math.max(1, Math.round(players.length / 4)) - players.filter((p) => p.role === 'mafia').length;
    let needDet = !players.some((p) => p.role === 'detective');
    let needDoc = !players.some((p) => p.role === 'doctor');
    const next = players.map((p) => {
      if (p.role !== 'unknown') return p;
      let role = 'villager';
      if (mafiaLeft > 0) { role = 'mafia'; mafiaLeft -= 1; }
      else if (needDet) { role = 'detective'; needDet = false; }
      else if (needDoc) { role = 'doctor'; needDoc = false; }
      return { ...p, role };
    });
    setPlayers(next);
    const hid = humanIdRef.current;
    if (hid) {
      const others = next.filter((p) => p.id !== hid);
      const votes = [others.find((p) => p.role === 'mafia')?.id, others.find((p) => p.role !== 'mafia')?.id].filter(Boolean) as string[];
      if (votes.length) setHumanVotes(votes);
    }
  }, [players]);

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
      // Real-time interjection: hand the line straight to the loop, which injects it
      // at the next beat boundary so the AIs react to it. The server echoes it back as
      // a speak event, so it shows in the transcript like any other line. `to` lets the
      // scheduler give the agent you addressed the floor for the next beat (direct reply).
      postControl({ control: 'say', tool: 'speak', args: { text: directed }, to: addresseeId });
    },
    [addresseeName, addresseeId, postControl],
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

  // Tear the game down when the screen unmounts (e.g. you hit "Leave game" and
  // navigate away): abort the SSE stream so the server loop doesn't linger as a
  // zombie session, and stop the tension bed. Without this a left game keeps
  // running server-side and the next game overlaps it — the "everything's weird
  // after you leave" bug. (AbortError is swallowed by start()'s catch.)
  useEffect(
    () => () => {
      clearTimeout(speakTimerRef.current ?? undefined);
      clearTimeout(announceTimer.current ?? undefined);
      clearTimeout(deathTimerRef.current ?? undefined);
      abortRef.current?.abort();
      musicRef.current?.pause();
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
    fate,
    humanVotes,
    voteReveal,
    committedVoters,
    myConfirmedVote,
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
    eliminated,
    deathReady,
    spectating,
    spectate,
    suicide,
    devSimulateEnd,
    skipToVote,
    mafiaChance,
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
    // Live voice loudness (0..1) for the 3D scene's speaking-seat glow. Stable getter
    // sampled per animation frame, so it never triggers React re-renders.
    getAudioLevel: voice.getLevel,
    // Binaural audio nodes (panner + listener) for the scene to pose each frame, so a
    // line is heard FROM the speaking seat's direction. Stable getter; null until audio starts.
    getSpatial: voice.getSpatial,
    // Current speaker's public expression → body language + gaze in the 3D scene.
    speakerEmotion: speakerExpr?.emotion ?? null,
    speakerIntensity: speakerExpr?.intensity ?? 0,
    lookingAtId: speakerExpr?.lookingAt ?? null,
    start,
    submitAction,
    skipTurn,
    requestSkipDiscussion,
    sendSpeech,
    signalComposing,
  };
}
