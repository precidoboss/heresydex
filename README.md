# HERESY DEX

Swap, bridge and track tokens on **The Grotto** (Avalanche L1) and move value to Avalanche C-Chain.
Static site — no build step, no backend.

- `index.html` — app (Swap · Bridge · Portfolio)
- `docs.html` — documentation
- `assets/css/` — `base.css` (tokens/nav/forms), `app.css` (app UI), `docs.css`
- `assets/js/` — `config.js` (chains, tokens, contracts) → `core.js` → … → `main.js`

## Run locally
```bash
npx serve .      # or: python3 -m http.server 8080
```

## Add a token
Create the WHERESY pair, register it on the router with `setPool()`, then add an entry to `TOKENS` in `assets/js/config.js`. Menus, markets, charts, portfolio and the docs table update automatically.

See `docs.html` for the full guide.
