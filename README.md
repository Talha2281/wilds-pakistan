# Wild Pakistan – The Last Wilderness

**Play Live on GitHub Pages:** https://talha2281.github.io/wilds-pakistan/  
**GitHub Repository:** https://github.com/Talha2281/wilds-pakistan

**Wild Pakistan – The Last Wilderness** is a free, browser-based 3D WebGL wildlife survival, anti-poaching Ranger Patrol, and wildlife Photo Safari conservation game set across five iconic Pakistani ecosystems. Built with Three.js, React, TypeScript, Tailwind CSS, procedural Web Audio synthesis, Supabase, Firebase Google Sheets feedback integration, and offline-ready PWA support.

---

## Key Features

### 1. Three Distinct Game Modes (1–2 Minute Action Rounds + Sector Progression)
- **Wild Life**: Survive across procedural sectors as a **Snow Leopard**, **Markhor**, **Himalayan Brown Bear**, or **Indus River Dolphin**. Grow from **Cub -> Juvenile -> Adult**, collect 5 Spirit Orbs per sector, hunt or forage, and advance to fresh missions in subsequent rounds while carrying your XP and score forward.
  - **Markhor**: Hill Leap (`Space`), Horn Charge (`F`) to counter attacking predators & gain an escape speed boost, and winter/summer altitude migration.
  - **Snow Leopard**: Automated Prey Pounce, Sprint, and mountain ambush stealth.
  - **Himalayan Brown Bear**: Ground Slam stun (`Space`) and Thunder Roar (`F`).
  - **Indus River Dolphin**: Breach Jump (`Space`) over illegal *Jaal* fishing nets or Deep Dive (`F`) underneath while managing oxygen.
- **Ranger Patrol**: Patrol as a Pakistan Wildlife Service Ranger equipped with the **3-Slot Ranger Toolkit**:
  - `[1] Binoculars`: 4.5x zoom to scout poachers, snares, and injured wildlife at range (+65 score).
  - `[2] Camera`: Log poacher evidence & wildlife sightings to boost Conservation %.
  - `[3] Tranq Dart`: Sedate poachers, arrest them up close, rescue caged animals, and dismantle illegal snares.
  - Includes live WebSocket **Co-op Squads** (Rangers & Wildlife Packs).
- **Photo Safari**: Non-violent 3D wildlife photography mode where predators remain calm.
  - **Rarity × Quality Scoring**: Multiplies species rarity (**Common 100 · Rare 220 · Legendary 400 pts**) by frame quality (**S-Rank 2.0× · A-Rank 1.5× · B-Rank 1.1× · C-Rank 0.7×**), plus **1.5× Action Pose**, **2× Species of the Day**, and **Rotating Field Challenges**.
  - **Telephoto & Call**: Toggle `2.2×` Telephoto (`F`), press Wildlife Call (`E`) for portrait poses, snap real JPEG album photos, and submit totals to the shared leaderboard.

### 2. Five Expanded Pakistani Biomes (>= 350m Playable Radius)
1. **Northern Mountains** *(Karakoram & Hunza)* – Snow peaks, pine ridges, Markhor & Snow Leopards.
2. **Deosai Plateau** *(Skardu)* – High-altitude plains, golden marmots & Himalayan Brown Bears.
3. **Ziarat Juniper Forest** *(Balochistan)* – Ancient juniper woodlands & winter valley migrations.
4. **Indus River Reserve** *(Sukkur)* – Freshwater channels & sandbars for the endangered Indus River Dolphin.
5. **Thar Desert Sanctuary** *(Sindh)* – Sand dunes, oasis waterholes, chinkara & wild peacocks.

### 3. Conservation Meter, Daily Expeditions & Bilingual UI
- **Conservation Meter**: Poachers lower each biome's Conservation %, while rescues, arrests, and wildlife photography raise it toward the **Thriving Sanctuary**, **Recovering Reserve**, or **Fragile Frontier** endings.
- **Daily Expedition & Weekly Challenges**: Deterministic daily UTC seed shared worldwide plus Species of the Day spotlight.
- **English & Urdu (اردو)**: Instant one-tap language switch across the landing page, game setup, and HUD.
- **Installable PWA**: Install directly on Android, iOS Safari, or desktop for offline play.

