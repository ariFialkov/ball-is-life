/**
 * Main-menu tile art: one family of five illustrations.
 * Every tile shares the same backdrop recipe (diagonal court-light slashes, halftone, the outlined "27",
 * a bottom vignette for the label) and the same subject treatment (glow, rim light, specular, ground shadow),
 * each in its own palette, so they read as a custom set made for the same game.
 */

interface Pal {
  id: string;
  hi: string;
  mid: string;
  deep: string;
  acc: string;
}

export const MENU_PAL = {
  quick: { id: 'mq', hi: '#ffd8b0', mid: '#ff2a3d', deep: '#3a0410', acc: '#ff7a1a' },
  career: { id: 'mc', hi: '#f1ccff', mid: '#8a2bff', deep: '#1b0436', acc: '#ff3dbb' },
  playoffs: { id: 'mp', hi: '#fff4c2', mid: '#ff9d00', deep: '#2e1800', acc: '#ffd23f' },
  allstar: { id: 'ma', hi: '#d8f8ff', mid: '#1446ff', deep: '#020c33', acc: '#00d9ff' },
  settings: { id: 'ms', hi: '#d6ffe8', mid: '#00a87a', deep: '#01201a', acc: '#3dff8f' },
} satisfies Record<string, Pal>;

export type MenuArtKey = keyof typeof MENU_PAL;

const FONT = 'Barlow Condensed, Impact, sans-serif';
const f = (n: number) => +n.toFixed(1);

/** The full-bleed backdrop shared by every tile. */
function backdrop(p: Pal): string {
  const i = p.id;
  return `<svg viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<defs>
<linearGradient id="${i}-bg" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.mid}"/><stop offset=".55" stop-color="${p.deep}"/><stop offset="1" stop-color="#05060c"/></linearGradient>
<radialGradient id="${i}-gl" cx=".7" cy=".36" r=".62"><stop offset="0" stop-color="${p.acc}" stop-opacity=".5"/><stop offset="1" stop-color="${p.acc}" stop-opacity="0"/></radialGradient>
<pattern id="${i}-dt" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="3.5" cy="3.5" r="1.25" fill="#fff"/></pattern>
<radialGradient id="${i}-dg" cx=".9" cy=".05" r=".8"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<mask id="${i}-dm"><rect width="300" height="200" fill="url(#${i}-dg)"/></mask>
<linearGradient id="${i}-vg" x1="0" y1="0" x2="0" y2="1"><stop offset=".4" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".78"/></linearGradient>
</defs>
<rect width="300" height="200" fill="url(#${i}-bg)"/>
<rect width="300" height="200" fill="url(#${i}-gl)"/>
<rect width="300" height="200" fill="url(#${i}-dt)" mask="url(#${i}-dm)" opacity=".2"/>
<polygon points="196,-10 230,-10 130,210 96,210" fill="${p.acc}" opacity=".16"/>
<polygon points="240,-10 251,-10 151,210 140,210" fill="#fff" opacity=".09"/>
<polygon points="270,-10 316,-10 216,210 170,210" fill="${p.mid}" opacity=".24"/>
<text x="310" y="176" text-anchor="end" font-family="${FONT}" font-weight="900" font-style="italic" font-size="200" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2">27</text>
<rect width="300" height="200" fill="url(#${i}-vg)"/>
<rect width="300" height="2.5" fill="${p.acc}" opacity=".9"/>
</svg>`;
}

/** Shared subject wrapper: glow behind, soft ground shadow under, common filters. */
function subject(p: Pal, cx: number, cy: number, groundY: number, defs: string, body: string): string {
  const i = p.id;
  return `<svg viewBox="0 0 200 200" aria-hidden="true">
<defs>
<radialGradient id="${i}-hl"><stop offset="0" stop-color="${p.acc}" stop-opacity=".55"/><stop offset=".55" stop-color="${p.mid}" stop-opacity=".18"/><stop offset="1" stop-color="${p.mid}" stop-opacity="0"/></radialGradient>
<filter id="${i}-b3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="${i}-b6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="${i}-gw" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
${defs}
</defs>
<circle cx="${cx}" cy="${cy}" r="92" fill="url(#${i}-hl)"/>
<ellipse cx="${cx}" cy="${groundY}" rx="58" ry="7" fill="#000" opacity=".5" filter="url(#${i}-b6)"/>
${body}
</svg>`;
}

/** 4-point sparkle. */
const sparkle = (x: number, y: number, s: number, fill = '#fff', op = 1) =>
  `<path d="M${x},${f(y - s)} Q${x},${y} ${f(x + s * 0.8)},${y} Q${x},${y} ${x},${f(y + s)} Q${x},${y} ${f(x - s * 0.8)},${y} Q${x},${y} ${x},${f(y - s)}Z" fill="${fill}" opacity="${op}"/>`;

