import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENERATED_PROP_LAYOUTS } from './generatedProps';

describe('generated level props', () => {
  it('gives every campaign environment its thematic models', () => {
    expect(Object.keys(GENERATED_PROP_LAYOUTS)).toEqual(['ash', 'frost', 'verdant', 'foundry', 'eclipse']);
    expect(GENERATED_PROP_LAYOUTS.ash).toHaveLength(4);
    for (const environment of ['frost', 'verdant', 'foundry', 'eclipse'] as const) {
      expect(GENERATED_PROP_LAYOUTS[environment]).toHaveLength(3);
    }
  });

  it('uses unique ids and ships every referenced GLB 2.0 asset', () => {
    const placements = Object.values(GENERATED_PROP_LAYOUTS).flat();
    expect(new Set(placements.map(({ id }) => id)).size).toBe(placements.length);

    for (const placement of placements) {
      expect(placement.height).toBeGreaterThan(0);
      expect(placement.url).toMatch(/^\/assets\/generated\/.+\.glb$/);
      const assetPath = resolve('public', placement.url.slice(1));
      expect(existsSync(assetPath), placement.url).toBe(true);
      const header = readFileSync(assetPath).subarray(0, 12);
      expect(header.toString('ascii', 0, 4), placement.url).toBe('glTF');
      expect(header.readUInt32LE(4), placement.url).toBe(2);
      expect(header.readUInt32LE(8), placement.url).toBe(readFileSync(assetPath).byteLength);
    }
  });
});
