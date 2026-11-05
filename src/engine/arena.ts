import * as THREE from 'three';
import type { TeamDef } from '../data/teams.ts';
import { drawLogo } from '../data/logos.ts';
import {
  BACKBOARD_BOTTOM,
  BACKBOARD_H,
  BACKBOARD_W,
  BACKBOARD_X,
  COURT_LENGTH,
  COURT_WIDTH,
  FT_LINE_DIST,
  HALF_L,
  HALF_W,
  KEY_W,
  RIM_H,
  RIM_R,
  RIM_TUBE,
  RIM_X,
  THREE_CORNER_Z,
  THREE_R,
} from './constants.ts';

export interface ArenaOptions {
  homeTeam: TeamDef;
  awayTeam?: TeamDef;
  mobile: boolean;
}

/** Builds the court, hoops, stands, crowd and lighting for a home team's arena. */
export class Arena {
  readonly group = new THREE.Group();
  readonly crowd: THREE.InstancedMesh;
  readonly jumbotron: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture };
  private crowdUniform = { value: 0 };
  readonly nets: THREE.LineSegments[] = [];
  readonly home: TeamDef;

  constructor(opts: ArenaOptions) {
    this.home = opts.homeTeam;
    const g = this.group;
    g.add(this.buildFloor(opts.homeTeam));
    g.add(this.buildHoop(1));
    g.add(this.buildHoop(-1));
    g.add(this.buildStands(opts.homeTeam));
    this.crowd = this.buildCrowd(opts.homeTeam, opts.awayTeam ?? opts.homeTeam, opts.mobile);
    g.add(this.crowd);
    this.jumbotron = this.buildJumbotron();
    g.add(this.buildLights(opts.mobile));
    g.add(this.buildAdBoards(opts.homeTeam));
  }

  /** Animate crowd bob and ad boards. */
  update(t: number) {
    this.crowdUniform.value = t;
  }

  private buildFloor(team: TeamDef): THREE.Group {
    const grp = new THREE.Group();
    const texW = 2048;
    const texH = Math.round((texW * COURT_WIDTH) / COURT_LENGTH);
    const c = document.createElement('canvas');
    c.width = texW;
    c.height = texH;
    const ctx = c.getContext('2d')!;
    const sx = texW / COURT_LENGTH; // px per metre
    // Hardwood.
    ctx.fillStyle = '#c8945a';
    ctx.fillRect(0, 0, texW, texH);
    const plankW = 0.12 * sx;
    for (let x = 0; x < texW; x += plankW) {
      const shade = 0.9 + Math.random() * 0.2;
      ctx.fillStyle = `rgb(${Math.round(205 * shade)},${Math.round(150 * shade)},${Math.round(90 * shade)})`;
      ctx.fillRect(x, 0, plankW + 1, texH);
      // Plank seams at random offsets.
      ctx.fillStyle = 'rgba(80,45,20,0.25)';
      let y = Math.random() * 2 * sx;
      while (y < texH) {
        ctx.fillRect(x, y, plankW, 2);
        y += 1.5 * sx + Math.random() * 1.5 * sx;
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    for (let x = 0; x < texW; x += plankW) ctx.fillRect(x, 0, 1.5, texH);

    const toX = (m: number) => (m + HALF_L) * sx;
    const toY = (m: number) => (m + HALF_W) * sx;
    const paint = hexToRgba(team.colors.primary, 0.55);
    // Keys.
    for (const side of [-1, 1]) {
      const baseline = side * HALF_L;
      const ft = side * (HALF_L - FT_LINE_DIST);
      ctx.fillStyle = paint;
      ctx.fillRect(Math.min(toX(baseline), toX(ft)), toY(-KEY_W / 2), Math.abs(toX(ft) - toX(baseline)), KEY_W * sx);
    }
    // Lines.
    ctx.strokeStyle = '#f8f4ec';
    ctx.lineWidth = 0.05 * sx;
    ctx.strokeRect(toX(-HALF_L) + ctx.lineWidth / 2, toY(-HALF_W) + ctx.lineWidth / 2, COURT_LENGTH * sx - ctx.lineWidth, COURT_WIDTH * sx - ctx.lineWidth);
    // Half court line + circle.
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(-HALF_W));
    ctx.lineTo(toX(0), toY(HALF_W));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(toX(0), toY(0), 1.83 * sx, 0, Math.PI * 2);
    ctx.stroke();
    for (const side of [-1, 1]) {
      const baseline = side * HALF_L;
      const ft = side * (HALF_L - FT_LINE_DIST);
      const rimX = side * RIM_X;
      ctx.strokeRect(Math.min(toX(baseline), toX(ft)), toY(-KEY_W / 2), Math.abs(toX(ft) - toX(baseline)), KEY_W * sx);
      // Free throw circle.
      ctx.beginPath();
      ctx.arc(toX(ft), toY(0), 1.83 * sx, 0, Math.PI * 2);
      ctx.stroke();
      // Restricted area.
      ctx.beginPath();
      ctx.arc(toX(rimX), toY(0), 1.22 * sx, side > 0 ? Math.PI / 2 : -Math.PI / 2, side > 0 ? (3 * Math.PI) / 2 : Math.PI / 2);
      ctx.stroke();
      // Three point line: corners + arc.
      const cornerLen = Math.sqrt(THREE_R * THREE_R - THREE_CORNER_Z * THREE_CORNER_Z);
      const arcStartX = rimX - side * cornerLen;
      ctx.beginPath();
      ctx.moveTo(toX(baseline), toY(-THREE_CORNER_Z));
      ctx.lineTo(toX(arcStartX), toY(-THREE_CORNER_Z));
      const a0 = Math.atan2(-THREE_CORNER_Z, -side * cornerLen);
      const a1 = Math.atan2(THREE_CORNER_Z, -side * cornerLen);
      ctx.arc(toX(rimX), toY(0), THREE_R * sx, a0, a1, side > 0);
      ctx.lineTo(toX(baseline), toY(THREE_CORNER_Z));
      ctx.stroke();
    }
    // Center logo.
    const logoSize = 3.4 * sx;
    const lc = document.createElement('canvas');
    lc.width = lc.height = 512;
    drawLogo(lc.getContext('2d')!, 512, team);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.translate(toX(0), toY(0));
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(lc, -logoSize / 2, -logoSize / 2, logoSize, logoSize);
    ctx.restore();
    // Wordmarks along the sidelines.
    ctx.save();
    ctx.font = `900 ${0.9 * sx}px "Segoe UI", Roboto, Arial, sans-serif`;
    ctx.fillStyle = hexToRgba(team.colors.secondary, 0.8);
    ctx.textAlign = 'center';
    ctx.fillText(`${team.city.toUpperCase()} ${team.name.toUpperCase()}`, toX(0), toY(HALF_W) - 0.25 * sx);
    ctx.save();
    ctx.translate(toX(0), toY(-HALF_W) + 0.25 * sx);
    ctx.rotate(Math.PI);
    ctx.fillText(`${team.arena.name.toUpperCase()}`, 0, 0);
    ctx.restore();
    ctx.restore();
    // Apron (out of bounds) in team colour.
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(COURT_LENGTH, COURT_WIDTH),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    grp.add(floor);
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(COURT_LENGTH + 7, COURT_WIDTH + 7),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(team.colors.secondary).multiplyScalar(0.55), roughness: 0.8 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.005;
    apron.receiveShadow = true;
    grp.add(apron);
    return grp;
  }

  private buildHoop(side: 1 | -1): THREE.Group {
    const grp = new THREE.Group();
    const x = side * BACKBOARD_X;
    // Backboard.
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, BACKBOARD_H, BACKBOARD_W),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05, transmission: 0.2, metalness: 0 }),
    );
    board.position.set(x, BACKBOARD_BOTTOM + BACKBOARD_H / 2, 0);
    board.castShadow = true;
    grp.add(board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, BACKBOARD_H + 0.06, BACKBOARD_W + 0.06), new THREE.MeshStandardMaterial({ color: 0x222222, wireframe: true }));
    frame.position.copy(board.position);
    grp.add(frame);
    // Inner square.
    const sq = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.45, 0.59), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }));
    sq.position.set(x - side * 0.002, RIM_H + 0.225, 0);
    grp.add(sq);
    // Rim.
    const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, RIM_TUBE, 10, 36), new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.4, metalness: 0.6 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(side * RIM_X, RIM_H, 0);
    rim.castShadow = true;
    grp.add(rim);
    // Rim bracket.
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.12), rim.material);
    bracket.position.set(side * (RIM_X + RIM_R + 0.07), RIM_H - 0.02, 0);
    grp.add(bracket);
    // Net.
    const netPts: number[] = [];
    const rings = 6;
    const spokes = 12;
    for (let s = 0; s < spokes; s++) {
      const a0 = (s / spokes) * Math.PI * 2;
      for (let r = 0; r < rings; r++) {
        const y0 = RIM_H - (r / rings) * 0.42;
        const y1 = RIM_H - ((r + 1) / rings) * 0.42;
        const rad0 = RIM_R * (1 - 0.35 * (r / rings));
        const rad1 = RIM_R * (1 - 0.35 * ((r + 1) / rings));
        const a1 = a0 + Math.PI / spokes;
        const a2 = a0 - Math.PI / spokes;
        netPts.push(side * RIM_X + Math.cos(a0) * rad0, y0, Math.sin(a0) * rad0, side * RIM_X + Math.cos(a1) * rad1, y1, Math.sin(a1) * rad1);
        netPts.push(side * RIM_X + Math.cos(a0) * rad0, y0, Math.sin(a0) * rad0, side * RIM_X + Math.cos(a2) * rad1, y1, Math.sin(a2) * rad1);
      }
    }
    const netGeo = new THREE.BufferGeometry();
    netGeo.setAttribute('position', new THREE.Float32BufferAttribute(netPts, 3));
    const net = new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({ color: 0xf4f4f4, transparent: true, opacity: 0.9 }));
    this.nets.push(net);
    grp.add(net);
    // Stanchion.
    const stMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.6 });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.9, 0.3), stMat);
    post.position.set(side * (HALF_L + 1.4), 1.95, 0);
    post.castShadow = true;
    grp.add(post);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 0.2), stMat);
    arm.position.set(side * (HALF_L + 0.2), 3.85, 0);
    grp.add(arm);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), new THREE.MeshStandardMaterial({ color: this.home.colors.primary }));
    pad.position.set(side * (HALF_L + 1.4), 0.75, 0);
    grp.add(pad);
    return grp;
  }

  private buildStands(team: TeamDef): THREE.Group {
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.9 });
    const rows = 14;
    const inner = { x: HALF_L + 4.5, z: HALF_W + 4.5 };
    for (let r = 0; r < rows; r++) {
      const d = r * 0.95;
      const h = 0.45 + r * 0.42;
      const lx = (inner.x + d) * 2 + 1.9;
      const lz = (inner.z + d) * 2 + 1.9;
      const step = 0.95;
      const sideA = new THREE.Mesh(new THREE.BoxGeometry(lx, h, step), mat);
      sideA.position.set(0, h / 2, inner.z + d + step / 2);
      const sideB = sideA.clone();
      sideB.position.z = -(inner.z + d + step / 2);
      const endA = new THREE.Mesh(new THREE.BoxGeometry(step, h, lz), mat);
      endA.position.set(inner.x + d + step / 2, h / 2, 0);
      const endB = endA.clone();
      endB.position.x = -(inner.x + d + step / 2);
      for (const m of [sideA, sideB, endA, endB]) {
        m.receiveShadow = true;
        grp.add(m);
      }
    }
    // Upper deck facade band in team colour.
    // Upper deck facade: a thin ring of four slabs (not a solid box, so cameras above it still see the court).
    const bandMat = new THREE.MeshStandardMaterial({ color: team.colors.primary, emissive: new THREE.Color(team.colors.primary).multiplyScalar(0.25), roughness: 0.5 });
    const bx = inner.x + rows * 0.95 + 1.5;
    const bz = inner.z + rows * 0.95 + 1.5;
    const by = 0.45 + rows * 0.42 + 1.2;
    for (const [w, d, x, z] of [
      [bx * 2 + 1, 0.5, 0, bz],
      [bx * 2 + 1, 0.5, 0, -bz],
      [0.5, bz * 2 + 1, bx, 0],
      [0.5, bz * 2 + 1, -bx, 0],
    ]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), bandMat);
      slab.position.set(x, by, z);
      grp.add(slab);
    }
    // Scorer's table.
    const table = new THREE.Mesh(new THREE.BoxGeometry(9, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: team.colors.secondary, emissive: new THREE.Color(team.colors.primary).multiplyScalar(0.3) }));
    table.position.set(0, 0.4, -(HALF_W + 1.4));
    grp.add(table);
    // Ceiling / roof plane to catch bloom-ish darkness.
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x0a0b10, roughness: 1 }));
    roof.rotation.x = Math.PI / 2;
    roof.position.y = 24;
    grp.add(roof);
    return grp;
  }

  private buildCrowd(home: TeamDef, away: TeamDef, mobile: boolean): THREE.InstancedMesh {
    const rows = mobile ? 9 : 14;
    const inner = { x: HALF_L + 4.5, z: HALF_W + 4.5 };
    const positions: { x: number; z: number; y: number }[] = [];
    const spacing = mobile ? 0.9 : 0.62;
    for (let r = 0; r < rows; r++) {
      const d = r * 0.95 + 0.45;
      const y = 0.45 + r * 0.42;
      const lx = inner.x + d - 0.3;
      const lz = inner.z + d - 0.3;
      for (let x = -lx; x <= lx; x += spacing) {
        if (Math.random() < 0.08) continue;
        positions.push({ x: x + (Math.random() - 0.5) * 0.2, z: inner.z + d, y });
        positions.push({ x: x + (Math.random() - 0.5) * 0.2, z: -(inner.z + d), y });
      }
      for (let z = -lz + 2; z <= lz - 2; z += spacing) {
        if (Math.random() < 0.08) continue;
        positions.push({ x: inner.x + d, z: z + (Math.random() - 0.5) * 0.2, y });
        positions.push({ x: -(inner.x + d), z: z + (Math.random() - 0.5) * 0.2, y });
      }
    }
    const geo = new THREE.CapsuleGeometry(0.17, 0.42, 3, 6);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const uniform = this.crowdUniform;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n float bob = sin(uTime * 2.6 + float(gl_InstanceID) * 0.71) * 0.5 + 0.5;\n transformed.y += bob * bob * 0.08 * step(0.7, fract(float(gl_InstanceID) * 0.137));',
        );
    };
    const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
    const dummy = new THREE.Object3D();
    const palette = [home.colors.primary, home.colors.primary, home.colors.secondary, away.colors.primary, '#222222', '#dddddd', '#4a4a52', '#8a2a2a', '#2a4a8a'];
    const color = new THREE.Color();
    positions.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.y = Math.atan2(-p.x, -p.z) + (Math.random() - 0.5) * 0.4;
      const s = 0.85 + Math.random() * 0.3;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.set(palette[Math.floor(Math.random() * palette.length)]).multiplyScalar(0.7 + Math.random() * 0.4);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  private buildJumbotron() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 384;
    const ctx = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: texture });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(8.2, 3.2, 8.2), new THREE.MeshStandardMaterial({ color: 0x111115, roughness: 0.7 }));
    frame.position.set(0, 16, 0);
    this.group.add(frame);
    for (let i = 0; i < 4; i++) {
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 2.85), mat);
      const a = (i * Math.PI) / 2;
      screen.position.set(Math.sin(a) * 4.12, 16, Math.cos(a) * 4.12);
      screen.rotation.y = a;
      this.group.add(screen);
    }
    return { canvas, ctx, texture };
  }

  drawJumbotron(home: { abbr: string; score: number; color: string }, away: { abbr: string; score: number; color: string }, clock: string, period: string) {
    const { ctx, canvas, texture } = this.jumbotron;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#07070c';
    ctx.fillRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, home.color);
    grad.addColorStop(0.5, '#07070c');
    grad.addColorStop(1, away.color);
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 150px "Segoe UI", Roboto, Arial, sans-serif';
    ctx.fillText(String(home.score), w * 0.2, h * 0.5);
    ctx.fillText(String(away.score), w * 0.8, h * 0.5);
    ctx.font = '700 54px "Segoe UI", Roboto, Arial, sans-serif';
    ctx.fillText(home.abbr, w * 0.2, h * 0.86);
    ctx.fillText(away.abbr, w * 0.8, h * 0.86);
    ctx.fillStyle = '#ffd166';
    ctx.font = '900 110px "Segoe UI", Roboto, Arial, sans-serif';
    ctx.fillText(clock, w * 0.5, h * 0.42);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 46px "Segoe UI", Roboto, Arial, sans-serif';
    ctx.fillText(period, w * 0.5, h * 0.78);
    texture.needsUpdate = true;
  }

  private buildLights(mobile: boolean): THREE.Group {
    const grp = new THREE.Group();
    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x24170f, 0.75);
    grp.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
    key.position.set(6, 22, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    key.shadow.camera.left = -18;
    key.shadow.camera.right = 18;
    key.shadow.camera.top = 12;
    key.shadow.camera.bottom = -12;
    key.shadow.camera.near = 5;
    key.shadow.camera.far = 50;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    grp.add(key);
    const fill = new THREE.DirectionalLight(0xbcd0ff, 0.5);
    fill.position.set(-10, 14, -8);
    grp.add(fill);
    // Decorative arena spotlights.
    for (const [x, z] of [
      [-12, 10],
      [12, 10],
      [-12, -10],
      [12, -10],
    ]) {
      const spot = new THREE.SpotLight(0xffffff, mobile ? 40 : 90, 60, 0.6, 0.6, 1.2);
      spot.position.set(x, 21, z);
      spot.target.position.set(x * 0.4, 0, z * 0.3);
      grp.add(spot, spot.target);
    }
    return grp;
  }

  private buildAdBoards(team: TeamDef): THREE.Group {
    const grp = new THREE.Group();
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = team.colors.secondary;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = '900 72px "Segoe UI", Roboto, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = team.colors.primary;
    const words = ['BALL IS LIFE', team.arena.name.toUpperCase(), `${team.name.toUpperCase()} NATION`, 'LEGENDS EDITION', 'SEASON 26'];
    let x = 30;
    let i = 0;
    while (x < c.width) {
      const w = words[i % words.length];
      ctx.fillText(w, x, 64);
      x += ctx.measureText(w).width + 120;
      i++;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.5 });
    const len = COURT_LENGTH + 6;
    const boardA = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 0.12), mat);
    boardA.position.set(0, 0.45, HALF_W + 3.8);
    grp.add(boardA);
    const boardB = boardA.clone();
    boardB.position.z = -(HALF_W + 3.8);
    boardB.rotation.y = Math.PI;
    grp.add(boardB);
    const endMat = mat.clone();
    for (const side of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(COURT_WIDTH + 4, 0.9, 0.12), endMat);
      b.position.set(side * (HALF_L + 3.8), 0.45, 0);
      b.rotation.y = side * Math.PI / 2;
      grp.add(b);
    }
    return grp;
  }
}

export function hexToRgba(hex: string, a: number): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
