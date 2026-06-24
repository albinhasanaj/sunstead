/**
 * Phase 1 — the brain, text only.
 * Runs a full Mafia game in the terminal: agents record private beliefs and take
 * actions, all printed live. When the agents lie to each other here, the project
 * is de-risked. Run:  pnpm play   (optionally:  pnpm play GPT Claude Grok Gemini Llama)
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { EventBus, terminalRenderer } from '../engine/events';
import { runGame } from '../engine/orchestrator';
import { mafiaGame } from '../games/mafia';

loadEnv({ path: '.env.local' }); // Next.js convention; AI_GATEWAY_API_KEY lives here

async function main() {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error(
      '\n⚠  AI_GATEWAY_API_KEY is not set. Add it to .env.local (Vercel dashboard → AI Gateway).\n',
    );
    process.exit(1);
  }

  const names = process.argv.slice(2);
  console.log(
    `\n🎭  Agentic Mafia — text-only run  (${names.length || 5} players, model: ${mafiaGame.model})`,
  );

  const bus = new EventBus();
  const winner = await runGame(mafiaGame, names, bus.emit, (state) => {
    // Bind the terminal renderer now that players (and their names) exist.
    bus.on(terminalRenderer(state));
    const roster = state.players.map((p) => `${p.name} [${p.role}]`).join(', ');
    console.log(`Secret roster (you wouldn't normally see this): ${roster}\n`);
  });

  console.log(`Final result: ${winner.toUpperCase()} wins.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
