'use client';

import { useState } from 'react';
import { usePushToTalk } from '../usePushToTalk';

// ── Bottom-center voice dock ─────────────────────────────────────────────────
// The game's primary control surface. Voice-first: hold the mic to speak your
// move (push-to-talk → STT → sent as a DISCUSSION line). A text toggle reveals a
// keyboard fallback, the mute button rides alongside, and the animated orb pulses
// while you're recording or while the table is voicing a line.
export default function VoiceDock({
  voiceOn,
  onToggleVoice,
  active,
  waiting,
  phaseLabel,
  speaking,
  addresseeName,
  onSend,
}: {
  voiceOn: boolean;
  onToggleVoice: () => void;
  active: boolean; // your discussion turn AND the table has finished talking → enabled
  waiting: boolean; // your turn, but holding until the spoken backlog finishes
  phaseLabel: string; // hint shown when it isn't your turn
  speaking: boolean; // table is voicing a line → animate the orb
  addresseeName: string | null;
  onSend: (text: string) => void;
}) {
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState('');
  const ptt = usePushToTalk((t) => {
    const clean = t.trim();
    if (!clean) return;
    if (textMode) {
      setText((prev) => (prev ? `${prev} ${clean}` : clean));
    } else if (active) {
      onSend(clean); // voice-first: speak it straight away
    }
  });

  const recording = ptt.status === 'recording';
  const transcribing = ptt.status === 'transcribing';
  const live = recording || transcribing || speaking;
  const accent = recording ? '#f0586a' : active ? '#f0b54a' : '#8b93a8';

  const sendText = () => {
    if (!active) return;
    const clean = text.trim();
    if (!clean) return;
    onSend(clean);
    setText('');
  };

  return (
    // The dock floats over the scene + the bottom-center pick buttons; keep it
    // pointer-transparent so only its actual controls (not the empty gaps or the
    // hint text) capture clicks, leaving the KILL/vote buttons and heads clickable.
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-2.5">
      <style>{`
        @keyframes vdRing { 0% { transform: scale(.6); opacity:.55 } 100% { transform: scale(2.1); opacity:0 } }
        @keyframes vdBar  { 0%,100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
      `}</style>

      {/* keyboard fallback row (toggled) */}
      {textMode && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-neutral-700/70 bg-neutral-950/85 px-2 py-1.5 backdrop-blur">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendText()}
            placeholder={active ? (addresseeName ? `say something to ${addresseeName}…` : 'say something…') : 'wait for your turn…'}
            disabled={!active}
            className="min-w-[240px] flex-1 rounded-full bg-transparent px-3 py-1 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={sendText}
            disabled={!active || !text.trim()}
            className="rounded-full bg-amber-500 px-4 py-1 text-sm font-semibold text-neutral-950 transition hover:bg-amber-400 disabled:bg-neutral-700 disabled:text-neutral-500"
          >
            Send
          </button>
        </div>
      )}

      {/* addressee chip — who your next line is aimed at */}
      {addresseeName && active && (
        <div className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-0.5 text-[11px] text-amber-200">
          → speaking to <span className="font-semibold">{addresseeName}</span>
        </div>
      )}

      {/* main control row: mute · mic orb · keyboard toggle */}
      <div className="pointer-events-auto flex items-center gap-4">
        <button
          onClick={onToggleVoice}
          title={voiceOn ? 'Mute voices' : 'Unmute voices'}
          className={`flex h-11 w-11 items-center justify-center rounded-full border text-lg backdrop-blur transition ${
            voiceOn ? 'border-neutral-700/70 bg-neutral-950/70 text-neutral-200 hover:bg-neutral-800/80' : 'border-red-500/40 bg-red-500/10 text-red-300'
          }`}
        >
          {voiceOn ? '🔊' : '🔇'}
        </button>

        {/* the orb — hold to talk */}
        <button
          type="button"
          disabled={!active}
          onMouseDown={ptt.start}
          onMouseUp={ptt.stop}
          onMouseLeave={() => recording && ptt.stop()}
          onTouchStart={(e) => {
            e.preventDefault();
            ptt.start();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            ptt.stop();
          }}
          title={active ? 'Hold to speak your move' : 'Wait for your turn'}
          className="relative flex h-20 w-20 items-center justify-center rounded-full transition disabled:cursor-default"
          style={{
            background: `radial-gradient(circle at 50% 35%, ${accent}33, ${accent}10 60%, transparent 70%)`,
          }}
        >
          {/* expanding rings while live */}
          {live &&
            [0, 1, 2].map((n) => (
              <span
                key={n}
                className="absolute inset-0 rounded-full border"
                style={{ borderColor: accent, animation: `vdRing 1.6s ease-out ${n * 0.45}s infinite` }}
              />
            ))}
          {/* core disc */}
          <span
            className="relative flex h-16 w-16 items-center justify-center rounded-full border text-2xl"
            style={{
              borderColor: accent,
              background: recording ? 'rgba(240,88,106,0.18)' : 'rgba(8,10,16,0.8)',
              boxShadow: live ? `0 0 26px ${accent}88` : `0 0 12px ${accent}44`,
              color: accent,
              opacity: active ? 1 : 0.5,
            }}
          >
            {transcribing ? (
              <span className="flex items-end gap-0.5">
                {[0, 1, 2, 3].map((n) => (
                  <span key={n} className="h-4 w-1 origin-bottom rounded bg-current" style={{ animation: `vdBar .7s ease ${n * 0.12}s infinite` }} />
                ))}
              </span>
            ) : recording ? (
              '●'
            ) : (
              '🎤'
            )}
          </span>
        </button>

        <button
          onClick={() => setTextMode((v) => !v)}
          title={textMode ? 'Hide keyboard' : "Type instead (if you can't speak)"}
          className={`flex h-11 w-11 items-center justify-center rounded-full border text-lg backdrop-blur transition ${
            textMode ? 'border-amber-400/60 bg-amber-500/15 text-amber-200' : 'border-neutral-700/70 bg-neutral-950/70 text-neutral-200 hover:bg-neutral-800/80'
          }`}
        >
          ⌨
        </button>
      </div>

      {/* hint line */}
      <div className="text-[11px] tracking-wide text-neutral-400">
        {active ? (
          <span className="text-amber-200/90">your turn — {recording ? 'release to send' : transcribing ? 'transcribing…' : 'hold the mic to speak'}</span>
        ) : waiting ? (
          <span className="text-sky-300/80">listening — you’re up once the table finishes…</span>
        ) : (
          <span>{phaseLabel}</span>
        )}
      </div>
    </div>
  );
}
