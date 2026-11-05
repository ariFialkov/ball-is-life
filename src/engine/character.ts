import * as THREE from 'three';
import type { Kit, PlayerDef } from '../data/teams.ts';

export type AnimState =
  | 'idle'
  | 'idleBall'
  | 'run'
  | 'dribble'
  | 'defense'
  | 'shoot'
  | 'layup'
  | 'dunk'
  | 'pass'
  | 'block'
  | 'steal'
  | 'celebrate'
  | 'dejected'
  | 'catch';

type BoneName = 'spine' | 'head' | 'lShoulder' | 'lElbow' | 'rShoulder' | 'rElbow' | 'lHip' | 'lKnee' | 'rHip' | 'rKnee';
const BONES: BoneName[] = ['spine', 'head', 'lShoulder', 'lElbow', 'rShoulder', 'rElbow', 'lHip', 'lKnee', 'rHip', 'rKnee'];

interface Pose {
  bones: Record<BoneName, [number, number, number]>;
  /** vertical offset of the hips relative to standing height (negative = crouch) */
  hipsY: number;
  /** jump height added to the whole body */
  jump: number;
}

const SKIN_TONES = ['#f1c9a5', '#d9a071', '#b67a4f', '#8a5a3a', '#5b3a26'];
const HAIR = ['#111111', '#2a1a0a', '#4a2f1a', '#151515'];

const emptyPose = (): Pose => ({
  bones: {
    spine: [0, 0, 0],
    head: [0, 0, 0],
    lShoulder: [0, 0, 0],
    lElbow: [0, 0, 0],
    rShoulder: [0, 0, 0],
    rElbow: [0, 0, 0],
    lHip: [0, 0, 0],
    lKnee: [0, 0, 0],
    rHip: [0, 0, 0],
    rKnee: [0, 0, 0],
  },
  hipsY: 0,
  jump: 0,
});

// Rotation conventions (model faces +Z): a limb hanging down (-Y) swings
// forward with a NEGATIVE rotation.x; the spine leans forward with a
// POSITIVE rotation.x; rotation.z spreads the arms/legs outward (sign per side).

/**
 * A procedurally rigged basketball player built from primitives.
 * All animation is generated analytically and blended, so no asset files are
 * needed and every player on the floor can run a different cycle.
 */
export class Character {
  readonly root = new THREE.Group();
  readonly hips = new THREE.Group();
  readonly bones: Record<BoneName, THREE.Group>;
  readonly rHand = new THREE.Object3D();
  readonly lHand = new THREE.Object3D();
  readonly def: PlayerDef;
  readonly h: number;
  private standHipY: number;
  state: AnimState = 'idle';
  stateTime = 0;
  /** 0..1 locomotion intensity used while running/dribbling */
  moveBlend = 0;
  phase = 0;
  dribblePhase = 0;
  private current: Pose = emptyPose();
  private jerseyTex: THREE.CanvasTexture | null = null;
  readonly meshes: THREE.Mesh[] = [];
  highlight: THREE.Mesh;
  shadowBlob: THREE.Mesh;
  handedness: 1 | -1 = 1;

