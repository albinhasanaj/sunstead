// agentName → ElevenLabs voiceId. These are ElevenLabs *default* voices, which
// work on the free plan (library voices require a paid plan). Picked to roughly
// match each seat's personality. Any voiceId can be swapped in here.
export const VOICES: Record<string, string> = {
  GPT: 'JBFqnCBsd6RMkjVDRZzb', // George — warm, captivating storyteller (the diplomat)
  GPTmini: 'FGY2WhTYpPnrIDTdsKH5', // Laura — quicker, lighter GPT
  Claude: 'CwhRBWXzGAHq8TQ4Fs17', // Roger — laid-back, resonant (the measured Sonnet)
  Opus: 'IKne3meq5aSn9XLyUdCD', // Charlie — deep, weighty (the flagship)
  Haiku: 'hpp4J3VqNfWAUOO0d1Us', // Bella — bright, brisk (the featherweight)
  Gemini: 'EXAVITQu4vr4xnSDxMaL', // Sarah — mature, confident (the know-it-all)
  GeminiPro: 'JBFqnCBsd6RMkjVDRZzb', // George — fuller, deliberate Gemini
  DeepSeek: 'IKne3meq5aSn9XLyUdCD', // Charlie — deep, confident (the strategist)
  Qwen: '1Iztu4UHnTb9SUjJcpS1', // Anna — clear, melodic (the chameleon)
  Grok: 'FGY2WhTYpPnrIDTdsKH5', // Laura — quirky, enthusiast (the jokester)
  Llama: 'hpp4J3VqNfWAUOO0d1Us', // Bella — bright, warm (the open book)
  Mistral: 'IKne3meq5aSn9XLyUdCD', // Charlie — deep, blunt (the minimalist)
  Kimi: 'EXAVITQu4vr4xnSDxMaL', // Sarah — confident (the moonshot)
  GLM: 'CwhRBWXzGAHq8TQ4Fs17', // Roger — measured (the analyst)
  Gemma: 'JBFqnCBsd6RMkjVDRZzb', // George — warm storyteller
  You: '1Iztu4UHnTb9SUjJcpS1', // Anna — the human seat
};

export const DEFAULT_VOICE = 'EXAVITQu4vr4xnSDxMaL'; // Sarah

const POOL = [
  'JBFqnCBsd6RMkjVDRZzb',
  'CwhRBWXzGAHq8TQ4Fs17',
  'EXAVITQu4vr4xnSDxMaL',
  'IKne3meq5aSn9XLyUdCD',
  '1Iztu4UHnTb9SUjJcpS1',
  'FGY2WhTYpPnrIDTdsKH5',
  'hpp4J3VqNfWAUOO0d1Us',
];

// Stable voice for any name — mapped if known, else hashed into the pool so a
// custom name always gets the same (distinct-ish) voice.
export function voiceFor(name: string): string {
  if (VOICES[name]) return VOICES[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return POOL[h % POOL.length];
}