/** QUICK GAME: a basketball ripping through the frame on speed trails. */
function quickArt(p: Pal): string {
  const i = p.id;
  const cx = 120, cy = 94, r = 58;
  const streaks = [
    [58, 4.5, 64],
    [74, 6.5, 86],
    [92, 3.5, 54],
    [108, 5.5, 78],
    [124, 3, 46],
  ]
    .map(([y, h, w]) => `<rect x="${f(cx - r * 0.55 - w)}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="url(#${i}-sk)"/>`)
    .join('');
  const defs = `
<radialGradient id="${i}-ball" cx=".34" cy=".28" r=".8"><stop offset="0" stop-color="#ffd2a2"/><stop offset=".22" stop-color="#ff8f2e"/><stop offset=".58" stop-color="#e2470f"/><stop offset=".86" stop-color="#7a1806"/><stop offset="1" stop-color="#360902"/></radialGradient>
<pattern id="${i}-pb" width="3.6" height="3.6" patternUnits="userSpaceOnUse"><circle cx="1.8" cy="1.8" r=".75" fill="#000" opacity=".28"/></pattern>
<clipPath id="${i}-cl"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
<linearGradient id="${i}-sk" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".35" stop-color="${p.acc}" stop-opacity=".8"/><stop offset="1" stop-color="${p.mid}" stop-opacity="0"/></linearGradient>`;
  const body = `
${streaks}
<circle cx="${cx - 34}" cy="${cy + 6}" r="${r - 2}" fill="${p.acc}" opacity=".1"/>
<circle cx="${cx - 34}" cy="${cy + 6}" r="${r - 2}" fill="none" stroke="${p.acc}" stroke-width="2.5" opacity=".3"/>
<circle cx="${cx - 17}" cy="${cy + 3}" r="${r - 1}" fill="none" stroke="${p.hi}" stroke-width="2" opacity=".35"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${i}-ball)"/>
<g clip-path="url(#${i}-cl)">
<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" fill="url(#${i}-pb)"/>
<g transform="rotate(-24 ${cx} ${cy})" fill="none" stroke="#260803" stroke-width="3.6" stroke-linecap="round">
<path d="M${cx - r - 2},${cy} Q${cx},${cy + 24} ${cx + r + 2},${cy}"/>
<path d="M${cx},${cy - r - 2} Q${cx - 18},${cy} ${cx},${cy + r + 2}"/>
<path d="M${cx - 44},${cy - 44} Q${cx - 14},${cy} ${cx - 44},${cy + 44}"/>
<path d="M${cx + 44},${cy - 44} Q${cx + 14},${cy} ${cx + 44},${cy + 44}"/>
</g>
</g>
<path d="M150,44.5 A${r} ${r} 0 0 1 176,110" fill="none" stroke="${p.hi}" stroke-width="3" stroke-linecap="round" opacity=".85"/>
<ellipse cx="98" cy="66" rx="18" ry="9" transform="rotate(-32 98 66)" fill="#fff" opacity=".5" filter="url(#${i}-b3)"/>
${sparkle(176, 40, 9)}${sparkle(160, 160, 5, p.hi, 0.8)}`;
  return subject(p, cx, cy, 168, defs, body);
}

