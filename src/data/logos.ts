import type { TeamDef, LogoMotif } from './teams.ts';

const cache = new Map<string, HTMLCanvasElement>();

/** Draw a team crest onto a canvas (cached). */
export function teamLogoCanvas(team: TeamDef, size = 256): HTMLCanvasElement {
  const key = `${team.id}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  drawLogo(ctx, size, team);
  cache.set(key, c);
  return c;
}

export function teamLogoDataUrl(team: TeamDef, size = 256): string {
  return teamLogoCanvas(team, size).toDataURL('image/png');
}

export function drawLogo(ctx: CanvasRenderingContext2D, size: number, team: TeamDef) {
  const { primary, secondary, accent } = team.colors;
  const s = size;
  const cx = s / 2;
  const cy = s / 2;
  ctx.clearRect(0, 0, s, s);
  // Shield / roundel background.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.46, 0, Math.PI * 2);
  ctx.fillStyle = secondary;
  ctx.fill();
  ctx.lineWidth = s * 0.035;
  ctx.strokeStyle = primary;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.38, 0, Math.PI * 2);
  ctx.strokeStyle = accent;
  ctx.lineWidth = s * 0.012;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  drawMotif(ctx, s, team.motif, primary, accent);
  ctx.restore();

  // Abbreviation band.
  ctx.save();
  ctx.font = `900 ${s * 0.17}px "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = primary;
  ctx.strokeStyle = secondary;
  ctx.lineWidth = s * 0.03;
  ctx.strokeText(team.abbr, cx, cy + s * 0.29);
  ctx.fillText(team.abbr, cx, cy + s * 0.29);
  ctx.restore();
}

