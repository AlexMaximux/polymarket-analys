# POLYMARKET PULSE — SPEC 5 (VISUAL REDESIGN)

**EXISTING working app** at current dir (Next.js 15 + Tailwind v4, dark dashboard: `/`, `/users`, `/users/[wallet]`, `/leaderboard`, `/markets`, crawler + API routes). ALL functionality, routes, data, and tests must be preserved. This is a **UI/visual-only round** — surgical styling changes, zero logic changes.

## Known defects to FIX (from real screenshot audit)
1. **White band bug**: `src/app/globals.css` sets `--background:#ffffff` + Arial font while `layout.tsx` sets `bg-zinc-950` on body → a jarring pure-white strip appears around page headings with black text. Unify: ONE dark theme system, no light-mode vars fighting the classes. Remove the Arial override; keep Geist/Inter.
2. **Near-invisible nav links** (dark gray on near-black) — must be clearly readable, with active-route highlight.
3. **Filter inputs dark-on-dark** — placeholder/value text unreadable. Fix input styling (visible borders, proper text color, focus ring).
4. **Table columns look empty** — data text renders too low-contrast. Fix cell colors; add `tabular-nums` + right-align for all numeric columns so digits align vertically.
5. **Barely-visible row separators** — strengthen borders, add zebra striping or hover states.
6. **Floating "N" dev button overlaps content** — that's Next dev indicator, ignore (dev-only), do NOT try to remove from prod.

## New visual system (make it GORGEOUS — this is a trading-terminal-style data product)
- **Palette**: deep navy-ink base (e.g. `#0B1120` body, `#111827`/`#1E2939` surfaces), electric cyan-blue primary accent (`#38BDF8`), emerald for positive/money (`#34D399`), rose for negative (`#FB7185`), amber for warnings. Consistent 3-tier surface elevation (page → card → inset) with subtle borders (`rgba(148,163,184,.12)`).
- **Typography**: Inter/Geist sans for UI; `font-variant-numeric: tabular-nums` on ALL numbers; clear scale (page title 2xl semibold, section headers lg medium, labels xs uppercase tracking-wide muted).
- **Cards/KPIs**: dashboard stat cards with soft gradient accent border-top or glow icon, big tabular numbers, muted captions.
- **Tables**: sticky header with backdrop blur, rounded card container with border, row hover highlight, colored pill badges for BUY (emerald) / SELL (rose), wallet/name links cyan with hover underline, money right-aligned tabular.
- **Nav bar**: sticky, backdrop-blur, brand with small pulse glyph, links with hover + active state (accent underline or pill).
- **Filters bar**: styled as inset card; inputs with visible border + focus ring accent; labels above; compact responsive grid.
- **Micro-touches**: subtle transitions (150ms), skeleton/empty states styled, scrollbar styled for dark, selection color, smooth page feel. NO animation libraries, NO external UI packages, NO CDN fonts — Tailwind v4 + CSS only.
- Light mode: NOT required — ship a single polished dark theme (remove the prefers-color-scheme light vars entirely so the white-band class of bug can't recur).

## Pages to restyle (keep structure/data flow identical)
`/` (KPI cards + live feed table), `/users` (filters + table + pagination), `/users/[wallet]` (profile stat grid + positions + activity), `/leaderboard` (window switcher + table), `/markets` if present. Shared: `layout.tsx` header/nav, `globals.css` design tokens.

## QUALITY GATES — nothing may regress
1. `npm run build` → zero errors.
2. `npx vitest run` → ALL existing tests still pass (no test edits needed for styling; if any test asserts old class names, update ONLY the assertion).
3. Dev server: `/`, `/users`, `/leaderboard` return 200 and contain the same data bindings as before (grep for `total_notional`, `max_single_bet`, `formatDistanceToNow` usage preserved).
4. `grep -n "prefers-color-scheme" src/app/globals.css` → no light-mode background override remains.
5. No new dependencies in package.json.
