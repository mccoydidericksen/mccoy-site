# mccoy-site

Personal site. Astro, static output, hosted on Vercel, visits counted with PostHog.

```bash
npm install
npm run dev            # http://localhost:4321
npm run build          # dist/
```

## Pages

- `/` hero, Camp Forecast cards, Scruple demos, work ledger, nightstand (`src/pages/index.astro`)
- `/scruple` case study (`src/pages/scruple/index.astro`)
- `/scruple/shortage`, `/scruple/board` the Scruple demos, served with Scruple's own styles plus a "back" pill (`src/pages/scruple/[demo].astro`)

## Camp Forecast

`src/components/CampForecast.astro` links to https://campforecast.com (source in the private basecamp-mcp
repo). The card previews copy the example trip sheet on that site's landing page; keep them in step.

## Scruple demos

The demo HTML and data are copied from the private rxledger repo, because Vercel can't read it at
build time. The shortage data refreshes daily over there; here it is a snapshot, so resync now and then:

```bash
npm run sync:scruple   # reads ../rxledger/site/public, rewrites paths to /scruple/*, fails on any miss
```

After a resync, check the board's headline numbers still match `src/components/ScrupleDemos.astro`.

## Analytics

`src/components/Analytics.astro` loads PostHog when `PUBLIC_POSTHOG_KEY` is set (Vercel env var, then
redeploy). No key, no tracking. Turn on session replay in the PostHog project settings. The shortage
check's input and results carry `ph-no-capture`, so replays never record a visitor's product list.

To see which application led to a visit, share links with a UTM tag, e.g. `https://mccoydid.dev/?utm_source=acme`.
PostHog stores it on the person as `$initial_utm_source`.

## Env

- `PUBLIC_POSTHOG_KEY` project key (`phc_...`, safe in client code)
- `PUBLIC_POSTHOG_HOST` default `https://us.i.posthog.com`
- `SITE_URL` canonical origin, default `https://mccoydid.dev`

## TODO

- [ ] Bring back a Projects section once the Claude Code toolchain and cost-audit write-ups have somewhere to link.
- [ ] Link the basecamp-mcp repo from the Camp Forecast cards once it is public.
- [ ] Add an `og:image` so links unfurl nicely on LinkedIn.