/** MY CAREER: a hero-lit tank-top jersey with your number. */
function careerArt(p: Pal, num: string): string {
  const i = p.id;
  const shape = 'M66,30 L84,30 C88,56 112,56 116,30 L134,30 C136,56 146,66 162,70 L166,182 Q100,194 34,182 L38,70 C54,66 64,56 66,30 Z';
  const defs = `
<linearGradient id="${i}-jr" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22054f"/><stop offset=".2" stop-color="#6a1bd8"/><stop offset=".46" stop-color="#b25cff"/><stop offset=".62" stop-color="#8a2bff"/><stop offset="1" stop-color="#1c0442"/></linearGradient>
<linearGradient id="${i}-jv" x1="0" y1="0" x2="0" y2="1"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>
<linearGradient id="${i}-sp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<pattern id="${i}-ms" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".6" fill="#fff" opacity=".12"/></pattern>
<clipPath id="${i}-cl"><path d="${shape}"/></clipPath>`;
  const trim = (d: string) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round"/>`;
  const body = `
<polygon points="78,-20 122,-20 196,200 4,200" fill="url(#${i}-sp)"/>
<path d="${shape}" fill="url(#${i}-jr)"/>
<g clip-path="url(#${i}-cl)">
<rect width="200" height="200" fill="url(#${i}-ms)"/>
<path d="M150,67 C156,69 160,70 162,70 L166,182 L155,186 Z" fill="${p.acc}"/>
<path d="M50,67 C44,69 40,70 38,70 L34,182 L45,186 Z" fill="${p.acc}"/>
<path d="M70,96 Q78,140 66,190" fill="none" stroke="#000" stroke-width="7" opacity=".18" filter="url(#${i}-b3)"/>
<path d="M134,100 Q124,144 136,190" fill="none" stroke="#000" stroke-width="6" opacity=".16" filter="url(#${i}-b3)"/>
<path d="M30,170 Q100,184 170,170" fill="none" stroke="${p.acc}" stroke-width="5"/>
<path d="M30,163.5 Q100,177.5 170,163.5" fill="none" stroke="#fff" stroke-width="1.6" opacity=".85"/>
<rect width="200" height="200" fill="url(#${i}-jv)"/>
</g>
${trim('M84,30 C88,56 112,56 116,30')}${trim('M134,30 C136,56 146,66 162,70')}${trim('M66,30 C64,56 54,66 38,70')}
<path d="${shape}" fill="none" stroke="${p.hi}" stroke-width="1.4" opacity=".55"/>
<text x="100" y="80" text-anchor="middle" font-family="${FONT}" font-weight="900" font-style="italic" font-size="13" letter-spacing="1" fill="#fff">BALL IS LIFE</text>
<text x="100" y="150" text-anchor="middle" font-family="${FONT}" font-weight="900" font-style="italic" font-size="${num.length > 1 ? 66 : 74}" fill="#fff" stroke="${p.acc}" stroke-width="3.2" paint-order="stroke" stroke-linejoin="round">${num}</text>
<ellipse cx="80" cy="64" rx="16" ry="6" transform="rotate(-20 80 64)" fill="#fff" opacity=".22" filter="url(#${i}-b3)"/>
${sparkle(170, 46, 8)}${sparkle(28, 120, 5, p.hi, 0.8)}`;
  return subject(p, 100, 100, 188, defs, body);
}

