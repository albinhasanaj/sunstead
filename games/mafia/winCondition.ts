import type { GameState } from '../../engine/types';
import { isMafia } from './roles';

// All Mafia dead → village. Mafia reach parity with town → mafia. Else game continues.
export function winner(state: GameState): string | null {
  const alive = state.players.filter((p) => p.alive);
  const mafia = alive.filter((p) => isMafia(p.role)).length;
  const town = alive.length - mafia;
  if (mafia === 0) return 'village';
  if (mafia >= town) return 'mafia';
  return null;
}
