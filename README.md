# LinkedIn Connection Scraper

Web app to **connect LinkedIn** → **search connections** → **scrape profiles**.

## Run everything with Docker

Starts **app + MongoDB** together.

1. Put keys in `.env` (same folder):

```env
ANTHROPIC_API_KEY=your-claude-key
# optional
OPENAI_API_KEY=
```

2. Start Docker Desktop, then:

```powershell
cd "c:\Gisul\fund scrapper\linkdin scrapper"
docker compose up -d --build
```

Or:

```powershell
npm run docker:up
```

3. Open **http://localhost:6363**

4. Click **Connect LinkedIn**. Chromium runs *inside Docker*, so it will not pop up on Windows. Sign in in the viewer on the page, or open **http://localhost:6080**. Session is stored in the `app_auth` volume.

Useful commands:

```powershell
npm run docker:logs    # app logs
npm run docker:down    # stop all
```

Notes:
- Playwright uses a virtual display (Xvfb) plus noVNC on port **6080** so you can see Chromium and complete LinkedIn login (including 2FA).
- Product knowledge mounts from `./knowledge`.
- Data persists in Docker volumes: Mongo, `.auth`, `output`, `data`.

## Local MongoDB only

Scrapes, profiles, and operator user records are stored in MongoDB.

```bash
# Start Mongo (requires Docker Desktop running)
npm run mongo:up
```

Collections:

| Collection | Purpose |
|------------|---------|
| `users` | Operator / LinkedIn connect status |
| `profiles` | Scraped LinkedIn connection details + AI match + message status |
| `scrape_jobs` | Full scrape job history, logs, filters |

APIs: `GET /api/results`, `GET /api/jobs`, `GET /api/users`

## Quick start

```bash
npm install
copy .env.example .env
npm run mongo:up
npm start
```

Open **http://localhost:6363**

1. **Connect LinkedIn** — browser opens; sign in there
2. **Search & scrape** — pick connection type, keywords, start scrape

## Storage

| Data | Path |
|------|------|
| LinkedIn session | `.auth/local/linkedin-session.json` |
| Profiles / jobs / users | MongoDB (`linkedin_scrapper`) |
| Excel export | `output/local/` |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `6363` | Web server port |
| `HEADLESS` | `false` | Keep `false` so LinkedIn search works reliably |
| `ACTION_DELAY_MS` | `3000` | Delay between profile visits |

## Deploy (Docker)

```bash
docker build -t linkedin-scrapper .
docker run -p 6363:6363 -p 6080:6080 \
  -e HEADLESS=false \
  -e IN_DOCKER=true \
  -v linkedin-auth:/app/.auth \
  -v linkedin-output:/app/output \
  linkedin-scrapper
```

LinkedIn connect in Docker uses the noVNC viewer on port **6080**. Locally (`npm start`), Chromium opens on this machine.

## CLI (optional)

```bash
npm run login    # LinkedIn sign-in only
npm run scrape   # scrape from command line
```
