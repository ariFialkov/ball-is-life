import * as THREE from 'three';
import { HALF_L, RIM_H, RIM_X } from './constants.ts';

export type CameraMode = '2k' | 'broadcast' | 'cinematic' | 'showcase' | 'contest';

/** Smooth camera controller with 2K-style and broadcast framing. */
export class CameraRig {
  mode: CameraMode = '2k';
  private pos = new THREE.Vector3(0, 8, 20);
  private look = new THREE.Vector3(0, 1, 0);
  private targetPos = new THREE.Vector3();
  private targetLook = new THREE.Vector3();
  private cineShot = 0;
  private cineTime = 0;
  private cineSeed = 0;
  shake = 0;
  /** +1 when the offense attacks the +x basket. */
  attackDir: 1 | -1 = 1;
  private portrait = false;

  constructor(private camera: THREE.PerspectiveCamera) {}

  snap() {
    this.pos.copy(this.targetPos);
    this.look.copy(this.targetLook);
  }

  /**
   * @param focus the ball position
   * @param dt frame time
   */
  update(dt: number, focus: THREE.Vector3, t: number) {
    this.portrait = window.innerWidth < window.innerHeight;
    switch (this.mode) {
      case '2k':
        this.update2k(focus);
        break;
      case 'broadcast':
        this.updateBroadcast(focus);
        break;
      case 'cinematic':
        this.updateCinematic(focus, dt, t);
        break;
      case 'showcase':
        this.targetPos.set(focus.x + Math.sin(t * 0.12) * 2.5, 1.7, 6.4 + Math.cos(t * 0.1) * 0.6);
        this.targetLook.set(focus.x, 1.25, 0);
        break;
      case 'contest':
        this.targetPos.set(focus.x - this.attackDir * 7.5, 3.2, focus.z * 0.5 + 4.2);
        this.targetLook.set(this.attackDir * RIM_X - this.attackDir * 1.5, RIM_H - 0.8, 0);
        break;
    }
    const k = this.mode === 'cinematic' ? Math.min(1, dt * 1.6) : Math.min(1, dt * 4.5);
    this.pos.lerp(this.targetPos, k);
    this.look.lerp(this.targetLook, Math.min(1, dt * 6));
    this.camera.position.copy(this.pos);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 0.6);
    }
    this.camera.lookAt(this.look);
  }

  private update2k(focus: THREE.Vector3) {
    const dir = this.attackDir;
    // Camera sits behind the offense, looking down court at the attacking basket.
    const behind = this.portrait ? 13.5 : 11.5;
    const height = this.portrait ? 8.5 : 6.6;
    const bx = THREE.MathUtils.clamp(focus.x, -HALF_L, HALF_L);
    // Camera x trails the ball but stops moving forward near the basket so the hoop stays framed.
    const camX = THREE.MathUtils.clamp(bx - dir * behind, -HALF_L - 6, HALF_L + 6);
    const limitedX = dir > 0 ? Math.min(camX, RIM_X - behind - 1.5) : Math.max(camX, -RIM_X + behind + 1.5);
    this.targetPos.set(limitedX, height, focus.z * 0.35);
    this.targetLook.set(bx + dir * 4.0, 1.6, focus.z * 0.55);
  }

  private updateBroadcast(focus: THREE.Vector3) {
    const bx = THREE.MathUtils.clamp(focus.x, -HALF_L, HALF_L);
    this.targetPos.set(bx * 0.55, this.portrait ? 11 : 8.5, this.portrait ? 24 : 19.5);
    this.targetLook.set(bx * 0.8, 1.2, focus.z * 0.3);
  }

  private updateCinematic(focus: THREE.Vector3, dt: number, t: number) {
    this.cineTime += dt;
    if (this.cineTime > 5.5) {
      this.cineTime = 0;
      this.cineShot = (this.cineShot + 1) % 5;
      this.cineSeed = Math.random();
      this.snapCine(focus);
    }
    const u = this.cineTime;
    switch (this.cineShot) {
      case 0: // Low baseline dolly.
        this.targetPos.set(this.attackDir * (HALF_L + 2.5), 0.9, -6 + u * 2.2);
        this.targetLook.set(focus.x, 1.4, focus.z);
        break;
      case 1: // High crane.
        this.targetPos.set(focus.x * 0.5 - 4 + u, 11 - u * 0.5, 16 - u * 1.4);
        this.targetLook.set(focus.x, 1.0, focus.z);
        break;
      case 2: // Close trailing cam.
        this.targetPos.set(focus.x - this.attackDir * 4.5, 2.2, focus.z + 3.5 - u * 0.4);
        this.targetLook.set(focus.x, 1.5, focus.z);
        break;
      case 3: // Hoop cam.
        this.targetPos.set(this.attackDir * (RIM_X + 1.2), RIM_H + 1.4, 2.4 - u * 0.6);
        this.targetLook.set(focus.x, 1.2, focus.z);
        break;
      default: // Sideline slow push.
        this.targetPos.set(focus.x * 0.6 + (this.cineSeed - 0.5) * 6, 3.6, 12.5 - u * 0.8);
        this.targetLook.set(focus.x, 1.3, focus.z);
    }
    void t;
  }

  private snapCine(focus: THREE.Vector3) {
    this.updateCinematic(focus, 0, 0);
    this.pos.copy(this.targetPos);
    this.look.copy(this.targetLook);
  }

  /** Converts a screen-space movement vector into a world-space xz direction. */
  moveToWorld(mx: number, my: number, out: THREE.Vector3) {
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    out.set(0, 0, 0).addScaledVector(right, mx).addScaledVector(fwd, my);
    return out;
  }
}
