import type { App } from '../app/app.ts';
import type { Input, InputSource } from '../engine/input.ts';

/** Local co-op needs a desktop and at least one controller (P2 can use the keyboard). */
export function coopAvailable(app: App): boolean {
  return !app.mobile && app.input.pads.length >= 1;
}

/**
 * Which devices drive each player. Two or more controllers: one each (the keyboard also works for P1).
 * One controller: one player on it, the other on the keyboard (`swap` flips who gets which).
 */
export function coopDevices(input: Input, swap: boolean): [InputSource[], InputSource[]] {
  const pads = input.pads;
  if (pads.length >= 2) return swap ? [[pads[1], 'kb'], [pads[0]]] : [[pads[0], 'kb'], [pads[1]]];
  if (pads.length === 1) return swap ? [['kb'], [pads[0]]] : [[pads[0]], ['kb']];
  return [['kb'], []];
}

/** "CONTROLLER 1" / "KEYBOARD" for a player's devices. */
export function devicesLabel(input: Input, srcs: InputSource[]): string {
  const pad = srcs.find((s) => s !== 'kb');
  if (pad === undefined) return 'KEYBOARD';
  return `CONTROLLER ${input.pads.indexOf(pad as number) + 1}`;
}
