// ── Expression taxonomy — the SINGLE source for the one expression signal ───────
// The LLM emits { emotion, intensity } on its spoken action (a PUBLIC signal). Two
// consumers fan out from here: the voice layer maps it to ElevenLabs delivery
// settings (below), and the client maps it to body language (TribunalScene). Emotion
// is never computed twice. This file is dependency-free (no server-only imports) so
// both the server voice path and the client bundle can import it.

export const EMOTIONS = [
  'neutral',
  'suspicious',
  'defensive',
  'nervous',
  'confident',
  'aggressive',
  'smug',
  'panicked',
  'amused',
] as const;
export type Emotion = (typeof EMOTIONS)[number];

export interface Expression {
  emotion: Emotion;
  intensity: number; // 0..1
}

export const isEmotion = (x: unknown): x is Emotion =>
  typeof x === 'string' && (EMOTIONS as readonly string[]).includes(x);

// Fail-safe coercions: a missing/invalid emotion degrades to neutral; intensity
// clamps to [0,1] with a calm default. Nothing here can throw.
export const coerceEmotion = (x: unknown): Emotion => (isEmotion(x) ? x : 'neutral');
export const coerceIntensity = (x: unknown, dflt = 0.4): number => {
  const v = Number(x);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : dflt;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clampRange = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Per-emotion delivery target at FULL intensity, plus the neutral baseline. Intensity
// scales the distance from neutral toward the target (so 0 = neutral, 1 = full emotion).
// v3Tag is hero-only (Stage 5) and is NEVER sent to flash_v2_5 (it would be read aloud).
type EmoSpec = { stability: number; style: number; speed: number; v3Tag?: string };
const NEUTRAL: EmoSpec = { stability: 0.55, style: 0.15, speed: 1.0 };
const EMOTION_VOICE: Record<Emotion, EmoSpec> = {
  neutral: NEUTRAL,
  suspicious: { stability: 0.45, style: 0.35, speed: 0.97, v3Tag: 'suspicious' },
  defensive: { stability: 0.4, style: 0.45, speed: 1.03, v3Tag: 'defensive' },
  nervous: { stability: 0.3, style: 0.5, speed: 1.05, v3Tag: 'nervous' },
  confident: { stability: 0.6, style: 0.3, speed: 1.0 },
  aggressive: { stability: 0.35, style: 0.6, speed: 1.05, v3Tag: 'angry' },
  smug: { stability: 0.5, style: 0.45, speed: 0.97, v3Tag: 'sarcastic' },
  panicked: { stability: 0.25, style: 0.65, speed: 1.1, v3Tag: 'nervous' },
  amused: { stability: 0.45, style: 0.45, speed: 1.0, v3Tag: 'scoffs' },
};

// The shape we hand ElevenLabs (matches @elevenlabs/elevenlabs-js VoiceSettings).
export interface VoiceSettingsShape {
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
  speed: number;
}

// Map an expression → flash voiceSettings. Lower stability = broader emotional range;
// higher style = more expressive. Intensity scales both away from the neutral baseline.
export function voiceSettingsFor(emotion: Emotion, intensity: number): VoiceSettingsShape {
  const spec = EMOTION_VOICE[emotion] ?? NEUTRAL;
  const k = coerceIntensity(intensity);
  return {
    stability: clampRange(lerp(NEUTRAL.stability, spec.stability, k), 0.1, 0.95),
    similarityBoost: 0.75,
    style: clampRange(lerp(NEUTRAL.style, spec.style, k), 0, 0.9),
    useSpeakerBoost: true,
    speed: clampRange(lerp(NEUTRAL.speed, spec.speed, k), 0.7, 1.2),
  };
}

// A single v3 audio tag for a hero line (Stage 5), or null for emotions we leave plain.
// Only ever prefixed onto text on the v3 code path — never on flash.
export function v3TagFor(emotion: Emotion): string | null {
  const t = EMOTION_VOICE[emotion]?.v3Tag;
  return t ? `[${t}]` : null;
}
