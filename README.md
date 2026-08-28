# SMITE KNIGHT — Ashen Siege

Оригинальная браузерная castle-siege action game на Three.js. Проведите таран к Чёрным вратам, прорвитесь во внутренний двор и победите лорда Варгрима.

## Запуск

```powershell
npm install
npm run dev
```

Клиент: `http://127.0.0.1:5173`, игровой сервер: `http://127.0.0.1:3018`.

## Проверка

```powershell
npm run check
npm test
npm run build
npm start
```

## Управление

- `WASD` — движение
- мышь — камера
- `ЛКМ` — удар; удерживать для серии атак
- `ПКМ` — блок
- `Space` — перекат
- `Shift` — бег
- `C` — сменить плечо камеры
- `Enter` — чат в сетевой комнате
- `Esc` — пауза

Персонажи используют локально поставляемые KayKit GLB, а тематические декорации пяти уровней — локально
сгенерированные и оптимизированные GLB из `public/assets/generated/`. Во время игры внешние CDN не нужны.
Источники и лицензия персонажей описаны в `THIRD_PARTY_ASSETS.md`, а воспроизводимые промпты и параметры
декораций — в `GENERATED_ASSETS.md`.

## Production

Production-домен: `https://smite.xedoc.ru`. Node.js слушает только `127.0.0.1:3018`; внешний HTTPS и WebSocket upgrade обслуживает Nginx. Конфигурации находятся в `deploy/`.
