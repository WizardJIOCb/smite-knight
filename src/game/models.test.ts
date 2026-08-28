import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface GlbDocument {
  animations?: Array<{ name?: string }>;
  nodes?: Array<{ name?: string }>;
}

function readGlbDocument(relativePath: string): GlbDocument {
  const buffer = readFileSync(resolve(relativePath));
  expect(buffer.toString('utf8', 0, 4)).toBe('glTF');
  const jsonLength = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as GlbDocument;
}

describe('KayKit runtime assets', () => {
  it('ships the animation clips used by every knight role', () => {
    const document = readGlbDocument('public/assets/kaykit/knight.glb');
    const animationNames = new Set(document.animations?.map((animation) => animation.name));
    expect([...animationNames]).toEqual(expect.arrayContaining([
      'Idle',
      'Running_A',
      'Running_B',
      '1H_Melee_Attack_Slice_Diagonal',
      '2H_Melee_Attack_Spin',
      '2H_Ranged_Shoot',
      'Blocking',
      'Death_A',
      'Death_B',
    ]));
  });

  it('ships the detailed weapon and shield attachment nodes', () => {
    const knight = readGlbDocument('public/assets/kaykit/knight.glb');
    const crossbow = readGlbDocument('public/assets/kaykit/crossbow.glb');
    const knightNodes = new Set(knight.nodes?.map((node) => node.name));
    const crossbowNodes = new Set(crossbow.nodes?.map((node) => node.name));
    expect(knightNodes.has('1H_Sword')).toBe(true);
    expect(knightNodes.has('2H_Sword')).toBe(true);
    expect(knightNodes.has('Rectangle_Shield')).toBe(true);
    expect(knightNodes.has('Spike_Shield')).toBe(true);
    expect(crossbowNodes.has('crossbow_2handed')).toBe(true);
  });
});