/** PLAYOFFS: a polished championship trophy in a burst of light and confetti. */
function playoffsArt(p: Pal): string {
  const i = p.id;
  const rays = Array.from({ length: 14 }, (_, k) => {
    const a = (k / 14) * Math.PI * 2;
    const a1 = a - 0.07, a2 = a + 0.07;
    return `<polygon points="100,74 ${f(100 + Math.cos(a1) * 130)},${f(74 + Math.sin(a1) * 130)} ${f(100 + Math.cos(a2) * 130)},${f(74 + Math.sin(a2) * 130)}"/>`;
  }).join('');
  const lattice = Array.from({ length: 9 }, (_, k) => {
    const x = 50 + k * 12;
    return `<path d="M${x},70 L${x + 26},124 M${x + 26},70 L${x},124"/>`;
  }).join('');
  const conf: [number, number, number, string][] = [
    [30, 34, 20, p.acc], [44, 96, -30, '#fff'], [160, 30, 40, p.hi], [172, 92, -15, p.acc], [150, 132, 60, '#fff'],
    [52, 140, 10, p.mid], [24, 70, 70, p.mid], [182, 60, -50, '#fff'], [136, 18, 15, p.mid], [64, 16, -40, p.hi],
  ];
  const confetti = conf.map(([x, y, rot, c]) => `<rect x="${x - 3}" y="${y - 1.6}" width="6" height="3.2" rx=".6" fill="${c}" transform="rotate(${rot} ${x} ${y})"/>`).join('');
  const defs = `
<linearGradient id="${i}-mt" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5e3500"/><stop offset=".2" stop-color="#c98a0c"/><stop offset=".38" stop-color="#ffe27a"/><stop offset=".46" stop-color="#fffbe6"/><stop offset=".56" stop-color="#ffd23f"/><stop offset=".8" stop-color="#b8780a"/><stop offset="1" stop-color="#4f2c00"/></linearGradient>
<radialGradient id="${i}-bl" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#fffbe0"/><stop offset=".3" stop-color="#ffd23f"/><stop offset=".75" stop-color="#b8780a"/><stop offset="1" stop-color="#4f2c00"/></radialGradient>
<linearGradient id="${i}-pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1a00"/><stop offset="1" stop-color="#0b0600"/></linearGradient>
<clipPath id="${i}-cc"><path d="M63,70 L137,70 L114,124 L86,124 Z"/></clipPath>
<clipPath id="${i}-bc"><circle cx="100" cy="47" r="23"/></clipPath>`;
  const body = `
<g fill="${p.acc}" opacity=".13">${rays}</g>
${confetti}
<ellipse cx="100" cy="70" rx="37" ry="6.5" fill="#6b3f00"/>
<circle cx="100" cy="47" r="23" fill="url(#${i}-bl)"/>
<g clip-path="url(#${i}-bc)" fill="none" stroke="#5e3500" stroke-width="1.8" opacity=".75"><path d="M77,47 Q100,57 123,47"/><path d="M100,24 Q92,47 100,70"/><path d="M84,30 Q96,47 84,64"/><path d="M116,30 Q104,47 116,64"/></g>
<path d="M63,70 L137,70 L114,124 L86,124 Z" fill="url(#${i}-mt)"/>
<g clip-path="url(#${i}-cc)" fill="none" stroke="#5e3500" stroke-width="1.3" opacity=".45">${lattice}</g>
<path d="M63,70 A37,6.5 0 0 0 137,70" fill="none" stroke="url(#${i}-mt)" stroke-width="5"/>
<path d="M63,70 A37,6.5 0 0 0 137,70" fill="none" stroke="#fffbe6" stroke-width="1" opacity=".7"/>
<rect x="92" y="122" width="16" height="17" fill="url(#${i}-mt)"/>
<ellipse cx="100" cy="124" rx="12" ry="3" fill="url(#${i}-mt)"/>
<path d="M80,138 L120,138 L129,153 L71,153 Z" fill="url(#${i}-mt)"/>
<rect x="58" y="152" width="84" height="28" rx="2" fill="url(#${i}-pl)"/>
<rect x="58" y="152" width="84" height="3.4" fill="url(#${i}-mt)"/>
<rect x="58" y="176.6" width="84" height="3.4" fill="url(#${i}-mt)"/>
<text x="100" y="171" text-anchor="middle" font-family="${FONT}" font-weight="900" font-style="italic" font-size="12" letter-spacing="2" fill="${p.acc}">CHAMPIONS</text>
<rect x="96" y="72" width="5" height="50" fill="#fff" opacity=".35" filter="url(#${i}-b3)"/>
<ellipse cx="91" cy="38" rx="8" ry="4.5" transform="rotate(-30 91 38)" fill="#fff" opacity=".6" filter="url(#${i}-b3)"/>
${sparkle(128, 30, 10)}${sparkle(68, 100, 6, '#fff', 0.85)}${sparkle(146, 112, 5, p.hi, 0.9)}`;
  return subject(p, 100, 82, 186, defs, body);
}

/** ALL-STAR: a faceted chrome star inside an orbit ring. */
function allStarArt(p: Pal): string {
  const i = p.id;
  const cx = 100, cy = 98, R = 76, r = 32;
  const pt = (k: number) => {
    const a = ((-90 + k * 36) * Math.PI) / 180;
    const rad = k % 2 === 0 ? R : r;
    return [f(cx + Math.cos(a) * rad), f(cy + Math.sin(a) * rad)];
  };
  let facets = '';
  for (let k = 0; k < 10; k += 2) {
    const o = pt(k), a = pt(k + 9), b = pt(k + 1);
    facets += `<polygon points="${cx},${cy} ${a[0]},${a[1]} ${o[0]},${o[1]}" fill="url(#${i}-lf)"/>`;
    facets += `<polygon points="${cx},${cy} ${o[0]},${o[1]} ${b[0]},${b[1]}" fill="url(#${i}-df)"/>`;
  }
  const outline = Array.from({ length: 10 }, (_, k) => pt(k).join(',')).join(' ');
  const ring = (half: 'back' | 'front') =>
    `<path d="M${cx - 96},${cy} A96 26 0 0 ${half === 'back' ? 1 : 0} ${cx + 96},${cy}" fill="none" stroke="url(#${i}-rg)" stroke-width="${half === 'back' ? 2.5 : 4}" opacity="${half === 'back' ? 0.55 : 1}" transform="rotate(-16 ${cx} ${cy})"/>`;
  const defs = `
<linearGradient id="${i}-lf" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="${p.hi}"/><stop offset="1" stop-color="${p.acc}"/></linearGradient>
<linearGradient id="${i}-df" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3fb8ff"/><stop offset=".6" stop-color="${p.mid}"/><stop offset="1" stop-color="#061a6e"/></linearGradient>
<linearGradient id="${i}-rg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.acc}" stop-opacity="0"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="${p.acc}" stop-opacity=".2"/></linearGradient>`;
  const body = `
${ring('back')}
<polygon points="${outline}" fill="${p.acc}" opacity=".5" filter="url(#${i}-b6)"/>
${facets}
<polygon points="${outline}" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" opacity=".9"/>
${ring('front')}
<circle cx="${cx}" cy="${cy}" r="3.2" fill="#fff" filter="url(#${i}-gw)"/>
${sparkle(160, 30, 11)}${sparkle(34, 56, 7, p.hi)}${sparkle(170, 150, 6, '#fff', 0.85)}${sparkle(42, 160, 4, p.acc)}`;
  return subject(p, cx, cy, 182, defs, body);
}

