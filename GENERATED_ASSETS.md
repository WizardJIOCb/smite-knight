# Generated environment assets

The static environment models in `public/assets/generated/` were generated locally on 2026-08-28 with
Microsoft TRELLIS text-base through Needle Mesh Baker WebMCP, then reduced and baked into self-contained
GLB 2.0 files. No generated asset contains a rig or animation.

All prompts used 10 geometry steps and 10 surface steps. Unless noted otherwise, the bake used a 512 px
PBR atlas, fast UV packing, the automatic GPU backend, and voxel topology repair.

| File | Seed | Triangle budget | Prompt |
| --- | ---: | ---: | --- |
| `ashen-brazier.glb` | 4282026 | 6,000 | A black iron medieval siege brazier, square stone base, four clawed legs, wide metal fire bowl, glowing orange runes, dark fantasy, weathered metal and stone, stylized low-poly game asset |
| `ashen-siege-ram.glb` | 4282102 | 8,000 | A medieval four-wheeled siege engine, long horizontal oak battering beam ending in a black iron dragon head, heavy timber frame, armored leather roof canopy, dark fantasy, weathered stylized game asset |
| `ashen-war-banner.glb` | 4282103 | 4,500 | A single medieval war banner on a tall black iron pole, torn crimson cloth with a glowing orange sun rune, spiked metal finial, dark fantasy, weathered stylized game asset |
| `frost-ice-totem.glb` | 4282201 | 6,000 | A single ancient ice totem, tall carved blue crystal monolith bound with dark iron rings, glowing cyan runes, jagged frozen base, medieval dark fantasy, stylized game asset |
| `frost-prison-cage.glb` | 4282202 | 6,000 | A single medieval prisoner cage made from thick black iron bars, frosted chains, spiked circular roof, heavy locked door, icy stone base, dark fantasy, weathered stylized game asset |
| `frost-sacrificial-altar.glb` | 4282203 | 10,000 | A single ancient frost altar, broad carved stone table covered with blue ice, chained crystal skull centerpiece, glowing cyan runes, sharp frozen steps, dark fantasy, stylized game asset |
| `verdant-root-arch.glb` | 4282302 | 8,000 | A freestanding open fantasy doorway arch, wide empty passage framed by two twisted tree trunks and mossy stones, thorn vines curling over the top, faint green runes, dark forest, stylized game asset |
| `verdant-moss-knight-statue.glb` | 4282303 | 7,500 | A single ancient stone statue of a kneeling armored knight holding a sword point-down, cracked helmet, overgrown moss and thorn vines, square ruined pedestal, dark fantasy, stylized game asset |
| `verdant-thorn-obelisk.glb` | 4282304 | 6,500 | A single tall black stone obelisk wrapped tightly in huge thorny roots, cracked emerald crystal heart, glowing green runes, jagged mossy base, corrupted forest dark fantasy, stylized game asset |
| `foundry-magma-crucible.glb` | 4282401 | 7,000 | A single gigantic black iron foundry crucible on a reinforced stone base, overflowing orange molten metal, heavy chains and rivets, heat-cracked surface, industrial dark fantasy, stylized game asset |
| `foundry-gear-mechanism.glb` | 4282402 | 7,000 | A single medieval foundry machine with three interlocking iron gears, thick axle, riveted brass housing and stone mounting base, orange heat glowing through cracks, industrial dark fantasy, stylized game asset |
| `foundry-forge-relic.glb` | 4282404 | 5,000 | A classic heavy blacksmith anvil alone, long pointed horn, flat rectangular steel face, square base, dark forged iron, subtle glowing orange runes, weathered medieval fantasy, stylized game asset |
| `eclipse-void-portal.glb` | 4282501 | 8,000 | A freestanding circular dark stone portal, wide open center filled with black purple void energy, jagged obsidian frame, floating rune shards, glowing violet cracks, dark fantasy, stylized game asset |
| `eclipse-dark-throne.glb` | 4282502 | 7,500 | A single monumental dark king throne, tall pointed obsidian backrest, black iron armrests, purple velvet seat, skull and crescent decorations, glowing violet runes, dark fantasy, stylized game asset |
| `eclipse-rune-column.glb` | 4282503 | 14,000 | A single tall ruined obsidian column, faceted black stone shaft, floating broken crown pieces, glowing violet runes spiraling upward, crescent moon carving, jagged base, dark fantasy, stylized game asset |

The generated mesh sometimes interpreted a requested object more loosely than the prompt. Files are named
for their accepted in-game role after visual review rather than claiming an exact semantic match to every
word of the prompt. `eclipse-rune-column.glb` retained a higher budget because its thin crown fragments did
not satisfy the automatic geometric quality gate at lower budgets; it was accepted after multi-angle visual
inspection.
