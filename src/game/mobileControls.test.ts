import { describe, expect, it } from 'vitest';
import { mobileCameraDrag, normalizeMobileJoystick } from './mobileControls';

describe('mobile controls', () => {
  const bounds = { left: 20, top: 100, width: 120, height: 120 };

  it('keeps the joystick centered inside its dead zone', () => {
    expect(normalizeMobileJoystick(80, 160, bounds)).toEqual({ x: 0, y: 0 });
  });

  it('normalizes joystick input and clamps it to a unit circle', () => {
    const right = normalizeMobileJoystick(140, 160, bounds);
    const diagonal = normalizeMobileJoystick(140, 220, bounds);
    expect(right.x).toBeCloseTo(1);
    expect(right.y).toBeCloseTo(0);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
  });

  it('turns swipes into camera rotation in the expected direction', () => {
    const drag = mobileCameraDrag(20, -10);
    expect(drag.yawDelta).toBeCloseTo(-0.124);
    expect(drag.pitchDelta).toBeCloseTo(0.048);
  });
});
