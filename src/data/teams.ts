import { Rng } from '../core/rng.ts';

export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export interface Ratings {
  ovr: number;
  three: number;
  mid: number;
  inside: number;
  dunk: number;
  speed: number;
  handle: number;
  pass: number;
  def: number;
  reb: number;
  steal: number;
  block: number;
}

export interface PlayerDef {
  id: string;
  name: string;
  first: string;
  last: string;
  number: number;
  pos: Position;
  /** height in metres */
  height: number;
  /** 0..4 skin tone index */
  skin: number;
  /** 0..3 hair style */
  hair: number;
  age: number;
  ratings: Ratings;
}

export interface Kit {
  /** Owning team id (drives logos and the themed jersey pattern). */
  teamId: string;
  jersey: string;
  trim: string;
  shorts: string;
  number: string;
}

export interface TeamDef {
  id: string;
  city: string;
  name: string;
  abbr: string;
  colors: { primary: string; secondary: string; accent: string };
  motif: LogoMotif;
  arena: { name: string; capacity: number; city: string };
  kits: { home: Kit; away: Kit };
  style: 'pace' | 'threes' | 'inside' | 'balanced' | 'defense';
  roster: PlayerDef[];
  ovr: number;
}

export type LogoMotif =
  | 'bolt'
  | 'wave'
  | 'scorpion'
  | 'snowflake'
  | 'crown'
  | 'gator'
  | 'anvil'
  | 'surf'
  | 'viper'
  | 'antlers'
  | 'flame'
  | 'anchor';

interface TeamSeed {
  id: string;
  city: string;
  name: string;
  abbr: string;
  primary: string;
  secondary: string;
  accent: string;
  motif: LogoMotif;
  arena: string;
  capacity: number;
  style: TeamDef['style'];
  ovr: number;
}

const TEAM_SEEDS: TeamSeed[] = [
  { id: 'ncv', city: 'Neon City', name: 'Voltage', abbr: 'NCV', primary: '#f4e04d', secondary: '#101010', accent: '#ffffff', motif: 'bolt', arena: 'Grid Dome', capacity: 19600, style: 'pace', ovr: 86 },
  { id: 'hpk', city: 'Harbor Point', name: 'Krakens', abbr: 'HPK', primary: '#0e7c7b', secondary: '#0b1d3a', accent: '#d9f1f1', motif: 'wave', arena: 'Tidewater Center', capacity: 18200, style: 'defense', ovr: 84 },
  { id: 'rms', city: 'Red Mesa', name: 'Scorpions', abbr: 'RMS', primary: '#b3131b', secondary: '#e8c89e', accent: '#1a0a0a', motif: 'scorpion', arena: 'Canyon Fieldhouse', capacity: 17400, style: 'inside', ovr: 82 },
  { id: 'ngf', city: 'Northgate', name: 'Frost', abbr: 'NGF', primary: '#7fd6ff', secondary: '#ffffff', accent: '#0f3b5c', motif: 'snowflake', arena: 'Glacier Arena', capacity: 18800, style: 'threes', ovr: 83 },
  { id: 'cap', city: 'Capital', name: 'Monarchs', abbr: 'CAP', primary: '#5b2a86', secondary: '#f2b134', accent: '#ffffff', motif: 'crown', arena: 'Crown Hall', capacity: 20100, style: 'balanced', ovr: 90 },
  { id: 'bay', city: 'Bayou', name: 'Gators', abbr: 'BAY', primary: '#1f6f3f', secondary: '#f2c14e', accent: '#ffffff', motif: 'gator', arena: 'Swamp Light Arena', capacity: 16900, style: 'inside', ovr: 79 },
  { id: 'stl', city: 'Steel City', name: 'Forge', abbr: 'STL', primary: '#1c1c1e', secondary: '#ff6a13', accent: '#c7c7cc', motif: 'anvil', arena: 'The Foundry', capacity: 19100, style: 'defense', ovr: 85 },
  { id: 'pac', city: 'Pacific', name: 'Surf', abbr: 'PAC', primary: '#19c3d6', secondary: '#ff6f91', accent: '#ffffff', motif: 'surf', arena: 'Shoreline Pavilion', capacity: 17600, style: 'pace', ovr: 81 },
  { id: 'mtv', city: 'Motor Town', name: 'Vipers', abbr: 'MTV', primary: '#9df22a', secondary: '#0d0d0d', accent: '#ffffff', motif: 'viper', arena: 'Octane Center', capacity: 18300, style: 'threes', ovr: 80 },
  { id: 'hls', city: 'Highland', name: 'Stags', abbr: 'HLS', primary: '#1f4d2b', secondary: '#f5efd6', accent: '#b08d4b', motif: 'antlers', arena: 'Summit Arena', capacity: 16400, style: 'balanced', ovr: 77 },
  { id: 'svp', city: 'Sun Valley', name: 'Phoenix', abbr: 'SVP', primary: '#ff7a00', secondary: '#c8102e', accent: '#ffd166', motif: 'flame', arena: 'Ember Dome', capacity: 19900, style: 'pace', ovr: 88 },
  { id: 'atl', city: 'Atlantic', name: 'Admirals', abbr: 'ATL', primary: '#0b2545', secondary: '#ffffff', accent: '#d62839', motif: 'anchor', arena: 'Harborfront Coliseum', capacity: 20400, style: 'balanced', ovr: 84 },
];