function drawMotif(ctx: CanvasRenderingContext2D, s: number, motif: LogoMotif, color: string, accent: string) {
  const u = s / 100;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 7 * u;
  switch (motif) {
    case 'bolt': {
      ctx.beginPath();
      ctx.moveTo(6 * u, -30 * u);
      ctx.lineTo(-14 * u, 2 * u);
      ctx.lineTo(-1 * u, 2 * u);
      ctx.lineTo(-8 * u, 28 * u);
      ctx.lineTo(14 * u, -6 * u);
      ctx.lineTo(1 * u, -6 * u);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'wave': {
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const y = -14 * u + k * 12 * u;
        ctx.moveTo(-26 * u, y);
        ctx.bezierCurveTo(-14 * u, y - 12 * u, -6 * u, y + 12 * u, 4 * u, y);
        ctx.bezierCurveTo(14 * u, y - 12 * u, 20 * u, y + 6 * u, 26 * u, y - 4 * u);
      }
      ctx.stroke();
      break;
    }
    case 'scorpion': {
      ctx.beginPath();
      ctx.moveTo(-20 * u, 16 * u);
      ctx.quadraticCurveTo(-4 * u, 24 * u, 10 * u, 10 * u);
      ctx.quadraticCurveTo(24 * u, -4 * u, 10 * u, -16 * u);
      ctx.quadraticCurveTo(0, -24 * u, 2 * u, -30 * u);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-20 * u, 16 * u, 9 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-26 * u, 8 * u);
      ctx.lineTo(-34 * u, -2 * u);
      ctx.moveTo(-22 * u, 6 * u);
      ctx.lineTo(-16 * u, -6 * u);
      ctx.stroke();
      break;
    }
    case 'snowflake': {
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 3);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -30 * u);
        ctx.moveTo(0, -18 * u);
        ctx.lineTo(-7 * u, -25 * u);
        ctx.moveTo(0, -18 * u);
        ctx.lineTo(7 * u, -25 * u);
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'crown': {
      ctx.beginPath();
      ctx.moveTo(-28 * u, 16 * u);
      ctx.lineTo(-28 * u, -14 * u);
      ctx.lineTo(-14 * u, 0);
      ctx.lineTo(0, -26 * u);
      ctx.lineTo(14 * u, 0);
      ctx.lineTo(28 * u, -14 * u);
      ctx.lineTo(28 * u, 16 * u);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = accent;
      for (const x of [-18, 0, 18]) {
        ctx.beginPath();
        ctx.arc(x * u, 8 * u, 3.5 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'gator': {
      ctx.beginPath();
      ctx.ellipse(0, 0, 30 * u, 14 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.ellipse(-8 * u, -2 * u, 9 * u, 9 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.ellipse(-8 * u, -2 * u, 2.5 * u, 7 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'anvil': {
      ctx.beginPath();
      ctx.moveTo(-32 * u, -14 * u);
      ctx.lineTo(30 * u, -14 * u);
      ctx.lineTo(22 * u, -2 * u);
      ctx.lineTo(8 * u, -2 * u);
      ctx.lineTo(10 * u, 14 * u);
      ctx.lineTo(24 * u, 20 * u);
      ctx.lineTo(-24 * u, 20 * u);
      ctx.lineTo(-10 * u, 14 * u);
      ctx.lineTo(-8 * u, -2 * u);
      ctx.lineTo(-22 * u, -2 * u);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'surf': {
      ctx.beginPath();
      ctx.moveTo(-30 * u, 18 * u);
      ctx.bezierCurveTo(-30 * u, -20 * u, 10 * u, -30 * u, 24 * u, -8 * u);
      ctx.bezierCurveTo(10 * u, -10 * u, 4 * u, 0, 10 * u, 12 * u);
      ctx.bezierCurveTo(-4 * u, 4 * u, -14 * u, 8 * u, -30 * u, 18 * u);
      ctx.fill();
      break;
    }
    case 'viper': {
      ctx.lineWidth = 9 * u;
      ctx.beginPath();
      ctx.moveTo(22 * u, -24 * u);
      ctx.bezierCurveTo(-30 * u, -26 * u, -22 * u, 2 * u, 2 * u, 0);
      ctx.bezierCurveTo(30 * u, -2 * u, 26 * u, 26 * u, -22 * u, 24 * u);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(20 * u, -24 * u, 3 * u, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'antlers': {
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(dir * 6 * u, 24 * u);
        ctx.quadraticCurveTo(dir * 10 * u, -4 * u, dir * 26 * u, -24 * u);
        ctx.moveTo(dir * 8 * u, 6 * u);
        ctx.lineTo(dir * 20 * u, 2 * u);
        ctx.moveTo(dir * 12 * u, -6 * u);
        ctx.lineTo(dir * 26 * u, -8 * u);
        ctx.stroke();
      }
      break;
    }
    case 'flame': {
      ctx.beginPath();
      ctx.moveTo(0, 30 * u);
      ctx.bezierCurveTo(-30 * u, 10 * u, -10 * u, -10 * u, -6 * u, -30 * u);
      ctx.bezierCurveTo(2 * u, -16 * u, 8 * u, -14 * u, 6 * u, -4 * u);
      ctx.bezierCurveTo(16 * u, -14 * u, 30 * u, 10 * u, 0, 30 * u);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(0, 24 * u);
      ctx.bezierCurveTo(-12 * u, 12 * u, -4 * u, 2 * u, 0, -6 * u);
      ctx.bezierCurveTo(6 * u, 2 * u, 12 * u, 12 * u, 0, 24 * u);
      ctx.fill();
      break;
    }
    case 'anchor': {
      ctx.beginPath();
      ctx.arc(0, -22 * u, 6 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -16 * u);
      ctx.lineTo(0, 26 * u);
      ctx.moveTo(-16 * u, -6 * u);
      ctx.lineTo(16 * u, -6 * u);
      ctx.moveTo(-26 * u, 8 * u);
      ctx.quadraticCurveTo(-20 * u, 30 * u, 0, 26 * u);
      ctx.quadraticCurveTo(20 * u, 30 * u, 26 * u, 8 * u);
      ctx.stroke();
      break;
    }
  }
}
