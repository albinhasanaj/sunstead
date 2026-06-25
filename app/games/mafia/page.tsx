'use client';

import Link from 'next/link';
import { useState } from 'react';
import TribunalScene from './TribunalScene';
import { useMafiaGame } from './useMafiaGame';
import { FLOAT_BTN, ROLE_STYLE } from './constants';
import AnnouncementBanner from './_components/AnnouncementBanner';
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
  // Watch mode: reveal every agent's secret role (overhead tags + drawer badges).
  // Defaults on so spectators can see who the Mafia is; toggle off for a blind watch.
  const [revealRoles, setRevealRoles] = useState(true);

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
    nameOf,
    start,
    submitAction,
    skipTurn,
    requestSkipDiscussion,
    sendSpeech,
  } = useMafiaGame();

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
          thinkingId={mode === 'play' && phase?.phase === 'NIGHT' ? null : (thinkingIds[0] ?? null)}
          accusedId={selected && selected !== humanId ? selected : null}
          turn={turn}
          findings={findings}
          teammates={teammates}
          protectedId={protectedId}
          killVotes={killVotes}
          thinkingIds={mode === 'play' && phase?.phase === 'NIGHT' ? [] : thinkingIds}
          addresseeId={inDiscussion ? selected : null}
          revealRoles={mode === 'watch' && revealRoles}
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
            {revealRoles ? '🕵️ Roles shown' : '🎭 Roles hidden'}
          </button>
        )}
        <button onClick={() => setShowPlayers((v) => !v)} title="The table" className={FLOAT_BTN}>
          👥 Players
        </button>
        <button onClick={() => setShowLog((v) => !v)} title="Full transcript" className={FLOAT_BTN}>
          📜 Transcript
        </button>
        <Link href="/explore" title="Leave the game" className={`${FLOAT_BTN} !border-red-500/40 !text-red-200 hover:!bg-red-500/15`}>
          ⏻ Leave game
        </Link>
      </div>

      {/* phase countdown — generous; just a pacing indicator + skip target */}
      {running && !winner && secondsLeft != null && (
        <div className="absolute left-1/2 top-10 z-30 -translate-x-1/2 rounded-full border border-neutral-700/60 bg-neutral-950/70 px-3 py-1 text-xs tabular-nums tracking-wider text-neutral-300 backdrop-blur">
          <span className={secondsLeft <= 10 ? 'text-amber-300' : ''}>
            ⏱ {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
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
          {myTurn && (
            <button onClick={skipTurn} title="Pass — take no action this turn" className={FLOAT_BTN}>
              ⏭ Skip my turn
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
              {wantsSkip ? '✓ Waiting for the table…' : '⏭ Move to vote'}
            </button>
          )}
        </div>
      )}

      {/* full-screen menu — doubles as the entry and game-over screen */}
      {!running && (
        <MenuOverlay
          winner={winner}
          devRole={devRole}
          setDevRole={setDevRole}
          onPlay={() => {
            setIntro('play');
            start('play', devRole);
          }}
          onWatch={() => {
            setIntro('watch');
            start('watch');
          }}
        />
      )}

      {/* menu → gameplay transition (role reveal for play, cinematic for watch) */}
      {intro && <IntroOverlay mode={intro} role={myRole} onDone={() => setIntro(null)} />}

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

      {/* bottom-center voice dock — the game's primary control */}
      {running && !winner && mode === 'play' && !!me?.alive && (
        <VoiceDock
          voiceOn={voiceOn}
          onToggleVoice={() => setVoiceOn((v) => !v)}
          active={!!discussionTurn && (!voiceOn || voiceIdle)}
          waiting={!!discussionTurn && voiceOn && !voiceIdle}
          phaseLabel={
            inDiscussion
              ? 'the table is talking…'
              : phase?.phase === 'NIGHT'
                ? 'the night is silent'
                : phase?.phase === 'VOTE'
                  ? 'the table is voting…'
                  : ''
          }
          speaking={!!speakingId}
          addresseeName={addresseeName}
          onSend={sendSpeech}
        />
      )}

      {/* left drawer — the table (toggled by the Players button) */}
      <PlayersDrawer open={showPlayers} players={players} selected={selected} onSelect={setSelected} turn={turn} hideRoles={mode === 'watch' && !revealRoles} />

      {/* right drawer — the full transcript (toggled by the Transcript button) */}
      <TranscriptDrawer open={showLog} feed={feed} nameOf={nameOf} feedEndRef={feedEndRef} />
    </main>
  );
}