const FIRST = [
  'Marcus', 'Jalen', 'DeAndre', 'Tyrese', 'Kai', 'Luka', 'Nikola', 'Darius', 'Andre', 'Malik', 'Jaylen', 'Devin', 'Trey', 'Zion', 'Cade', 'Evan', 'Isaiah', 'Jordan', 'Chris', 'Anthony', 'Donovan', 'Bam', 'Kyrie', 'Jamal', 'Victor', 'Scoot', 'Paolo', 'Franz', 'Dejounte', 'Keegan', 'Tari', 'Bennedict', 'Jabari', 'Jaden', 'Ausar', 'Amen', 'Brandon', 'Cam', 'Desmond', 'Immanuel', 'Lonzo', 'Miles', 'Obi', 'Rui', 'Shai', 'Terance', 'Walker', 'Xavier', 'Yves', 'Zach',
];
const LAST = [
  'Carter', 'Brooks', 'Hayes', 'Rivers', 'Okafor', 'Banks', 'Mitchell', 'Reed', 'Dawson', 'Holloway', 'Pierce', 'Vance', 'Sutton', 'Graves', 'Lincoln', 'Monroe', 'Delgado', 'Fontaine', 'Abara', 'Kovac', 'Larsson', 'Mbeki', 'Nakamura', 'Ortega', 'Petrov', 'Quinn', 'Rashad', 'Silva', 'Tanaka', 'Umoh', 'Vega', 'Whitfield', 'Xu', 'Young', 'Zeller', 'Bridges', 'Cole', 'Dunn', 'Ellis', 'Foster', 'Grant', 'Hughes', 'Irving', 'Jones', 'King', 'Lowe', 'Morgan', 'Nash', 'Owens', 'Price',
];

const POS_TEMPLATE: Position[] = ['PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SG', 'SF', 'PF', 'C', 'SG', 'SF', 'PF'];

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function makeRatings(rng: Rng, pos: Position, targetOvr: number, style: TeamDef['style']): Ratings {
  const n = () => rng.gauss() * 5;
  const base = targetOvr;
  const r: Ratings = {
    ovr: 0,
    three: base + n(),
    mid: base + n(),
    inside: base + n(),
    dunk: base + n(),
    speed: base + n(),
    handle: base + n(),
    pass: base + n(),
    def: base + n(),
    reb: base + n(),
    steal: base + n(),
    block: base + n(),
  };
  // Position archetypes.
  if (pos === 'PG') {
    r.handle += 10; r.pass += 10; r.speed += 7; r.three += 4; r.inside -= 8; r.reb -= 12; r.block -= 15; r.dunk -= 8;
  } else if (pos === 'SG') {
    r.three += 8; r.mid += 6; r.speed += 4; r.reb -= 8; r.block -= 10;
  } else if (pos === 'SF') {
    r.dunk += 4; r.mid += 3; r.def += 3;
  } else if (pos === 'PF') {
    r.inside += 7; r.reb += 8; r.dunk += 6; r.block += 5; r.three -= 8; r.handle -= 10; r.speed -= 4;
  } else {
    r.inside += 12; r.reb += 14; r.block += 14; r.dunk += 8; r.three -= 18; r.handle -= 16; r.pass -= 6; r.speed -= 9; r.steal -= 6;
  }
  if (style === 'threes') { r.three += 5; }
  if (style === 'pace') { r.speed += 5; r.handle += 2; }
  if (style === 'inside') { r.inside += 5; r.dunk += 3; r.reb += 3; }
  if (style === 'defense') { r.def += 6; r.steal += 3; r.block += 3; }
  for (const k of Object.keys(r) as (keyof Ratings)[]) r[k] = Math.round(clamp(r[k], 35, 99));
  r.ovr = Math.round(
    clamp(
      (r.three + r.mid + r.inside + r.dunk + r.speed + r.handle + r.pass + r.def + r.reb + r.steal + r.block) / 11 + 2,
      40,
      99,
    ),
  );
  return r;
}

