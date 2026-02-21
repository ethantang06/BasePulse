from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import json
import os
from pathlib import Path
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from ai_orchestrator import process_military_data

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
        # We will pass the request to the orchestrator
        # The orchestrator uses tools to build the visualization_state.json
        result_state = await process_military_data(request.prompt, DATA_DIR, STATE_FILE)
        return {"status": "success", "message": "Layout generated successfully."}
    except Exception as e:
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

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
