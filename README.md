# BasePulse

BasePulse is an AI-assisted planning tool for forward operating base layout design with deterministic energy-readiness analysis.

It generates structured spatial layouts (perimeter, zones, facilities, power assets, routes, power links), validates them against hard constraints, and computes a 72-hour readiness profile.

## What It Does

- Uses an LLM for **layout generation only** (tool-based structured output).
- Uses deterministic code for:
  - layout validation
  - readiness scoring
  - risk factor analysis
  - 72-hour simulation metrics
- Renders an interactive Deck.gl map and live analytics dashboard.

## Repo Structure

- `backend/` FastAPI API + orchestration + deterministic analysis
- `frontend/` React/Vite UI + Deck.gl map renderer

## Prerequisites

- Python 3.11+ (3.12 recommended)
- Node.js 18+ and npm
- Anthropic API key

## Environment Variables

Create `backend/.env`:

```env
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_MODEL=claude-sonnet-4-5
```

## Run Locally

### 1) Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

### 2) Frontend

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open: `http://127.0.0.1:5173`

## API Endpoints

- `POST /upload` upload `.json/.csv/.txt` context files
- `POST /generate` generate + validate + score layout
- `GET /state` current GeoJSON state
- `GET /analysis` deterministic readiness/validation output
- `POST /reset` clear current state

## Validation + Safety

- LLM output is validated against deterministic constraints.
- Invalid generated layouts are rejected.
- Deterministic fallback can produce a minimal valid layout when needed.
- `.env` files are git-ignored to prevent secret leakage.

## Demo Flow (2 minutes)

1. Click `Generate Layout`.
2. Show map + `Validation Panel`.
3. Show `Readiness` and `72h Simulation`.
4. Change `Scenario Stress Test` preset/sliders.
5. Show `Top Risk Factors` reprioritizing in real time.

## Troubleshooting

- If map says `Initializing Engine...`:
  - ensure backend is running on `127.0.0.1:8000`
  - verify `GET /state` responds
- If generate fails:
  - check backend terminal logs
  - verify Anthropic API key/model in `backend/.env`