function buildTeam(seed: TeamSeed): TeamDef {
  const rng = new Rng(`team:${seed.id}`);
  const usedNumbers = new Set<number>();
  const roster: PlayerDef[] = POS_TEMPLATE.map((pos, i) => {
    // Starters are the first five; bench drops off.
    const tier = i < 5 ? 1 : i < 10 ? 0.86 : 0.78;
    const starBoost = i === 0 || i === 2 ? 4 : 0;
    const target = seed.ovr * tier + starBoost;
    let number = rng.int(0, 55);
    while (usedNumbers.has(number)) number = rng.int(0, 55);
    usedNumbers.add(number);
    const first = rng.pick(FIRST);
    const last = rng.pick(LAST);
    const heightBase = { PG: 1.88, SG: 1.95, SF: 2.0, PF: 2.06, C: 2.11 }[pos];
    return {
      id: `${seed.id}-${i}`,
      first,
      last,
      name: `${first} ${last}`,
      number,
      pos,
      height: Math.round((heightBase + rng.gauss() * 0.03) * 100) / 100,
      skin: rng.int(0, 4),
      hair: rng.int(0, 3),
      age: rng.int(20, 34),
      ratings: makeRatings(rng, pos, target, seed.style),
    };
  });
  const starters = roster.slice(0, 5);
  const ovr = Math.round(starters.reduce((a, p) => a + p.ratings.ovr, 0) / 5);
  const light = isLight(seed.primary);
  return {
    id: seed.id,
    city: seed.city,
    name: seed.name,
    abbr: seed.abbr,
    colors: { primary: seed.primary, secondary: seed.secondary, accent: seed.accent },
    motif: seed.motif,
    arena: { name: seed.arena, capacity: seed.capacity, city: seed.city },
    kits: {
      home: { teamId: seed.id, jersey: '#f7f7f7', trim: seed.primary, shorts: '#f7f7f7', number: seed.primary },
      away: { teamId: seed.id, jersey: seed.primary, trim: seed.secondary, shorts: seed.primary, number: light ? seed.secondary : '#ffffff' },
    },
    style: seed.style,
    roster,
    ovr,
  };
}

export function isLight(hex: string): boolean {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

export const TEAMS: TeamDef[] = TEAM_SEEDS.map(buildTeam);

export function teamById(id: string): TeamDef {
  const t = TEAMS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown team ${id}`);
  return t;
}

/** The rookie the player controls in career mode. */
export function makeCareerPlayer(name: string, pos: Position): PlayerDef {
  const rng = new Rng(`career:${name}`);
  const ratings = makeRatings(rng, pos, 74, 'balanced');
  const parts = name.trim().split(/\s+/);
  return {
    id: 'you',
    first: parts[0] ?? 'Rookie',
    last: parts.slice(1).join(' ') || 'Prospect',
    name,
    number: 1,
    pos,
    height: { PG: 1.9, SG: 1.96, SF: 2.01, PF: 2.06, C: 2.1 }[pos],
    skin: 2,
    hair: 1,
    age: 19,
    ratings,
  };
}