### 4. Free Ranger Accounts, Shared Leaderboards & Google Sheets Feedback
- **Mandatory Secure Login & Free Database Accounts**: Players register/log in instantly with Email & Password (powered by **Supabase PostgreSQL `pgcrypto` bcrypt RPCs** — zero confirmation emails, Express server `scrypt` & WebCrypto fallbacks), automatically gating wilderness entry and syncing XP, coat skins, and callsigns.
- **Shared Hall of Rangers**: All-Time, Daily, and Weekly leaderboards persisted to Supabase (`leaderboard_entries`).
- **Post-Game Feedback Popup -> Google Sheets**: Automatically prompts after an expedition finishes, saving ratings and comments to Supabase (`player_feedback`) and appending rows directly to a linked **Google Sheet** via the official Google Sheets v4 API.

### 5. SEO, AEO & GEO Optimization
- Semantic OpenGraph & Twitter Cards (`index.html`, `game/index.html`) with dynamic canonical resolution.
- Schema.org JSON-LD `@graph` (`WebSite`, `VideoGame`, `WebApplication`, `BreadcrumbList`, and 7-question `FAQPage`).
- AI crawler knowledge file at [`public/llms.txt`](public/llms.txt), image-enabled [`public/sitemap.xml`](public/sitemap.xml), and [`public/robots.txt`](public/robots.txt).

---

## Local Development & Setup

### Prerequisites
- Node.js `>= 20`
- Optional: Free [Supabase](https://supabase.com) project for cloud auth, profiles, feedback, and global leaderboards.

### Install & Run
```bash
npm install
cp .env.example .env
npm run dev
```
The full-stack Express + Vite + WebSocket co-op server runs on `http://localhost:3000`.

### Supabase Database Setup
Run [`supabase/schema.sql`](supabase/schema.sql) inside your Supabase SQL Editor to provision:
- `public.leaderboard_entries`
- `public.player_profiles`
- `public.player_feedback`

Add your `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `.env` (or repository environment variables).

### Testing, Linting & Production Build
```bash
npm run lint    # TypeScript type-check (tsc --noEmit)
npm test        # Run simulation, scoring, feedback & SEO smoke tests
npm run build   # Build static production assets into dist/
npm start       # Serve production build via Express + WebSocket server
```

---

## GitHub Actions & Deployment
This repository includes [`.github/workflows/ci.yml`](.github/workflows/ci.yml) which:
1. Installs dependencies cleanly (`npm ci` or `npm install`), runs `npm run lint`, `npm test`, and `npm run build`.
2. Captures Playwright headless desktop screenshots on pull requests/pushes.
3. Deploys the compiled static bundle to **GitHub Pages** on pushes to `main` / `master`.

---

## Project Structure
```text
├── index.html                  # Landing entry point (SEO, JSON-LD, OpenGraph)
├── game/index.html             # 3D Game entry point
├── server.ts                   # Express API (leaderboard, auth, feedback), WS co-op, Vite SSR dev middleware
├── supabase/schema.sql         # PostgreSQL tables & RLS policies
├── public/
│   ├── llms.txt                # AI Engine / GEO knowledge summary
│   ├── sitemap.xml             # Search & image sitemap
│   └── robots.txt              # Crawler directives
├── src/
│   ├── audio/soundEngine.ts    # Dynamic procedural biome & species Web Audio synthesizer
│   ├── components/             # AuthModal, FeedbackModal, FieldGuide, PhotoAlbum, TouchControls, Tutorial
│   ├── data/                   # animals, biomes, auth, feedback, googleAuthSheets, records, progression
│   ├── game/WildScene.ts       # Three.js 3D renderer, animals, weather, lighting & snapshot capture
│   ├── pages/                  # LandingPage.tsx & GamePage.tsx
│   └── sim/worldSim.ts         # Authoritative game simulation, physics & collision separation
└── tests/smoke.test.ts         # Automated simulation, scoring, feedback & SEO verification suite
```