/** SETTINGS: a sleek controller over tuning sliders. */
function settingsArt(p: Pal): string {
  const i = p.id;
  const shape = 'M56,76 C64,64 82,62 94,66 L106,66 C118,62 136,64 144,76 C158,96 172,134 166,152 C160,168 142,168 134,154 L122,134 L78,134 L66,154 C58,168 40,168 34,152 C28,134 42,96 56,76 Z';
  const slider = (y: number, knob: number, c: string) =>
    `<line x1="36" y1="${y}" x2="164" y2="${y}" stroke="#fff" stroke-opacity=".18" stroke-width="3" stroke-linecap="round"/><line x1="36" y1="${y}" x2="${knob}" y2="${y}" stroke="${c}" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"/><circle cx="${knob}" cy="${y}" r="5" fill="${c}" stroke="${p.deep}" stroke-width="2"/>`;
  const stick = (x: number, y: number) =>
    `<circle cx="${x}" cy="${y}" r="10" fill="#07100d" stroke="#fff" stroke-opacity=".18" stroke-width="1.4"/><circle cx="${x}" cy="${y}" r="7" fill="url(#${i}-st)"/><circle cx="${x}" cy="${y}" r="1.8" fill="${p.acc}"/>`;
  const btn = (x: number, y: number, c: string) => `<circle cx="${x}" cy="${y}" r="4.6" fill="${c}"/><circle cx="${x - 1.3}" cy="${y - 1.5}" r="1.5" fill="#fff" opacity=".6"/>`;
  const defs = `
<linearGradient id="${i}-bd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f4740"/><stop offset=".45" stop-color="#0f1b17"/><stop offset="1" stop-color="#050a08"/></linearGradient>
<radialGradient id="${i}-st" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#5a7a70"/><stop offset="1" stop-color="#0d1714"/></radialGradient>`;
  const body = `
<g>${slider(26, 122, p.acc)}${slider(40, 72, p.hi)}${slider(54, 104, '#fff')}</g>
<g transform="rotate(-10 100 115)">
<path d="${shape}" fill="${p.acc}" opacity=".35" filter="url(#${i}-b6)"/>
<path d="${shape}" fill="url(#${i}-bd)"/>
<path d="${shape}" fill="none" stroke="${p.acc}" stroke-width="1.8" opacity=".9"/>
<path d="M60,76 C70,68 84,67 94,70 L106,70 C116,67 130,68 140,76" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".35"/>
<rect x="84" y="74" width="32" height="20" rx="4" fill="#0b1512" stroke="#fff" stroke-opacity=".15"/>
<rect x="88" y="98" width="24" height="3" rx="1.5" fill="${p.acc}" filter="url(#${i}-gw)"/>
<rect x="62" y="86" width="8" height="22" rx="2" fill="#1c2b27" stroke="#fff" stroke-opacity=".22"/>
<rect x="55" y="93" width="22" height="8" rx="2" fill="#1c2b27" stroke="#fff" stroke-opacity=".22"/>
${btn(136, 87, p.acc)}${btn(145, 96, '#fff')}${btn(136, 105, p.mid)}${btn(127, 96, p.hi)}
${stick(84, 116)}${stick(116, 116)}
<ellipse cx="74" cy="80" rx="12" ry="4" transform="rotate(-18 74 80)" fill="#fff" opacity=".18" filter="url(#${i}-b3)"/>
</g>
${sparkle(170, 76, 8)}${sparkle(30, 136, 5, p.hi, 0.85)}`;
  return subject(p, 100, 112, 178, defs, body);
}

/** Backdrop and subject markup for a main-menu tile. */
export function menuArt(key: MenuArtKey, opts: { number?: string } = {}): { bg: string; art: string; acc: string } {
  const p = MENU_PAL[key];
  const art =
    key === 'quick' ? quickArt(p) : key === 'career' ? careerArt(p, opts.number ?? '27') : key === 'playoffs' ? playoffsArt(p) : key === 'allstar' ? allStarArt(p) : settingsArt(p);
  return { bg: backdrop(p), art, acc: p.acc };
}
