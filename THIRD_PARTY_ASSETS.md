# Third-party assets

## KayKit Character Pack: Adventurers 1.0

- Creator: Kay Lousberg
- Official page: https://kaylousberg.itch.io/kaykit-adventurers
- Source archive: https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
- Pinned source revision: `672074b73ba276876a19e8816ecdc5241817ab47`
- License: CC0 1.0 Universal; commercial use, modification, and redistribution are allowed and attribution is not required.

Vendored runtime files:

- `public/assets/kaykit/knight.glb` — the free-tier `Knight.glb`, losslessly deduplicated, resampled, pruned, and sparsified with glTF Transform 4.2.1. All 76 original animation clips are retained. SHA-256: `aa5fc16f329fea3c6ee61381ce2f98253653020ae4f72be8210c3c2e78d86551`.
- `public/assets/kaykit/crossbow.glb` — the free-tier `crossbow_2handed.gltf` and its referenced files repacked into a self-contained GLB with glTF Transform 4.2.1. SHA-256: `c7008d12f9d8898c98b0738dc23cb3dadfc4505fa1cbb976735ad3c36eecd0f9`.
- `public/assets/kaykit/LICENSE.txt` — the upstream license text. SHA-256: `ae322141814056dda0deea7540d74c41d87aee1da319977cd1bd84ee5a923629`.

Runtime changes are limited to scale, animation selection, accessory visibility, faction recoloring, material response, and shadow configuration. The GLB files are served locally by the game; no third-party CDN is required at runtime.
