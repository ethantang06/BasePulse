from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import json
import os
from pathlib import Path
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from ai_orchestrator import process_military_data, apply_fallback_layout
from analysis_engine import analyze_state

app = FastAPI(title="AI Spatial Orchestrator")

# Enable CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)
STATE_FILE = DATA_DIR / "visualization_state.json"

# Initialize with empty FeatureCollection if it doesn't exist
if not STATE_FILE.exists():
    with open(STATE_FILE, "w") as f:
        json.dump({"type": "FeatureCollection", "features": []}, f)

class GenerationRequest(BaseModel):
    prompt: str

@app.post("/upload")
async def upload_data(file: UploadFile = File(...)):
    """Upload CSV or JSON synthetic data as context for the AI"""
    if not file.filename.endswith(('.json', '.csv', '.txt')):
        raise HTTPException(status_code=400, detail="Only JSON, CSV or TXT allowed")
    
    content = await file.read()
    file_path = DATA_DIR / f"raw_{file.filename}"
    with open(file_path, "wb") as f:
        f.write(content)
        
    return {"status": "success", "filename": file.filename, "message": "File uploaded. Ready for AI orchestration."}

@app.post("/generate")
async def generate_layout(request: GenerationRequest):
    """Trigger the AI to generate a layout based on a prompt and any uploaded data"""
    try:
        with open(STATE_FILE, "r") as f:
            previous_state = json.load(f)

        await process_military_data(request.prompt, DATA_DIR, STATE_FILE)
        with open(STATE_FILE, "r") as f:
            current_state = json.load(f)
        analysis = analyze_state(current_state)

        if not analysis["validation"]["is_valid"]:
            # Automatic deterministic fallback to guarantee usable output.
            with open(STATE_FILE, "w") as f:
                json.dump({"type": "FeatureCollection", "features": []}, f)
            apply_fallback_layout(request.prompt, STATE_FILE)
            with open(STATE_FILE, "r") as f:
                fallback_state = json.load(f)
            fallback_analysis = analyze_state(fallback_state)

            if not fallback_analysis["validation"]["is_valid"]:
                with open(STATE_FILE, "w") as f:
                    json.dump(previous_state, f)
                failed = [c["label"] for c in analysis["validation"]["checks"] if not c["ok"]]
                raise HTTPException(
                    status_code=422,
                    detail={
                        "message": "Generated layout violated deterministic constraints and fallback also failed.",
                        "failed_checks": failed,
                    },
                )
            return {
                "status": "success",
                "message": "Layout generated via deterministic fallback due constraint violations.",
                "readiness_score": fallback_analysis["readiness"]["score"],
            }

        return {
            "status": "success",
            "message": "Layout generated successfully.",
            "readiness_score": analysis["readiness"]["score"],
        }
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/state")
async def get_state():
    """Frontend polls this to get the latest visualization state"""
    if STATE_FILE.exists():
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    return {"type": "FeatureCollection", "features": []}

@app.post("/reset")
async def reset_state():
    """Reset the visualization state"""
    with open(STATE_FILE, "w") as f:
        json.dump({"type": "FeatureCollection", "features": []}, f)
    return {"status": "success", "message": "State reset"}


@app.get("/analysis")
async def get_analysis():
    """Return deterministic validation + readiness simulation over current state."""
    if STATE_FILE.exists():
        with open(STATE_FILE, "r") as f:
            state = json.load(f)
        return analyze_state(state)
    return analyze_state({"type": "FeatureCollection", "features": []})

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
