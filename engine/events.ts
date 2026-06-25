import type { Emit, GameEvent, GameState, AgentState } from './types';

// A tiny synchronous event bus. The orchestrator pushes typed GameEvents through
// `emit`; sinks (terminal renderer, SSE stream) subscribe. Keeping this generic is
// what lets the same game run to a terminal in Phase 1 and to the browser later.
export class EventBus {
  private sinks: ((e: GameEvent) => void)[] = [];

  on(sink: (e: GameEvent) => void): void {
    this.sinks.push(sink);
  }

  get emit(): Emit {
    return (e: GameEvent) => {
      for (const sink of this.sinks) sink(e);
    };
  }
}

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

const nameOf = (state: GameState, id: PlayerIdLike) =>
  state.players.find((p) => p.id === id)?.name ?? id;
type PlayerIdLike = string;

// Pretty terminal renderer for Phase 1 — this is the "watch 4 agents lie" view.
export function terminalRenderer(state: GameState): (e: GameEvent) => void {
  return (e: GameEvent) => {
    switch (e.type) {
      case 'phase':
        console.log(
          '\n' + c.bold(c.cyan(`━━━ ${e.phase}  (round ${e.round}) ━━━━━━━━━━━━━━━━━━━━`)),
        );
        break;
      case 'thinking':
        if (e.on) console.log(c.dim(`  💭 ${nameOf(state, e.agent)} is thinking…`));
        break;
      case 'beliefs': {
        const sus = Object.entries(e.suspicions)
          .sort((a, b) => b[1] - a[1])
          .map(([id, v]) => `${nameOf(state, id)}:${bar(v)}`)
          .join('  ');
        console.log(c.dim(`  🧠 ${nameOf(state, e.agent)} thinks: ${e.reasoning}`));
        if (sus) console.log(c.dim(`     suspicion → ${sus}`));
        break;
      }
      case 'speak':
        console.log(`  ${c.bold(nameOf(state, e.agent))}: ${e.text}`);
        break;
      case 'whisper':
        console.log(c.magenta(`  🤫 [${e.channel}] ${nameOf(state, e.agent)}: ${e.text}`));
        break;
      case 'action':
        console.log(
          c.magenta(
            `  » ${nameOf(state, e.agent)} ${e.kind}${e.target ? ' → ' + nameOf(state, e.target) : ''}`,
          ),
        );
        break;
      case 'vote':
        console.log(c.yellow(`  🗳  ${nameOf(state, e.agent)} votes → ${nameOf(state, e.target)}`));
        break;
      case 'death':
        console.log(c.red(`  ☠  ${nameOf(state, e.target)} was killed in the night. (${e.role})`));
        break;
      case 'reveal':
        console.log(
          c.red(`  ☠  ${nameOf(state, e.target)} was eliminated by vote — they were ${c.bold(e.role)}.`),
        );
        break;
      case 'win':
        console.log('\n' + c.bold(c.green(`🏆 ${e.winner.toUpperCase()} WINS`)) + '\n');
        break;
    }
  };
}

function bar(v: number): string {
  const n = Math.round(Math.max(0, Math.min(1, v)) * 5);
  return '█'.repeat(n) + '░'.repeat(5 - n);
}
