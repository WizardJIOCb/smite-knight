export interface ControlBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MobileVector {
  x: number;
  y: number;
}

export function normalizeMobileJoystick(clientX: number, clientY: number, bounds: ControlBounds, deadZone = 0.1): MobileVector {
  const radius = Math.max(1, Math.min(bounds.width, bounds.height) * 0.36);
  const rawX = (clientX - bounds.left - bounds.width / 2) / radius;
  const rawY = (clientY - bounds.top - bounds.height / 2) / radius;
  const length = Math.hypot(rawX, rawY);
  if (length <= deadZone) return { x: 0, y: 0 };
  const scale = length > 1 ? 1 / length : 1;
  return { x: rawX * scale, y: rawY * scale };
}

export function mobileCameraDrag(deltaX: number, deltaY: number): { yawDelta: number; pitchDelta: number } {
  return {
    yawDelta: -deltaX * 0.0062,
    pitchDelta: -deltaY * 0.0048,
  };
}
