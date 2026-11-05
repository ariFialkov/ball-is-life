import type { Kit, LogoMotif, PlayerDef, TeamDef } from '../data/teams.ts';
import { drawMotif, teamLogoCanvas } from '../data/logos.ts';
import { leagueLogoCanvas } from '../data/league.ts';
import { JERSEY_BOT, JERSEY_TOP, SHORTS, TORSO_N, arcTable, jerseyEdgeDistance, jerseyProfile, ringXZ, thetaForU } from './bodyShape.ts';

/**
 * Kit painters. The jersey canvas wraps the jersey shell: u runs around the
 * body (0 = left side, 0.25 = front centre, 0.5 = right side, 0.75 = back
 * centre) and v runs from the hem (JERSEY_BOT) up to the neck (JERSEY_TOP).
 * Placement is done in body units (fractions of player height) and converted
 * to pixels per row so logos and numbers keep their proportions.
 */

const FONT = '"Barlow Condensed", "Arial Narrow", Impact, sans-serif';
const SPAN = JERSEY_TOP - JERSEY_BOT;

// ------------------------------------------------------------------ colour
function rgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  const f = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}
function hex(r: number, g: number, b: number) {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}
function lum(c: string): number {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function bestContrast(against: string[], options: string[]): string {
  let best = options[0];
  let score = -1;
  for (const o of options) {
    const s = Math.min(...against.map((a) => contrast(a, o)));
    if (s > score) {
      score = s;
      best = o;
    }
  }
  return best;
}
/** A colour a notch away from the base: sublimated, "printed into the fabric". */
function tone(base: string, amt = 0.12): string {
  return lum(base) > 0.35 ? mix(base, '#000000', amt) : mix(base, '#ffffff', amt * 0.8);
}

// ------------------------------------------------------------------ fonts
let fontsReady = false;
/** Resolves when the kit web font is available (null if it already is). */
export function kitFontPromise(): Promise<void> | null {
  if (fontsReady || typeof document === 'undefined' || !document.fonts) return null;
  if (document.fonts.check(`900 40px ${FONT}`) && document.fonts.check(`italic 900 40px ${FONT}`)) {
    fontsReady = true;
    return null;
  }
  return Promise.all([document.fonts.load(`900 40px ${FONT}`), document.fonts.load(`italic 900 40px ${FONT}`)]).then(() => {
    fontsReady = true;
  });
}

// ------------------------------------------------------------------ patterns
/**
 * Team-themed sublimated pattern. Drawn in a single tone so it reads as
 * texture in the fabric rather than as a graphic competing with the numbers.
 * `k` is pixels per body unit.
 */
function drawPattern(ctx: CanvasRenderingContext2D, motif: LogoMotif, x0: number, y0: number, w: number, hgt: number, k: number, ink: string, accent: string) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, hgt);
  ctx.clip();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const x1 = x0 + w;
  const y1 = y0 + hgt;
  switch (motif) {
    case 'bolt': {
      // Diagonal lightning zig-zags.
      ctx.lineWidth = 0.004 * k;
      const step = 0.055 * k;
      const amp = 0.012 * k;
      for (let y = y0 - hgt; y < y1 + step; y += step) {
        ctx.beginPath();
        let up = true;
        for (let x = x0; x <= x1 + step; x += 0.02 * k) {
          const yy = y + (x - x0) * 0.35 + (up ? -amp : amp);
          if (x === x0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
          up = !up;
        }
        ctx.stroke();
      }
      break;
    }
    case 'wave': {
      ctx.lineWidth = 0.003 * k;
      const step = 0.03 * k;
      for (let y = y0; y < y1 + step; y += step) {
        ctx.beginPath();
        for (let x = x0; x <= x1; x += 4) {
          const yy = y + Math.sin((x / k) * 70 + y * 0.01) * 0.006 * k;
          if (x === x0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      break;
    }
    case 'scorpion':
    case 'viper': {
      // Diamond lattice (desert argyle / snake scales).
      const step = (motif === 'viper' ? 0.028 : 0.05) * k;
      ctx.lineWidth = (motif === 'viper' ? 0.0022 : 0.003) * k;
      ctx.beginPath();
      for (let x = x0 - hgt; x < x1 + hgt; x += step) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x + hgt * 0.8, y1);
        ctx.moveTo(x, y0);
        ctx.lineTo(x - hgt * 0.8, y1);
      }
      ctx.stroke();
      if (motif === 'viper') {
        ctx.globalAlpha = 0.5;
        for (let y = y0; y < y1; y += step * 1.25) {
          for (let x = x0 + ((y / step) % 2) * step * 0.5; x < x1; x += step) {
            ctx.beginPath();
            ctx.arc(x, y, step * 0.12, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      break;
    }
    case 'snowflake': {
      ctx.lineWidth = 0.0022 * k;
      const step = 0.06 * k;
      const r = 0.01 * k;
      let row = 0;
      for (let y = y0; y < y1 + step; y += step * 0.87, row++) {
        for (let x = x0 + (row % 2) * step * 0.5; x < x1 + step; x += step) {
          ctx.beginPath();
          for (let a = 0; a < 6; a++) {
            const ang = (a * Math.PI) / 3;
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
          }
          ctx.stroke();
        }
      }
      break;
    }
    case 'crown': {
      // Royal pinstripes with a fine double line.
      const step = 0.026 * k;
      ctx.lineWidth = 0.0016 * k;
      ctx.beginPath();
      for (let x = x0; x < x1; x += step) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.moveTo(x + 0.003 * k, y0);
        ctx.lineTo(x + 0.003 * k, y1);
      }
      ctx.stroke();
      break;
    }
    case 'gator': {
      // Overlapping scales.
      const r = 0.018 * k;
      ctx.lineWidth = 0.0025 * k;
      let row = 0;
      for (let y = y0; y < y1 + r; y += r * 0.9, row++) {
        for (let x = x0 + (row % 2) * r; x < x1 + r; x += r * 2) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI);
          ctx.stroke();
        }
      }
      break;
    }
    case 'anvil': {
      // Diamond-plate tread.
      const step = 0.024 * k;
      const l = 0.008 * k;
      ctx.lineWidth = 0.003 * k;
      let row = 0;
      for (let y = y0; y < y1 + step; y += step * 0.5, row++) {
        for (let x = x0 + (row % 2) * step * 0.5; x < x1 + step; x += step) {
          const d = row % 2 ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(x - l * 0.5, y - l * 0.5 * d);
          ctx.lineTo(x + l * 0.5, y + l * 0.5 * d);
          ctx.stroke();
        }
      }
      break;
    }
    case 'surf': {
      // Retro sunset bands thickening towards the hem.
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const y = y0 + hgt * (0.45 + 0.55 * t);
        ctx.fillRect(x0, y, w, (0.002 + 0.007 * t) * k);
      }
      break;
    }
    case 'antlers': {
      // Highland tartan.
      ctx.globalAlpha = 0.55;
      const step = 0.07 * k;
      for (let x = x0; x < x1; x += step) {
        ctx.fillRect(x, y0, 0.02 * k, hgt);
        ctx.fillRect(x + 0.03 * k, y0, 0.004 * k, hgt);
      }
      for (let y = y0; y < y1; y += step) {
        ctx.fillRect(x0, y, w, 0.02 * k);
        ctx.fillRect(x0, y + 0.03 * k, w, 0.004 * k);
      }
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 0.0012 * k;
      ctx.beginPath();
      for (let x = x0 + 0.045 * k; x < x1; x += step) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      ctx.stroke();
      break;
    }
    case 'flame': {
      // Flames licking up from the hem.
      const step = 0.04 * k;
      for (let x = x0 - step; x < x1 + step; x += step) {
        const tall = (0.07 + 0.05 * Math.abs(Math.sin(x * 0.37))) * k;
        ctx.beginPath();
        ctx.moveTo(x - step * 0.6, y1);
        ctx.bezierCurveTo(x - step * 0.6, y1 - tall * 0.5, x + step * 0.2, y1 - tall * 0.6, x, y1 - tall);
        ctx.bezierCurveTo(x + step * 0.5, y1 - tall * 0.55, x + step * 0.6, y1 - tall * 0.3, x + step * 0.6, y1);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'anchor': {
      // Nautical breton stripes with a rope chevron line.
      const step = 0.035 * k;
      for (let y = y0 + hgt * 0.35; y < y1; y += step) ctx.fillRect(x0, y, w, 0.007 * k);
      ctx.lineWidth = 0.002 * k;
      ctx.beginPath();
      for (let x = x0; x < x1; x += 0.012 * k) {
        ctx.moveTo(x, y0 + hgt * 0.3);
        ctx.lineTo(x + 0.006 * k, y0 + hgt * 0.3 - 0.006 * k);
      }
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ text
interface TextStyle {
  fill: string;
  outline: string;
  shadow: string;
  italic: boolean;
}

/** Draw text whose cap height is `capPx`, squeezed horizontally by `ax`, optionally arched. */
function drawText(ctx: CanvasRenderingContext2D, text: string, cx: number, baseline: number, capPx: number, ax: number, maxW: number, st: TextStyle, arch = 0, outlineK = 0.14) {
  const size = capPx / 0.7;
  ctx.save();
  ctx.font = `${st.italic ? 'italic ' : ''}900 ${size}px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const spacing = size * 0.04;
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  const squeeze = Math.min(1, maxW / (total * ax));
  ctx.translate(cx, baseline);
  ctx.scale(ax * squeeze, 1);
  const layers: [string, number, string][] = [
    ['shadow', 0, st.shadow],
    ['outline', capPx * outlineK, st.outline],
    ['fill', 0, st.fill],
  ];
  for (const [kind, lw, color] of layers) {
    let x = -total / 2;
    for (const [i, ch] of [...text].entries()) {
      const mid = x + widths[i] / 2;
      const t = total > 0 ? mid / (total / 2) : 0;
      const dy = -arch * (1 - t * t);
      ctx.save();
      ctx.translate(mid, dy);
      ctx.rotate(arch !== 0 && total > 0 ? (4 * arch * t) / total : 0);
      if (kind === 'shadow') {
        ctx.fillStyle = color;
        ctx.fillText(ch, -widths[i] / 2 + capPx * 0.05, capPx * 0.05);
      } else if (kind === 'outline') {
        ctx.lineJoin = 'round';
        ctx.lineWidth = lw;
        ctx.strokeStyle = color;
        ctx.strokeText(ch, -widths[i] / 2, 0);
      } else {
        ctx.fillStyle = color;
        ctx.fillText(ch, -widths[i] / 2, 0);
      }
      ctx.restore();
      x += widths[i] + spacing;
    }
  }
  ctx.restore();
}

function drawImageAt(ctx: CanvasRenderingContext2D, img: CanvasImageSource, cx: number, cy: number, wPx: number, hPx: number, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, cx - wPx / 2, cy - hPx / 2, wPx, hPx);
  ctx.restore();
}

/** Fine perforated-mesh texture. */
function drawMesh(ctx: CanvasRenderingContext2D, w: number, hgt: number, k: number, dark: boolean) {
  ctx.save();
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
  const step = Math.max(3, 0.0045 * k);
  const d = Math.max(1, step * 0.3);
  let row = 0;
  for (let y = 0; y < hgt; y += step, row++) {
    for (let x = (row % 2) * step * 0.5; x < w; x += step) ctx.fillRect(x, y, d, d);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ jersey
interface MaskSet {
  cut: HTMLCanvasElement;
  piping: HTMLCanvasElement;
}
const maskCache = new Map<string, MaskSet>();

/** Neckline / armhole cut-outs and the piping band along them, in jersey UV space. */
function jerseyMasks(bulk: number, W: number, H: number): MaskSet {
  const MW = Math.round(W / 3);
  const MH = Math.round(H / 3);
  const key = `${bulk}:${MW}x${MH}`;
  const hit = maskCache.get(key);
  if (hit) return hit;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = MW;
    c.height = MH;
    return c;
  };
  const cut = mk();
  const piping = mk();
  const cctx = cut.getContext('2d')!;
  const pctx = piping.getContext('2d')!;
  const ci = cctx.createImageData(MW, MH);
  const pi = pctx.createImageData(MW, MH);
  const PIPE = 0.0055;
  const SOFT = 0.0012;
  for (let py = 0; py < MH; py++) {
    const y = JERSEY_TOP - ((py + 0.5) / MH) * SPAN;
    const ring = jerseyProfile(y, bulk);
    const tab = arcTable(ring, TORSO_N, 128);
    for (let px = 0; px < MW; px++) {
      const [x, z] = ringXZ(thetaForU((px + 0.5) / MW, tab), ring, TORSO_N);
      const d = jerseyEdgeDistance(x, y, z, ring.rz, bulk);
      const o = (py * MW + px) * 4;
      const a = Math.min(1, Math.max(0, d / SOFT + 0.5));
      ci.data[o + 3] = Math.round(a * 255);
      const p = Math.min(1, Math.max(0, (PIPE - d) / SOFT + 0.5)) * a;
      pi.data[o + 3] = Math.round(p * 255);
    }
  }
  cctx.putImageData(ci, 0, 0);
  pctx.putImageData(pi, 0, 0);
  const set = { cut, piping };
  maskCache.set(key, set);
  return set;
}

function perimeterAt(y: number, bulk: number) {
  return arcTable(jerseyProfile(y, bulk), TORSO_N, 96).P;
}

export function paintJersey(team: TeamDef, kit: Kit, def: PlayerDef, bulk: number, W: number, H: number, target?: HTMLCanvasElement): HTMLCanvasElement {
  const c = target ?? document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const kY = H / SPAN;
  const kX = (y: number) => W / perimeterAt(y, bulk);
  const py = (y: number) => (JERSEY_TOP - y) * kY;
  const ax = (y: number) => kX(y) / kY;
  const front = (x: number, y: number) => 0.25 * W + x * kX(y);
  const back = (x: number, y: number) => 0.75 * W - x * kX(y);
  const base = kit.jersey;
  const dark = lum(base) < 0.35;
  const { primary, secondary, accent } = team.colors;

  // Base + themed sublimation.
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  drawPattern(ctx, team.motif, 0, 0, W, H, kY, tone(base, 0.1), tone(base, 0.22));
  // Soft shading towards the hem gives the fabric some depth.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.6, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Tonal crest watermark behind the front number.
  {
    const y = 0.672;
    const size = (0.19 / 0.6) * kY;
    ctx.save();
    ctx.translate(front(0, y), py(y));
    ctx.scale(ax(y), 1);
    ctx.globalAlpha = 0.85;
    const ink = tone(base, 0.16);
    drawMotif(ctx, size, team.motif, ink, ink);
    ctx.lineWidth = 0.004 * kY;
    ctx.strokeStyle = ink;
    ctx.beginPath();
    ctx.arc(0, 0, 0.11 * kY, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Side panels under the arms: trim colour with accent piping and a hint of the motif.
  {
    const y = 0.66;
    const pw = 0.034 * kX(y);
    const top = py(0.765);
    const panelInk = kit.trim;
    const edge = bestContrast([panelInk, base], [accent, secondary, primary, '#ffffff', '#111111']);
    for (const cx of [0, W / 2, W]) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - pw * 0.5, H);
      ctx.lineTo(cx - pw * 0.42, top);
      ctx.lineTo(cx + pw * 0.42, top);
      ctx.lineTo(cx + pw * 0.5, H);
      ctx.closePath();
      ctx.fillStyle = panelInk;
      ctx.fill();
      ctx.clip();
      drawPattern(ctx, team.motif, cx - pw, top, pw * 2, H - top, kY, tone(panelInk, 0.18), tone(panelInk, 0.3));
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 0.0022 * kY;
      ctx.beginPath();
      ctx.moveTo(cx - pw * 0.5, H);
      ctx.lineTo(cx - pw * 0.42, top);
      ctx.moveTo(cx + pw * 0.5, H);
      ctx.lineTo(cx + pw * 0.42, top);
      ctx.stroke();
      ctx.restore();
    }
  }

  const fill = kit.number;
  const outline = contrast(kit.trim, fill) > 1.6 && contrast(kit.trim, base) > 1.3 ? kit.trim : bestContrast([fill, base], [secondary, accent, primary, '#111111', '#ffffff']);
  const st: TextStyle = { fill, outline, shadow: tone(base, 0.35), italic: team.style === 'pace' };

  // Front: arched wordmark, number, jock-tag crest and the small league mark.
  {
    const y = 0.733;
    drawText(ctx, team.name.toUpperCase(), front(0, y), py(y), 0.03 * kY, ax(y), 0.19 * kX(y), st, 0.007 * kY, 0.16);
  }
  {
    const y = 0.655;
    const cap = 0.072 * kY;
    drawText(ctx, String(def.number), front(0, y), py(y) + cap / 2, cap, ax(y), 0.14 * kX(y), st, 0, 0.16);
  }
  {
    const y = 0.598;
    const s = 0.027;
    drawImageAt(ctx, teamLogoCanvas(team, 128), front(0.056, y), py(y), s * kX(y), s * kY);
  }
  {
    const y = 0.785;
    const s = 0.018;
    drawImageAt(ctx, leagueLogoCanvas(96), front(-0.045, y), py(y), s * kX(y), s * kY);
  }

  // Back: league mark under the collar, name bar, big number.
  {
    const y = 0.8;
    const s = 0.015;
    drawImageAt(ctx, leagueLogoCanvas(96), back(0, y), py(y), s * kX(y), s * kY);
  }
  {
    const y = 0.765;
    drawText(ctx, def.last.toUpperCase().slice(0, 12), back(0, y), py(y), 0.021 * kY, ax(y), 0.17 * kX(y), { ...st, italic: false }, 0.004 * kY, 0.12);
  }
  {
    const y = 0.672;
    const cap = 0.086 * kY;
    drawText(ctx, String(def.number), back(0, y), py(y) + cap / 2, cap, ax(y), 0.16 * kX(y), st, 0, 0.15);
  }

  drawMesh(ctx, W, H, kY, dark);

  // Piping along the neckline and armholes, then cut them out.
  const masks = jerseyMasks(bulk, W, H);
  {
    const tmp = document.createElement('canvas');
    tmp.width = W;
    tmp.height = H;
    const t = tmp.getContext('2d')!;
    t.fillStyle = kit.trim === base ? secondary : kit.trim;
    t.fillRect(0, 0, W, H);
    t.globalCompositeOperation = 'destination-in';
    t.imageSmoothingEnabled = true;
    t.drawImage(masks.piping, 0, 0, W, H);
    ctx.drawImage(tmp, 0, 0);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(masks.cut, 0, 0, W, H);
  ctx.restore();
  return c;
}

// ------------------------------------------------------------------ shorts
export function paintShorts(team: TeamDef, kit: Kit, bulk: number, W: number, H: number, target?: HTMLCanvasElement): HTMLCanvasElement {
  const c = target ?? document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const base = kit.shorts;
  const { primary, secondary, accent } = team.colors;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Waist region (top of the canvas).
  const waistH = (1 - SHORTS.vSplit) * H;
  const kWY = waistH / (SHORTS.waistTop - SHORTS.waistBot);
  const waistP = perimeterAt(0.54, bulk) + 0.11;
  const kWX = W / waistP;
  const wy = (y: number) => (SHORTS.waistTop - y) * kWY;
  // Legs region.
  const legTop = (1 - SHORTS.legV) * H;
  const kLY = (SHORTS.legV * H) / (SHORTS.legTop - SHORTS.legBot);
  const legP = 2 * Math.PI * Math.sqrt((0.061 ** 2 + 0.067 ** 2) / 2);
  const kLX = W / 2 / legP;
  const ly = (y: number) => legTop + (SHORTS.legTop - y) * kLY;

  drawPattern(ctx, team.motif, 0, legTop, W, H - legTop, kLY, tone(base, 0.1), tone(base, 0.22));
  drawPattern(ctx, team.motif, 0, 0, W, waistH, kWY, tone(base, 0.1), tone(base, 0.22));

  const trim = kit.trim === base ? secondary : kit.trim;
  const edge = bestContrast([trim, base], [accent, secondary, primary, '#ffffff', '#111111']);
  // Waistband.
  ctx.fillStyle = trim;
  ctx.fillRect(0, 0, W, wy(0.562));
  ctx.fillStyle = edge;
  ctx.fillRect(0, wy(0.562), W, Math.max(1, 0.0025 * kWY));
  // Small league mark on the back of the waistband area.
  {
    const s = 0.016;
    drawImageAt(ctx, leagueLogoCanvas(96), 0.75 * W, wy(0.548), s * kWX, s * kWY);
  }
  // Side stripes on the outer seams: the left leg's outer seam is its texture seam
  // (x = 0 and x = W/2); the right leg's is the middle of its half (0.75W).
  {
    const sw = 0.04 * kLX;
    for (const cx of [0, W / 2, 0.75 * W]) {
      ctx.save();
      ctx.fillStyle = trim;
      ctx.fillRect(cx - sw / 2, legTop, sw, H - legTop);
      ctx.beginPath();
      ctx.rect(cx - sw / 2, legTop, sw, H - legTop);
      ctx.clip();
      drawPattern(ctx, team.motif, cx - sw, legTop, sw * 2, H - legTop, kLY, tone(trim, 0.18), tone(trim, 0.3));
      ctx.restore();
      ctx.fillStyle = edge;
      ctx.fillRect(cx - sw / 2, legTop, Math.max(1, 0.002 * kLX), H - legTop);
      ctx.fillRect(cx + sw / 2 - Math.max(1, 0.002 * kLX), legTop, Math.max(1, 0.002 * kLX), H - legTop);
    }
  }
  // Hem bands.
  ctx.fillStyle = trim;
  ctx.fillRect(0, ly(SHORTS.legBot + 0.012), W, H - ly(SHORTS.legBot + 0.012));
  ctx.fillStyle = edge;
  ctx.fillRect(0, ly(SHORTS.legBot + 0.012), W, Math.max(1, 0.002 * kLY));
  // Team crest on the left leg (front-outer), abbreviation on the right leg.
  {
    const y = 0.44;
    const s = 0.05;
    drawImageAt(ctx, teamLogoCanvas(team, 128), 0.085 * W, ly(y), s * kLX, s * kLY);
    const st: TextStyle = { fill: kit.number, outline: edge === kit.number ? trim : edge, shadow: tone(base, 0.3), italic: team.style === 'pace' };
    drawText(ctx, team.abbr, 0.665 * W, ly(y) + 0.01 * kLY, 0.02 * kLY, kLX / kLY, 0.06 * kLX, st, 0, 0.14);
  }
  drawMesh(ctx, W, H, kLY, lum(base) < 0.35);
  return c;
}
