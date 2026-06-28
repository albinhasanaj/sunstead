'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Eye, EyeOff, Users, ScrollText, LogOut, Timer, SkipForward, Gavel, Check, Target } from 'lucide-react';
import TribunalScene from './TribunalScene';
import { useMafiaGame } from './useMafiaGame';
import { FLOAT_BTN, ROLE_STYLE } from './constants';
import type { MafiaConfig, PresetName } from '@/games/mafia/config';
import AnnouncementBanner from './_components/AnnouncementBanner';
import DeathScreen from './_components/DeathScreen';
import EndgameOverlay from './_components/EndgameOverlay';
import GameRecap from './_components/GameRecap';
import IntroOverlay from './_components/IntroOverlay';
import MafiaChannel from './_components/MafiaChannel';
import MenuOverlay from './_components/MenuOverlay';
import NightNarration from './_components/NightNarration';
import PlayersDrawer from './_components/PlayersDrawer';
import SpeakerCaption from './_components/SpeakerCaption';
import TranscriptDrawer from './_components/TranscriptDrawer';
import VoiceDock from './_components/VoiceDock';

export default function Home() {
  // Pure view toggles — these never touch the engine, so they live in the page.
  const [showLog, setShowLog] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  // Drives the menu→gameplay transition overlay ('play' = role reveal, 'watch' = cinematic).
  const [intro, setIntro] = useState<null | 'play' | 'watch'>(null);
  // Dev-only: force your role for testing (empty = random). Sent to the API.
  const [devRole, setDevRole] = useState('');
  // Lobby config: a Partial<MafiaConfig> the settings panel edits, plus the chosen
  // preset. The full config is resolved server-side; we send this patch to the API.
  const [configPatch, setConfigPatch] = useState<Partial<MafiaConfig>>({});
  const [preset, setPreset] = useState<PresetName>('classic');
  // Watch mode: reveal every agent's secret role (overhead tags + drawer badges).
  // Defaults on so spectators can see who the Mafia is; toggle off for a blind watch.
  const [revealRoles, setRevealRoles] = useState(true);
  // Guards the Leave-game button so a stray click can't drop you out of a live round.
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Endgame flow: 'reveal' = the camera-orbit cutscene + title card, 'recap' = the
  // scorecard, null = done (the lobby/game-over menu shows). Holds the menu back so the
  // ending plays out instead of snapping straight to "play again".
  const [endStage, setEndStage] = useState<null | 'reveal' | 'recap'>(null);
  // Dev-only cutscene triggers: force the endgame reveal (a faked winner) and replay a
  // night/dawn transition beat, without waiting for the engine. Stripped in production.
  const isDev = process.env.NODE_ENV !== 'production';
  const [devWinner, setDevWinner] = useState<string | null>(null);
  const [devPulse, setDevPulse] = useState<{ dir: number; n: number } | null>(null);

  // Everything that touches the engine — game state, audio pacing, phase timers,
  // and the derived view-model — lives in this one hook.
  const {
    musicRef,
    feedEndRef,
    players,
    feed,
    phase,
    selected,
    setSelected,
    winner,
    fate,
    humanVotes,
    running,
    mode,
    humanId,
    turn,
    voiceOn,
    setVoiceOn,
    speakingId,
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
    devSimulateEnd,
    mafiaChance,
    me,
    myRole,
    myTurn,
    inDiscussion,
    showBar,
    addresseeName,
    showMafiaChannel,
    killVotes,
    captionVisible,
    captionWho,
    captionText,
    thinkingLabel,
    nameOf,
    getAudioLevel,
    getSpatial,
    speakerEmotion,
    speakerIntensity,
    lookingAtId,
    start,
    submitAction,
    skipTurn,
    requestSkipDiscussion,
    sendSpeech,
    signalComposing,
  } = useMafiaGame();

  // The real winner, or a dev-forced one for testing the endgame cutscene.
  const endWinner = winner ?? devWinner;

  // When a winner lands, open the reveal cutscene (the scene plays the orbit + unmask
  // regardless; this just holds the lobby menu back until the player moves on).
  useEffect(() => {
    if (endWinner) setEndStage('reveal');
  }, [endWinner]);

  // ── Endgame recap data (derived from the now-public roles + tracked outcomes) ──
  // Computed from the human's SEAT, not `mode`, so it survives a death→spectate flip.
  const youPlayer = humanId ? players.find((p) => p.id === humanId) ?? null : null;
  const youWon = youPlayer
    ? endWinner === 'mafia'
      ? youPlayer.role === 'mafia'
      : endWinner === 'village'
      ? youPlayer.role !== 'mafia'
      : null
    : null;
  const recapTable = players.map((p) => ({ id: p.id, name: p.name, role: p.role, alive: p.alive, fate: fate[p.id] }));
  const mafiaIds = new Set(players.filter((p) => p.role === 'mafia').map((p) => p.id));
  const distinctVotes = Array.from(new Set(humanVotes));
  const voteStat = distinctVotes.length
    ? { total: distinctVotes.length, onMafia: distinctVotes.filter((id) => mafiaIds.has(id)).length }
    : null;

  // Restart the same mode from the recap; mirrors the menu's play/watch entry.
  const playAgain = () => {
    setEndStage(null);
    setDevWinner(null);
    if (mode === 'watch') {
      setIntro('watch');
      start('watch', undefined, configPatch);
    } else {
      setIntro('play');
      start('play', devRole, configPatch);
    }
  };

  // A "target-pick" turn = a night action (kill/investigate/protect) or the vote:
  // you click a face, then a single confirm button appears. There's no talking on
  // these turns, so the voice dock is hidden; a small standalone hint nudges you to
  // click a face, and once one is picked the lone action button is the only control.
  const pickTurn = myTurn && myTurn.phase !== 'DISCUSSION' ? myTurn : null;
  const pickPrompt = !pickTurn
    ? ''
    : pickTurn.legal.includes('mafia_propose_kill')
    ? 'click a face to choose tonight’s victim'
    : pickTurn.legal.includes('investigate')
    ? 'click a face to investigate'
    : pickTurn.legal.includes('protect')
    ? 'click a face to protect — or use “Protect yourself”'
    : pickTurn.legal.includes('vote')
    ? 'click a face to cast your vote'
    : '';
  const targetChosen = !!pickTurn && !!selected && selected !== humanId;

  return (
    <main className="fixed inset-0 bg-black text-neutral-100 font-mono">
      <audio ref={musicRef} hidden />

      {/* The 3D Tribunal scene fills the whole screen; everything else floats on top. */}
      <div className="absolute inset-0">
        <TribunalScene
          players={players}
          phase={phase?.phase ?? 'DISCUSSION'}
          // Once you die and choose to spectate, drop the seat: null id flips the
          // scene into the free orbit camera (the watch-the-agents vantage).
          myId={spectating ? null : humanId}
          myRole={myRole}
          speakingId={speakingId}
          thinkingId={mode === 'play' && phase?.phase === 'NIGHT' ? null : (thinkingIds[0] ?? null)}
          selectedId={selected && selected !== humanId ? selected : null}
          turn={turn}
          findings={findings}
          teammates={teammates}
          protectedId={protectedId}
          killVotes={killVotes}
          thinkingIds={mode === 'play' && phase?.phase === 'NIGHT' ? [] : thinkingIds}
          addresseeId={inDiscussion ? selected : null}
          revealRoles={mode === 'watch' && revealRoles}
          getAudioLevel={getAudioLevel}
          getSpatial={getSpatial}
          speakerEmotion={speakerEmotion}
          speakerIntensity={speakerIntensity}
          lookingAtId={lookingAtId}
          gameOver={endWinner}
          devPulse={devPulse}
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

      {/* floating controls — top-right cluster. Leave-game is primary; the table
          and transcript drawers sit beside it. Mute lives in the bottom voice dock. */}
      <div className="absolute right-3 top-3 z-50 flex items-center gap-2">
        {mode === 'watch' && (
          <button
            onClick={() => setRevealRoles((v) => !v)}
            title={revealRoles ? 'Hide each agent’s secret role' : 'Reveal each agent’s secret role'}
            className={`${FLOAT_BTN} ${revealRoles ? '!border-red-500/40 !text-red-200 hover:!bg-red-500/15' : ''}`}
          >
            {revealRoles ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {revealRoles ? 'Roles shown' : 'Roles hidden'}
          </button>
        )}
        <button onClick={() => setShowPlayers((v) => !v)} title="Open the table — see every player and their status" className={FLOAT_BTN}>
          <Users className="h-3.5 w-3.5" />
          Players
        </button>
        <button onClick={() => setShowLog((v) => !v)} title="Open the full transcript of everything that's been said" className={FLOAT_BTN}>
          <ScrollText className="h-3.5 w-3.5" />
          Transcript
        </button>
        <button
          onClick={() => setConfirmLeave(true)}
          title="Leave the game and return to the lobby"
          className={`${FLOAT_BTN} !border-red-500/40 !text-red-200 hover:!bg-red-500/15`}
        >
          <LogOut className="h-3.5 w-3.5" />
          Leave game
        </button>
      </div>

      {/* leave-game confirmation — a stray click shouldn't drop you out of a live round */}
      {confirmLeave && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-[20rem] rounded-xl border border-neutral-700/70 bg-neutral-950/95 p-5 text-center shadow-2xl">
            <div className="mb-1 text-sm font-semibold text-neutral-100">Leave the game?</div>
            <p className="mb-4 text-xs leading-snug text-neutral-400">
              You’ll abandon this round and return to the lobby. This can’t be undone.
            </p>
            <div className="flex justify-center gap-2">
              <button
                onClick={() => setConfirmLeave(false)}
                className={FLOAT_BTN}
              >
                Stay
              </button>
              <Link
                href="/explore"
                className={`${FLOAT_BTN} !border-red-500/40 !text-red-200 hover:!bg-red-500/15`}
              >
                <LogOut className="h-3.5 w-3.5" />
                Leave
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* phase countdown — generous; just a pacing indicator + skip target */}
      {running && !winner && secondsLeft != null && (
        <div className="absolute left-1/2 top-10 z-30 -translate-x-1/2 rounded-full border border-neutral-700/60 bg-neutral-950/70 px-3 py-1 text-xs tabular-nums tracking-wider text-neutral-300 backdrop-blur">
          <span className={`flex items-center gap-1.5 ${secondsLeft <= 10 ? 'text-amber-300' : ''}`}>
            <Timer className="h-3.5 w-3.5" />
            {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
          </span>
        </div>
      )}

      {/* live "thinking…" cue so the slow AI turns never look frozen */}
      {thinkingLabel && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 flex items-center gap-2 rounded-full border border-neutral-700/50 bg-neutral-950/60 px-3 py-1 text-xs text-neutral-300 backdrop-blur">
          <span>{thinkingLabel}</span>
          <span className="flex gap-1">
            {[0, 1, 2].map((n) => (
              <span key={n} className="h-1 w-1 rounded-full bg-amber-300/80" style={{ animation: `thinkDot 1s ease ${n * 0.18}s infinite` }} />
            ))}
          </span>
          <style>{`@keyframes thinkDot { 0%,100% { opacity:.2 } 50% { opacity:1 } }`}</style>
        </div>
      )}

      {/* bottom-right turn controls: pass your turn / call a vote (consensus) */}
      {running && !winner && mode === 'play' && !!me?.alive && (
        <div className={`absolute right-3 z-40 flex flex-col items-end gap-2 transition-all duration-300 ${showBar ? 'bottom-24' : 'bottom-4'}`}>
          {/* Skip only passes a DISCUSSION turn (stay silent). Night actions
              (kill/investigate/protect) and votes must be made deliberately —
              they can't be skipped away. */}
          {myTurn && myTurn.phase === 'DISCUSSION' && (
            <button onClick={skipTurn} title="Stay silent — pass your turn to speak" className={FLOAT_BTN}>
              <SkipForward className="h-3.5 w-3.5" />
              Skip my turn
            </button>
          )}
          {inDiscussion && (
            <button
              onClick={() => {
                const next = !wantsSkip;
                setWantsSkip(next);
                requestSkipDiscussion(next);
              }}
              title="Call to end discussion early — only fast-forwards if the table agrees"
              className={`${FLOAT_BTN} ${wantsSkip ? '!border-amber-400/70 !bg-amber-500/15 !text-amber-200' : ''}`}
            >
              {wantsSkip ? <Check className="h-3.5 w-3.5" /> : <Gavel className="h-3.5 w-3.5" />}
              {wantsSkip ? 'Waiting for the table…' : 'Move to vote'}
            </button>
          )}
        </div>
      )}

      {/* full-screen menu — doubles as the entry and game-over screen. Held back
          while your death screen is up so a round that ended *with* your death shows
          the death screen first, not a jarring jump to the menu. */}
      {!running && !eliminated && !endStage && (
        <MenuOverlay
          winner={winner}
          devRole={devRole}
          setDevRole={setDevRole}
          configPatch={configPatch}
          setConfigPatch={setConfigPatch}
          preset={preset}
          setPreset={setPreset}
          mafiaChance={mafiaChance}
          onPlay={() => {
            setIntro('play');
            setEndStage(null);
            setDevWinner(null);
            start('play', devRole, configPatch);
          }}
          onWatch={() => {
            setIntro('watch');
            setEndStage(null);
            setDevWinner(null);
            start('watch', undefined, configPatch);
          }}
        />
      )}

      {/* endgame reveal — the cinematic title card over the camera-orbit cutscene while
          every role is unmasked; Continue advances to the scorecard. Held back when you
          died (the DeathScreen owns that beat until you choose to spectate). */}
      {endWinner && endStage === 'reveal' && !eliminated && (
        <EndgameOverlay winner={endWinner} humanWon={youWon} onContinue={() => setEndStage('recap')} />
      )}

      {/* post-game scorecard — who was who, your game, your vote accuracy. */}
      {endWinner && endStage === 'recap' && !eliminated && (
        <GameRecap
          winner={endWinner}
          youWon={youWon}
          you={youPlayer ? { name: youPlayer.name, role: youPlayer.role, survived: youPlayer.alive, fate: fate[youPlayer.id] } : null}
          table={recapTable}
          rounds={phase?.round ?? 1}
          voteStat={voteStat}
          onPlayAgain={playAgain}
          onLobby={() => {
            setEndStage(null);
            setDevWinner(null); // clear a dev-forced ending so the live game resumes
          }}
        />
      )}

      {/* menu → gameplay transition (role reveal for play, cinematic for watch) */}
      {intro && <IntroOverlay mode={intro} role={myRole} teammates={teammates.map(nameOf)} onDone={() => setIntro(null)} />}

      {/* you died — full-screen takeover: spectate the rest, or leave to the lobby.
          Shown a beat after death (deathReady) so the outcome announcement lands
          first; independent of winner/running so it survives a round-ending death. */}
      {eliminated && deathReady && (
        <DeathScreen cause={eliminated.cause} role={eliminated.role} winner={winner} onSpectate={spectate} />
      )}

      {/* night narrator — calls the roles to "wake up" in sequence */}
      {running && phase?.phase === 'NIGHT' && <NightNarration wake={nightWake} myRole={myRole} />}

      {/* dramatic outcome announcement: death (red), doctor-save (teal), quiet (slate) */}
      {announce && <AnnouncementBanner announce={announce} />}

      {/* fading lower-third caption: who's speaking, with their face + line */}
      <SpeakerCaption
        captionWho={captionWho}
        captionText={captionText}
        captionVisible={captionVisible}
        lifted={showBar || (mode === 'play' && !!me?.alive)}
        nameOf={nameOf}
        onOpen={() => setShowLog((v) => !v)}
      />

      {/* Mafia private channel — see what your partner is thinking / proposing */}
      {showMafiaChannel && <MafiaChannel teammates={teammates} humanId={humanId} killVotesByAgent={killVotesByAgent} nameOf={nameOf} />}

      {/* bottom-center voice dock — only while you can actually talk, which is the
          ENTIRE discussion phase (you may interject any time, uninterrupted). At
          night and during the vote there's no talking, so the dock is hidden and the
          target-pick flow owns the bottom-center instead. */}
      {running && !winner && inDiscussion && (
        <VoiceDock
          voiceOn={voiceOn}
          onToggleVoice={() => setVoiceOn((v) => !v)}
          // Real-time interjection: throughout discussion you can speak whenever — no
          // waiting for a turn. The loop folds your line in and the AIs react to it.
          active={inDiscussion}
          waiting={false}
          phaseLabel=""
          speaking={!!speakingId}
          addresseeName={addresseeName}
          onSend={sendSpeech}
          onComposing={signalComposing}
        />
      )}

      {/* night/vote target turns: no dock (you can't talk) — just a small hint to
          click a face. It's swapped out for the confirm button once one is picked. */}
      {running && !winner && pickTurn && !targetChosen && pickPrompt && (
        <div className="pointer-events-none absolute bottom-11 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-neutral-700/60 bg-neutral-950/75 px-4 py-2 text-xs tracking-wide text-neutral-300 backdrop-blur">
          <Target className="h-3.5 w-3.5 text-neutral-400" />
          {pickPrompt}
        </div>
      )}

      {/* dev-only cutscene triggers — replay the transitions / endgame reveal without
          waiting on the engine. Only while a game is live (the scene needs seats).
          Stripped from production builds via the isDev guard. */}
      {isDev && running && !endWinner && (
        <div className="absolute bottom-3 left-3 z-50 flex flex-col gap-1">
          <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-amber-400/60">dev · recap</span>
          <div className="flex flex-wrap gap-1">
            {[
              // fill any hidden roles + seed votes first, so the reveal/recap is populated
              // even in play mode (real games reveal roles via the win event).
              { label: 'Recap: Town win', onClick: () => { devSimulateEnd(); setDevWinner('village'); } },
              { label: 'Recap: Mafia win', onClick: () => { devSimulateEnd(); setDevWinner('mafia'); } },
              { label: 'Night beat', onClick: () => setDevPulse((d) => ({ dir: -1, n: (d?.n ?? 0) + 1 })) },
              { label: 'Dawn beat', onClick: () => setDevPulse((d) => ({ dir: 1, n: (d?.n ?? 0) + 1 })) },
            ].map((b) => (
              <button
                key={b.label}
                onClick={b.onClick}
                className="rounded border border-neutral-700/70 bg-neutral-950/80 px-2 py-1 text-[10px] tracking-wide text-neutral-300 backdrop-blur transition hover:border-amber-400/50 hover:text-amber-100"
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* left drawer — the table (toggled by the Players button) */}
      <PlayersDrawer open={showPlayers} players={players} selected={selected} onSelect={setSelected} turn={turn} hideRoles={mode === 'watch' && !revealRoles} />

      {/* right drawer — the full transcript (toggled by the Transcript button) */}
      <TranscriptDrawer open={showLog} feed={feed} thinkingIds={thinkingIds} phase={phase?.phase} nameOf={nameOf} feedEndRef={feedEndRef} />
    </main>
  );
}
