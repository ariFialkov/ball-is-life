import type { LedgerEntry, OperatorConfig, RoundTicket } from '../core/casino/types.ts';
import { DEFAULT_OPERATOR } from '../core/casino/engine.ts';
import type { Position } from '../data/teams.ts';

export interface Settings {
  quarterLength: number;
  camera: '2k' | 'broadcast';
  sound: boolean;
  touch: 'auto' | 'on' | 'off';
  quality: 'auto' | 'low' | 'high';
  /** Quick Game: two people on the same team (desktop, at least one controller). */
  coop: boolean;
  /** Co-op with one controller: false = P1 on the controller and P2 on the keyboard; true = the other way round. */
  coopSwap: boolean;
}

export interface CareerGameLog {
  pts: number;
  ast: number;
  reb: number;
  stl: number;
  blk: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  to: number;
  /** Share of regulation on the floor. */
  min: number;
  grade: number;
  bonus: number;
  win: boolean;
  score: [number, number];
  opp: string;
  notes: string[];
  injured?: boolean;
}

export interface CareerEventLog {
  afterGame: number;
  title: string;
  text: string;
  /** Money this event adds (+) or forfeits (-), in bet multiples. */
  amount: number;
}

export interface CareerSave {
  ticket: RoundTicket;
  playerName: string;
  first: string;
  last: string;
  pos: Position;
  teamId: string;
  gamesPlayed: number;
  log: CareerGameLog[];
  /** Earned so far: incentives plus event money (bet multiples). */
  earned: number;
  /** Next game's share of the minutes (follows performance). */
  minutes: number;
  events: CareerEventLog[];
  midEventDone: boolean;
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
  playerFirst: string;
  playerLast: string;
}

const KEY = 'ball-is-life:v1';

function defaults(): SaveData {
  return {
    version: 1,
    balance: 1000,
    settings: { quarterLength: 120, camera: '2k', sound: true, touch: 'auto', quality: 'auto', coop: false, coopSwap: false },
    operator: { ...DEFAULT_OPERATOR },
    nonce: 0,
    ledger: [],
    career: null,
    playoffs: null,
    totals: { wagered: 0, returned: 0, rounds: 0 },
    favTeam: 'cap',
    clientSeed: Math.random().toString(36).slice(2, 10),
    playerName: '',
    playerFirst: '',
    playerLast: '',
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
