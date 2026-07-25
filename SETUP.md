# hawkesbay.tech — self-updating pipeline

This repo runs itself. Every morning (~7am NZ) a GitHub Action:

1. **Researches** — Claude searches the web for the day's biggest development in each
   sector and writes a full article + the "What it means for Hawke's Bay" analysis
   (`scripts/research.mjs`, updating `src/data.json`).
2. **Builds** — injects the data into the template to produce `public/index.html`
   (`scripts/build.mjs`).
3. **Deploys** — pushes it straight to the Cloudflare Worker `hawkesbay-tech`, which
   serves hawkesbay.tech.

No manual step. Change nothing to keep it running.

## One-time setup: three secrets

In this repo: **Settings → Secrets and variables → Actions → New repository secret**.
Add these three (paste the values there — they never go anywhere else):

| Secret name | What it is | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Lets the robot use Claude to write | console.anthropic.com → API keys → Create key |
| `CLOUDFLARE_API_TOKEN` | Lets it deploy to Cloudflare | Cloudflare → My Profile → API Tokens → Create Token → **"Edit Cloudflare Workers"** template |
| `CLOUDFLARE_ACCOUNT_ID` | Which Cloudflare account | `c38315fdd47e1b007b875a9f494d04e4` (also in any Cloudflare dashboard URL) |

Optional: under the **Variables** tab you can add `MODEL` to pin a specific Claude model
(otherwise it uses a sensible default).

## Running it

- It runs automatically each morning.
- To run it now: **Actions tab → Daily update → Run workflow**.
- Safety: if the research finds nothing new or errors on a sector, that sector is left
  unchanged — it never publishes broken or empty content.
