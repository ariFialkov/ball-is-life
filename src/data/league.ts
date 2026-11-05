/** League branding shared by jerseys, shorts and (later) UI. */
export const LEAGUE = { abbr: 'BIL', name: 'Ball is Life League' } as const;

const cache = new Map<number, HTMLCanvasElement>();

/**
 * The league mark: a tall rounded badge holding a basketball and the "BIL"
 * wordmark. It is drawn small on kits, so it is built from bold, simple shapes
 * that still read at a few dozen pixels.
 */
export function leagueLogoCanvas(size = 128): HTMLCanvasElement {
  const hit = cache.get(size);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const s = size;
  const w = s * 0.6;
  const hgt = s * 0.94;
  const x0 = (s - w) / 2;
  const y0 = (s - hgt) / 2;
  const r = w * 0.32;
  const badge = () => {
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.lineTo(x0 + w - r, y0);
    ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    ctx.lineTo(x0 + w, y0 + hgt - r);
    ctx.quadraticCurveTo(x0 + w, y0 + hgt, x0 + w - r, y0 + hgt);
    ctx.lineTo(x0 + r, y0 + hgt);
    ctx.quadraticCurveTo(x0, y0 + hgt, x0, y0 + hgt - r);
    ctx.lineTo(x0, y0 + r);
    ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
    ctx.closePath();
  };
  // White outline keeps it legible on any jersey colour.
  badge();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.scale(0.86, 0.9);
  ctx.translate(-s / 2, -s / 2);
  badge();
  ctx.fillStyle = '#10131c';
  ctx.fill();
  ctx.restore();
  // Ball.
  const bx = s / 2;
  const by = y0 + hgt * 0.36;
  const br = w * 0.3;
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fillStyle = '#ff7a1a';
  ctx.fill();
  ctx.strokeStyle = '#10131c';
  ctx.lineWidth = Math.max(1, br * 0.14);
  ctx.beginPath();
  ctx.moveTo(bx - br, by);
  ctx.lineTo(bx + br, by);
  ctx.moveTo(bx, by - br);
  ctx.lineTo(bx, by + br);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(bx - br * 1.25, by, br * 0.95, -0.75, 0.75);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(bx + br * 1.25, by, br * 0.95, Math.PI - 0.75, Math.PI + 0.75);
  ctx.stroke();
  // Wordmark.
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(w * 0.36)}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  ctx.fillText(LEAGUE.abbr, bx, y0 + hgt * 0.76);
  cache.set(size, c);
  return c;
}