  constructor(def: PlayerDef, kit: Kit, opts: { lowDetail?: boolean } = {}) {
    this.def = def;
    const h = def.height;
    this.h = h;
    const seg = opts.lowDetail ? 4 : 8;
    const skin = new THREE.MeshStandardMaterial({ color: SKIN_TONES[def.skin % SKIN_TONES.length], roughness: 0.75 });
    const hairMat = new THREE.MeshStandardMaterial({ color: HAIR[def.hair % HAIR.length], roughness: 0.9 });
    const jerseyMat = this.makeJerseyMaterial(kit, def);
    const shortsMat = new THREE.MeshStandardMaterial({ color: kit.shorts, roughness: 0.8 });
    const trimMat = new THREE.MeshStandardMaterial({ color: kit.trim, roughness: 0.8 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: kit.trim, roughness: 0.5 });
    const sockMat = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.9 });

    const legUpper = 0.25 * h;
    const legLower = 0.24 * h;
    const footH = 0.045 * h;
    this.standHipY = legUpper + legLower + footH;
    const torsoLen = 0.3 * h;
    const shoulderW = 0.235 * h;
    const hipW = 0.165 * h;
    const armUpper = 0.17 * h;
    const armLower = 0.16 * h;

    this.hips.position.y = this.standHipY;
    this.root.add(this.hips);
    const mk = (name: BoneName, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(x, y, z);
      parent.add(g);
      return g;
    };
    const spine = mk('spine', this.hips, 0, 0.02 * h, 0);
    // Pelvis / shorts.
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(hipW + 0.06 * h, 0.14 * h, 0.12 * h), shortsMat);
    pelvis.position.y = -0.03 * h;
    this.hips.add(pelvis);
    this.meshes.push(pelvis);
    // Torso (slightly tapered).
    const torso = new THREE.Mesh(new THREE.BoxGeometry(shoulderW, torsoLen, 0.13 * h, 1, 1, 1), jerseyMat);
    torso.position.y = torsoLen / 2;
    spine.add(torso);
    this.meshes.push(torso);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * h, 0.035 * h, 0.05 * h, seg), skin);
    neck.position.y = torsoLen + 0.02 * h;
    spine.add(neck);
    const head = mk('head', spine, 0, torsoLen + 0.045 * h, 0);
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.065 * h, seg * 2, seg * 2), skin);
    headMesh.position.y = 0.06 * h;
    headMesh.scale.set(0.92, 1.08, 0.95);
    head.add(headMesh);
    this.meshes.push(headMesh);
    if (def.hair !== 3) {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.068 * h, seg * 2, seg, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
      hair.position.y = 0.065 * h;
      hair.scale.set(0.93, 1.05, 0.96);
      head.add(hair);
      this.meshes.push(hair);
    }
    // Headband in team trim for variety.
    if (def.hair === 2) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.064 * h, 0.064 * h, 0.02 * h, seg * 2, 1, true), trimMat);
      band.position.y = 0.085 * h;
      head.add(band);
    }
    // Arms.
    const armGeoU = new THREE.CapsuleGeometry(0.035 * h, armUpper - 0.07 * h, 2, seg);
    const armGeoL = new THREE.CapsuleGeometry(0.03 * h, armLower - 0.06 * h, 2, seg);
    const mkArm = (side: 1 | -1) => {
      const shoulder = mk(side > 0 ? 'rShoulder' : 'lShoulder', spine, side * (shoulderW / 2 + 0.02 * h), torsoLen - 0.03 * h, 0);
      const sleeve = new THREE.Mesh(new THREE.SphereGeometry(0.045 * h, seg, seg), jerseyMat);
      shoulder.add(sleeve);
      const upper = new THREE.Mesh(armGeoU, skin);
      upper.position.y = -armUpper / 2;
      shoulder.add(upper);
      const elbow = mk(side > 0 ? 'rElbow' : 'lElbow', shoulder, 0, -armUpper, 0);
      const lower = new THREE.Mesh(armGeoL, skin);
      lower.position.y = -armLower / 2;
      elbow.add(lower);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.034 * h, seg, seg), skin);
      hand.position.y = -armLower;
      elbow.add(hand);
      const handAnchor = side > 0 ? this.rHand : this.lHand;
      handAnchor.position.set(0, -armLower - 0.05 * h, 0.04 * h);
      elbow.add(handAnchor);
      this.meshes.push(sleeve, upper, lower, hand);
      return { shoulder, elbow };
    };
    const rArm = mkArm(1);
    const lArm = mkArm(-1);
    // Legs.
    const legGeoU = new THREE.CapsuleGeometry(0.055 * h, legUpper - 0.1 * h, 2, seg);
    const legGeoL = new THREE.CapsuleGeometry(0.042 * h, legLower - 0.08 * h, 2, seg);
    const mkLeg = (side: 1 | -1) => {
      const hip = mk(side > 0 ? 'rHip' : 'lHip', this.hips, side * hipW * 0.45, -0.04 * h, 0);
      const upper = new THREE.Mesh(legGeoU, shortsMat);
      upper.position.y = -legUpper / 2 + 0.02 * h;
      hip.add(upper);
      const knee = mk(side > 0 ? 'rKnee' : 'lKnee', hip, 0, -legUpper, 0);
      const lower = new THREE.Mesh(legGeoL, skin);
      lower.position.y = -legLower / 2;
      knee.add(lower);
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.044 * h, 0.046 * h, 0.08 * h, seg), sockMat);
      sock.position.y = -legLower + 0.05 * h;
      knee.add(sock);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.075 * h, footH, 0.14 * h), shoeMat);
      shoe.position.set(0, -legLower - footH / 2 + 0.01 * h, 0.025 * h);
      knee.add(shoe);
      this.meshes.push(upper, lower, sock, shoe);
      return { hip, knee };
    };
    const rLeg = mkLeg(1);
    const lLeg = mkLeg(-1);

    this.bones = {
      spine,
      head,
      lShoulder: lArm.shoulder,
      lElbow: lArm.elbow,
      rShoulder: rArm.shoulder,
      rElbow: rArm.elbow,
      lHip: lLeg.hip,
      lKnee: lLeg.knee,
      rHip: rLeg.hip,
      rKnee: rLeg.knee,
    };
    for (const m of this.meshes) {
      m.castShadow = true;
      m.receiveShadow = false;
    }
    // Selection ring under the controlled player.
    this.highlight = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.position.y = 0.012;
    this.root.add(this.highlight);
    this.shadowBlob = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
    this.shadowBlob.rotation.x = -Math.PI / 2;
    this.shadowBlob.position.y = 0.008;
    this.root.add(this.shadowBlob);
    this.applyPose(this.current);
  }

  private makeJerseyMaterial(kit: Kit, def: PlayerDef): THREE.Material[] {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d')!;
    // Atlas: left half = front, right half = back.
    ctx.fillStyle = kit.jersey;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = kit.trim;
    ctx.fillRect(0, 0, 512, 26);
    ctx.fillRect(0, 486, 512, 26);
    ctx.fillRect(0, 0, 12, 512);
    ctx.fillRect(244, 0, 24, 512);
    ctx.fillRect(500, 0, 12, 512);
    ctx.textAlign = 'center';
    ctx.fillStyle = kit.number;
    ctx.strokeStyle = kit.trim;
    ctx.lineWidth = 6;
    ctx.font = '900 150px "Segoe UI", Roboto, Arial, sans-serif';
    ctx.strokeText(String(def.number), 128, 330);
    ctx.fillText(String(def.number), 128, 330);
    ctx.font = '700 44px "Segoe UI", Roboto, Arial, sans-serif';
    ctx.fillText(def.last.toUpperCase().slice(0, 10), 384, 120);
    ctx.font = '900 190px "Segoe UI", Roboto, Arial, sans-serif';
    ctx.strokeText(String(def.number), 384, 360);
    ctx.fillText(String(def.number), 384, 360);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.jerseyTex = tex;
    const front = tex.clone();
    front.repeat.set(0.5, 1);
    front.offset.set(0, 0);
    front.needsUpdate = true;
    const back = tex.clone();
    back.repeat.set(0.5, 1);
    back.offset.set(0.5, 0);
    back.needsUpdate = true;
    const side = new THREE.MeshStandardMaterial({ color: kit.jersey, roughness: 0.85 });
    const frontMat = new THREE.MeshStandardMaterial({ map: front, roughness: 0.85 });
    const backMat = new THREE.MeshStandardMaterial({ map: back, roughness: 0.85 });
    const trim = new THREE.MeshStandardMaterial({ color: kit.trim, roughness: 0.85 });
    // Box faces: +x, -x, +y, -y, +z (front), -z (back)
    return [side, side, trim, side, frontMat, backMat];
  }

  setState(s: AnimState) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
  }

  setHighlight(on: boolean, color = 0xffffff) {
    const m = this.highlight.material as THREE.MeshBasicMaterial;
    m.opacity = on ? 0.85 : 0;
    m.color.set(color);
  }

  /** Advance animation. moveSpeed01 is 0..1 (0 = stationary, 1 = full sprint). */
  update(dt: number, moveSpeed01: number) {
    this.stateTime += dt;
    this.moveBlend += (moveSpeed01 - this.moveBlend) * Math.min(1, dt * 10);
    const stride = 0.5 + this.moveBlend * 1.0;
    this.phase += dt * (6.5 + this.moveBlend * 6) * (this.moveBlend > 0.03 ? 1 : 0);
    this.dribblePhase += dt * 10.5;
    const target = this.generatePose();
    // Quick blend for transitions, snappier when entering explosive actions.
    const rate = this.state === 'shoot' || this.state === 'dunk' || this.state === 'layup' || this.state === 'pass' || this.state === 'block' ? 20 : 12;
    const k = Math.min(1, dt * rate);
    for (const b of BONES) {
      const c = this.current.bones[b];
      const t = target.bones[b];
      c[0] += (t[0] - c[0]) * k;
      c[1] += (t[1] - c[1]) * k;
      c[2] += (t[2] - c[2]) * k;
    }
    this.current.hipsY += (target.hipsY - this.current.hipsY) * k;
    this.current.jump = target.jump;
    this.applyPose(this.current);
    void stride;
  }

  private applyPose(p: Pose) {
    for (const b of BONES) {
      const r = p.bones[b];
      this.bones[b].rotation.set(r[0], r[1], r[2]);
    }
    this.hips.position.y = this.standHipY + p.hipsY + p.jump;
    this.shadowBlob.scale.setScalar(1 - Math.min(0.6, p.jump * 0.6));
    (this.shadowBlob.material as THREE.MeshBasicMaterial).opacity = 0.25 - Math.min(0.15, p.jump * 0.2);
  }

  /** Height of the body above the floor (jump). */
  get airHeight() {
    return this.current.jump;
  }

  private generatePose(): Pose {
    const p = emptyPose();
    const b = p.bones;
    const t = this.stateTime;
    const m = this.moveBlend;
    const ph = this.phase;
    const hand = this.handedness;
    const R = hand > 0 ? 'rShoulder' : 'lShoulder';
    const RE = hand > 0 ? 'rElbow' : 'lElbow';
    const L = hand > 0 ? 'lShoulder' : 'rShoulder';
    const LE = hand > 0 ? 'lElbow' : 'rElbow';
    const breathe = Math.sin(t * 2.2) * 0.02;

    const locomotion = (amp: number) => {
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      b.lHip = [-s * 0.75 * amp, 0, -0.03];
      b.rHip = [s * 0.75 * amp, 0, 0.03];
      b.lKnee = [(0.25 + 0.9 * Math.max(0, -c)) * amp + 0.08, 0, 0];
      b.rKnee = [(0.25 + 0.9 * Math.max(0, c)) * amp + 0.08, 0, 0];
      b.spine = [0.08 + 0.22 * amp, Math.sin(ph) * 0.06 * amp, 0];
      p.hipsY = -0.02 - Math.abs(Math.sin(ph)) * 0.035 * amp - 0.05 * amp;
    };
    const idleArms = () => {
      b.lShoulder = [0.05, 0, 0.14];
      b.rShoulder = [0.05, 0, -0.14];
      b.lElbow = [-0.25, 0, 0];
      b.rElbow = [-0.25, 0, 0];
    };
    const runArms = (amp: number) => {
      const s = Math.sin(ph);
      b.lShoulder = [0.55 * s * amp - 0.3 * amp, 0, 0.18];
      b.rShoulder = [-0.55 * s * amp - 0.3 * amp, 0, -0.18];
      b.lElbow = [-1.0 - 0.3 * amp, 0, 0];
      b.rElbow = [-1.0 - 0.3 * amp, 0, 0];
    };

    switch (this.state) {
      case 'idle': {
        idleArms();
        b.spine = [0.03 + breathe, 0, 0];
        b.head = [0.05 - breathe, Math.sin(t * 0.7) * 0.15, 0];
        b.lKnee = [0.06, 0, 0];
        b.rKnee = [0.06, 0, 0];
        b.lHip = [-0.03, 0, -0.06];
        b.rHip = [-0.03, 0, 0.06];
        p.hipsY = -0.01 + breathe * 0.3;
        if (m > 0.03) {
          locomotion(m);
          runArms(m);
        }
        break;
      }
      case 'idleBall': {
        // Triple threat stance holding the ball at the hip.
        b.spine = [0.18 + breathe, 0, 0];
        b.head = [-0.05, 0, 0];
        b[R] = [-0.45, 0, -hand * 0.25];
        b[RE] = [-1.35, 0, 0];
        b[L] = [-0.4, 0, hand * 0.5];
        b[LE] = [-1.5, 0, 0];
        b.lHip = [-0.3, 0, -0.18];
        b.rHip = [-0.3, 0, 0.18];
        b.lKnee = [0.55, 0, 0];
        b.rKnee = [0.55, 0, 0];
        p.hipsY = -0.1;
        if (m > 0.03) locomotion(m);
        break;
      }
      case 'run': {
        locomotion(Math.max(0.35, m));
        runArms(Math.max(0.35, m));
        b.head = [-0.1, 0, 0];
        break;
      }
      case 'dribble': {
        const amp = Math.max(0.25, m);
        locomotion(amp);
        b.spine = [0.2 + 0.15 * amp, 0, 0];
        // Dribbling hand pumps with the ball; off hand guards.
        const pump = Math.sin(this.dribblePhase) * 0.5 + 0.5;
        b[R] = [-0.35 - pump * 0.25, 0, -hand * 0.3];
        b[RE] = [-0.55 - pump * 0.55, 0, 0];
        b[L] = [-0.6 - 0.15 * amp, 0, hand * 0.55];
        b[LE] = [-1.35, 0, 0];
        p.hipsY -= 0.04;
        break;
      }
      case 'defense': {
        const sway = Math.sin(t * 2.5) * 0.06;
        b.lHip = [-0.5, 0, -0.42];
        b.rHip = [-0.5, 0, 0.42];
        b.lKnee = [0.85, 0, 0];
        b.rKnee = [0.85, 0, 0];
        b.spine = [0.32, sway, 0];
        b.head = [-0.15, -sway, 0];
        b.lShoulder = [-0.35, 0, 1.25 + sway];
        b.rShoulder = [-0.35, 0, -1.25 + sway];
        b.lElbow = [-0.65, 0, 0];
        b.rElbow = [-0.65, 0, 0];
        p.hipsY = -0.2;
        if (m > 0.1) {
          // shuffle: smaller leg swing while staying low
          const s = Math.sin(ph * 1.4);
          b.lHip = [-0.45 - s * 0.2 * m, 0, -0.42];
          b.rHip = [-0.45 + s * 0.2 * m, 0, 0.42];
          p.hipsY = -0.17;
        }
        break;
      }
      case 'shoot': {
        // 0.95s jump shot: load, rise, release at ~0.42, follow through.
        const dur = 0.95;
        const u = Math.min(1, t / dur);
        const load = smooth(clamp01(u / 0.22));
        const rise = smooth(clamp01((u - 0.18) / 0.3));
        const follow = smooth(clamp01((u - 0.42) / 0.25));
        const jumpT = clamp01((u - 0.2) / 0.7);
        p.jump = Math.sin(jumpT * Math.PI) * 0.4;
        p.hipsY = -0.16 * load * (1 - rise) - 0.02;
        const kneeBend = 0.9 * load * (1 - rise);
        b.lKnee = [kneeBend + 0.1, 0, 0];
        b.rKnee = [kneeBend + 0.1, 0, 0];
        b.lHip = [-kneeBend * 0.5 - 0.02, 0, -0.1];
        b.rHip = [-kneeBend * 0.5 - 0.02 - 0.3 * rise, 0, 0.1];
        b.spine = [0.25 * load * (1 - rise) - 0.08 * rise, 0, 0];
        b.head = [-0.3 * rise, 0, 0];
        // Shooting arm: from set point (chest) to full extension overhead.
        const shoulderX = -0.9 - 2.1 * rise;
        b[R] = [shoulderX, 0, -hand * (0.15 - 0.1 * rise)];
        b[RE] = [-1.75 * (1 - rise) - 0.1 - 0.25 * follow, 0, 0];
        // Guide hand.
        b[L] = [-1.0 - 1.5 * rise + 0.9 * follow, 0, hand * (0.5 - 0.25 * rise)];
        b[LE] = [-1.6 * (1 - rise) - 0.2, 0, 0];
        break;
      }
      case 'layup': {
        const dur = 1.0;
        const u = Math.min(1, t / dur);
        const jumpT = clamp01((u - 0.05) / 0.85);
        p.jump = Math.sin(jumpT * Math.PI) * 0.62;
        const reach = smooth(clamp01((u - 0.1) / 0.3));
        b[R] = [-0.6 - 2.5 * reach, 0, -hand * 0.1];
        b[RE] = [-1.4 * (1 - reach) - 0.05, 0, 0];
        b[L] = [-0.6 - 0.9 * reach, 0, hand * 0.4];
        b[LE] = [-1.4, 0, 0];
        b.rHip = [-1.2 * reach - 0.1, 0, 0.1];
        b.rKnee = [1.4 * reach + 0.2, 0, 0];
        b.lHip = [0.35 * reach - 0.1, 0, -0.1];
        b.lKnee = [0.35, 0, 0];
        b.spine = [0.15, 0, -hand * 0.1 * reach];
        b.head = [-0.35 * reach, 0, 0];
        break;
      }
      case 'dunk': {
        const dur = 1.1;
        const u = Math.min(1, t / dur);
        const jumpT = clamp01((u - 0.05) / 0.85);
        p.jump = Math.sin(jumpT * Math.PI) * 0.85;
        const reach = smooth(clamp01((u - 0.08) / 0.3));
        const slam = smooth(clamp01((u - 0.42) / 0.14));
        const armX = -0.7 - 2.5 * reach + 1.1 * slam;
        b[R] = [armX, 0, -hand * 0.15];
        b[RE] = [-1.2 * (1 - reach) - 0.1 - 0.5 * slam, 0, 0];
        b[L] = [armX + 0.3, 0, hand * 0.3];
        b[LE] = [-1.2 * (1 - reach) - 0.1 - 0.5 * slam, 0, 0];
        b.rHip = [-1.1 * reach, 0, 0.12];
        b.rKnee = [1.5 * reach + 0.2, 0, 0];
        b.lHip = [-0.6 * reach, 0, -0.12];
        b.lKnee = [1.1 * reach + 0.2, 0, 0];
        b.spine = [0.3 - 0.25 * slam, 0, 0];
        b.head = [-0.4 * reach + 0.3 * slam, 0, 0];
        break;
      }
      case 'pass': {
        const dur = 0.42;
        const u = Math.min(1, t / dur);
        const push = smooth(clamp01(u / 0.45)) * (1 - smooth(clamp01((u - 0.7) / 0.3)) * 0.5);
        b.lShoulder = [-0.5 - 1.1 * push, 0, 0.35 - 0.25 * push];
        b.rShoulder = [-0.5 - 1.1 * push, 0, -0.35 + 0.25 * push];
        b.lElbow = [-1.5 * (1 - push) - 0.05, 0, 0];
        b.rElbow = [-1.5 * (1 - push) - 0.05, 0, 0];
        b.spine = [0.2 + 0.15 * push, 0, 0];
        b.lHip = [-0.25, 0, -0.14];
        b.rHip = [-0.25, 0, 0.14];
        b.lKnee = [0.45, 0, 0];
        b.rKnee = [0.45, 0, 0];
        p.hipsY = -0.08;
        if (m > 0.05) locomotion(m * 0.6);
        break;
      }
      case 'block': {
        const dur = 0.9;
        const u = Math.min(1, t / dur);
        const jumpT = clamp01((u - 0.08) / 0.8);
        p.jump = Math.sin(jumpT * Math.PI) * 0.6;
        const reach = smooth(clamp01(u / 0.25));
        b[R] = [-3.0 * reach, 0, -hand * 0.1];
        b[RE] = [-0.1, 0, 0];
        b[L] = [-1.4 * reach, 0, hand * 0.9];
        b[LE] = [-0.4, 0, 0];
        b.lKnee = [0.4 * (1 - reach) + 0.2, 0, 0];
        b.rKnee = [0.4 * (1 - reach) + 0.2, 0, 0];
        b.spine = [-0.1, 0, 0];
        b.head = [-0.4, 0, 0];
        break;
      }
      case 'steal': {
        const dur = 0.5;
        const u = Math.min(1, t / dur);
        const reach = Math.sin(u * Math.PI);
        b[R] = [-1.6 * reach - 0.2, 0, -hand * 0.3];
        b[RE] = [-0.2, 0, 0];
        b[L] = [-0.3, 0, hand * 0.9];
        b[LE] = [-0.6, 0, 0];
        b.spine = [0.4 + 0.3 * reach, 0, hand * 0.15 * reach];
        b.lHip = [-0.6, 0, -0.4];
        b.rHip = [-0.6, 0, 0.4];
        b.lKnee = [0.9, 0, 0];
        b.rKnee = [0.9, 0, 0];
        p.hipsY = -0.22;
        break;
      }
      case 'celebrate': {
        const bounce = Math.abs(Math.sin(t * 6));
        p.jump = bounce * 0.12;
        b.lShoulder = [-2.8 + Math.sin(t * 8) * 0.2, 0, 0.5];
        b.rShoulder = [-2.8 - Math.sin(t * 8) * 0.2, 0, -0.5];
        b.lElbow = [-0.4, 0, 0];
        b.rElbow = [-0.4, 0, 0];
        b.spine = [-0.15, 0, 0];
        b.head = [-0.3, 0, 0];
        b.lKnee = [0.2, 0, 0];
        b.rKnee = [0.2, 0, 0];
        break;
      }
      case 'dejected': {
        b.spine = [0.45, 0, 0];
        b.head = [0.5, 0, 0];
        b.lShoulder = [0.2, 0, 0.1];
        b.rShoulder = [0.2, 0, -0.1];
        b.lElbow = [-0.2, 0, 0];
        b.rElbow = [-0.2, 0, 0];
        b.lHip = [-0.5, 0, -0.1];
        b.rHip = [-0.5, 0, 0.1];
        b.lKnee = [0.9, 0, 0];
        b.rKnee = [0.9, 0, 0];
        p.hipsY = -0.18;
        break;
      }
      case 'catch': {
        const u = Math.min(1, t / 0.3);
        const reach = 1 - u;
        b.lShoulder = [-1.4 * reach - 0.4, 0, 0.3];
        b.rShoulder = [-1.4 * reach - 0.4, 0, -0.3];
        b.lElbow = [-0.6 - 0.8 * u, 0, 0];
        b.rElbow = [-0.6 - 0.8 * u, 0, 0];
        b.spine = [0.15, 0, 0];
        if (m > 0.05) locomotion(m);
        break;
      }
    }
    return p;
  }

  /** World position of the ball-hand anchor. */
  handWorld(target: THREE.Vector3, hand: 'r' | 'l' = this.handedness > 0 ? 'r' : 'l'): THREE.Vector3 {
    return (hand === 'r' ? this.rHand : this.lHand).getWorldPosition(target);
  }

  dispose() {
    this.jerseyTex?.dispose();
    for (const m of this.meshes) {
      m.geometry.dispose();
    }
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => v * v * (3 - 2 * v);
