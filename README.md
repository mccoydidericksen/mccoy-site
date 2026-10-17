# mccoydidericksen.github.io

Personal site: one static page, no build step, no tracking.

## Deploy (GitHub Pages, ~2 minutes)

1. Create a public repo named exactly `mccoydidericksen.github.io`, push this folder to `main`.
2. Repo Settings > Pages > Source: Deploy from a branch, `main`, `/ (root)`.
3. It is live at https://mccoydidericksen.github.io within a minute. Add that URL to your GitHub profile, LinkedIn contact info, and the "Other website" field on applications.

Custom domain later: buy `mccoy.dev` or similar, add a `CNAME` file containing the domain, point the DNS at GitHub Pages.

## Edit

Everything is in `index.html`. Sections, top to bottom: hero, shelf (projects), ledger (work), nightstand (reading), footer. The spines are links; adjust `.spine` classes (`tall`, `short`, `thin`, `s-*` colors) to change the shelf.

## TODO

- [ ] Replace the Claude Code toolchain and cost-audit spine links with real URLs once the write-ups exist (both currently point at the GitHub profile).
- [ ] Decide what bookrot links to while it is being rebuilt (the spine points at bookrot.app).
- [ ] Add an `og:image` (a screenshot of the shelf works) so links unfurl nicely on LinkedIn.
- [ ] Optional: a small "field notes" section for short posts, if you start writing.
