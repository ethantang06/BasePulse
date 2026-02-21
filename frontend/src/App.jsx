import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import MapRenderer from './components/MapRenderer';
import { Upload, Play, RefreshCw, Layers } from 'lucide-react';
import './index.css';

const API_BASE = 'http://localhost:8000';

function App() {
  const [layoutState, setLayoutState] = useState(null);
  const [prompt, setPrompt] = useState("Design a forward operating base with a 500m perimeter. Include a command zone in the center, and a logistics cluster of 50 supply trucks nearby.");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const fileInputRef = useRef(null);

  // Poll for state updates every 2 seconds
  useEffect(() => {
    const fetchState = async () => {
      try {
        const res = await axios.get(`${API_BASE}/state`);
        setLayoutState(res.data);
      } catch (err) {
        console.error("Error fetching state:", err);
      }
    };

    fetchState();
    const interval = setInterval(fetchState, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus('');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post(`${API_BASE}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setUploadStatus(res.data.message);
    } catch (err) {
      setUploadStatus(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      await axios.post(`${API_BASE}/generate`, { prompt });
    } catch (err) {
      console.error("Generation failed:", err);
      alert("AI Generation failed. Check backend logs.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = async () => {
    try {
      await axios.post(`${API_BASE}/reset`);
      setLayoutState(null);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar Panel */}
      <div className="control-panel glass-panel">
        <div className="header">
          <Layers className="icon brand" />
          <h1>Nexus AI Orchestrator</h1>
        </div>

        <div className="section">
          <h3>1. Ingest Data</h3>
          <p className="subtitle">Upload synthetic intel (JSON/CSV) for AI context.</p>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            accept=".json,.csv,.txt"
          />
          <button
            className="btn outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            <Upload className="icon small" />
            {isUploading ? 'Uploading...' : 'Upload Data File'}
          </button>
          {uploadStatus && <div className="status-text">{uploadStatus}</div>}
        </div>

        <div className="section">
          <h3>2. Instruct AI</h3>
          <p className="subtitle">Describe the spatial layout requirements.</p>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={5}
            className="prompt-input"
            placeholder="e.g. Deploy 5 ammo caches and secure the perimeter."
          />

          <div className="actions">
            <button
              className="btn primary"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? <RefreshCw className="icon small spin" /> : <Play className="icon small" />}
              {isGenerating ? 'Orchestrating...' : 'Generate Layout'}
            </button>
            <button className="btn danger outline-danger" onClick={handleReset}>
              Reset Map
            </button>
          </div>
        </div>

        <div className="section stats">
          <h3>Live View State</h3>
          <div className="stat-row">
            <span>Features Rendered:</span>
            <span className="accent">{layoutState?.features?.length || 0}</span>
          </div>
          <div className="stat-row">
            <span>Last Sync:</span>
            <span>{new Date().toLocaleTimeString()}</span>
          </div>
        </div>
      </div>

      {/* Map Rendering Area */}
      <div className="map-container">
        {layoutState ? (
          <MapRenderer data={layoutState} />
        ) : (
          <div className="loading-map">Initializing Engine...</div>
        )}
      </div>
    </div>
  );
}

export default App;
