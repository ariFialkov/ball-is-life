import type { LedgerEntry, OperatorConfig, RoundTicket } from '../core/casino/types.ts';
import { DEFAULT_OPERATOR } from '../core/casino/engine.ts';
import type { Position } from '../data/teams.ts';

export interface Settings {
  quarterLength: number;
  camera: '2k' | 'broadcast';
  sound: boolean;
  touch: 'auto' | 'on' | 'off';
  quality: 'auto' | 'low' | 'high';
}

export interface CareerSave {
  ticket: RoundTicket;
  playerName: string;
  pos: Position;
  teamId: string;
  gamesPlayed: number;
  /** Per game actual stat lines */
  log: { pts: number; ast: number; reb: number; grade: number; bonus: number; win: boolean; score: [number, number] }[];
  earned: number;
}

export interface PlayoffSave {
  ticket: RoundTicket;
  teamId: string;
  bracket: string[]; // 8 team ids seeded
  results: { round: number; home: string; away: string; winner: string; score: [number, number] }[];
  roundsWon: number;
  finished: boolean;
}

export interface SaveData {
  version: number;
  balance: number;
  settings: Settings;
  operator: OperatorConfig;
  nonce: number;
  ledger: LedgerEntry[];
  career: CareerSave | null;
  playoffs: PlayoffSave | null;
  totals: { wagered: number; returned: number; rounds: number };
  favTeam: string;
  clientSeed: string;
  playerName: string;
}

const KEY = 'ball-is-life:v1';

function defaults(): SaveData {
  return {
    version: 1,
    balance: 1000,
    settings: { quarterLength: 120, camera: '2k', sound: true, touch: 'auto', quality: 'auto' },
    operator: { ...DEFAULT_OPERATOR },
    nonce: 0,
    ledger: [],
    career: null,
    playoffs: null,
    totals: { wagered: 0, returned: 0, rounds: 0 },
    favTeam: 'cap',
    clientSeed: Math.random().toString(36).slice(2, 10),
    playerName: '',
  };
}

export class Store {
  data: SaveData;

  constructor() {
    this.data = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.data = { ...defaults(), ...parsed, settings: { ...defaults().settings, ...(parsed.settings ?? {}) }, operator: { ...DEFAULT_OPERATOR, ...(parsed.operator ?? {}) } };
      }
    } catch {
      /* ignore corrupt saves */
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage may be unavailable */
    }
  }

  reset() {
    this.data = defaults();
    this.save();
  }
}

export const store = new Store();
