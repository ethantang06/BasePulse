import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import MapRenderer from './components/MapRenderer';
import { Upload, Play, RefreshCw, Layers } from 'lucide-react';
import './index.css';

const API_BASE = 'http://localhost:8000';

function App() {
  const [layoutState, setLayoutState] = useState(null);
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [prompt, setPrompt] = useState(
    "Design a forward operating base with a 700m perimeter around 33.3, 44.2. Define high, medium, and low security zones. Place a command HQ, field hospital, barracks, and drone hangar as facilities. Add generator, battery, and solar power assets, connect them with power links, and create internal road/convoy routes."
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const fileInputRef = useRef(null);

  const featureSummary = useMemo(() => {
    const features = layoutState?.features || [];
    const counts = {};
    for (const f of features) {
      const t = f?.properties?.type || 'unknown';
      counts[t] = (counts[t] || 0) + 1;
    }
    const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return { total: features.length, ordered };
  }, [layoutState]);

  const readiness = useMemo(() => {
    const counts = Object.fromEntries(featureSummary.ordered);
    const perimeter = counts.perimeter || 0;
    const zones = counts.zone || 0;
    const facilities = counts.facility || 0;
    const powerAssets = counts.power_asset || 0;
    const routes = counts.route || 0;
    const powerLinks = counts.power_link || 0;

    const structureScore = Math.min(100, (
      Math.min(perimeter, 1) * 18 +
      Math.min(zones, 4) * 8 +
      Math.min(facilities, 6) * 7 +
      Math.min(powerAssets, 4) * 10 +
      Math.min(routes, 4) * 8 +
      Math.min(powerLinks, 4) * 8
    ));

    const criticalFacilityBonus = Math.min(15, facilities >= 4 ? 15 : facilities * 3);
    const resilienceBonus = Math.min(12, Math.max(powerAssets, 0) + Math.max(powerLinks - 1, 0));
    const score = Math.min(100, Math.round(structureScore + criticalFacilityBonus + resilienceBonus));

    const level = score >= 85 ? 'Mission Ready' : score >= 65 ? 'Operationally Viable' : 'At Risk';
    return { score, level };
  }, [featureSummary]);

  const validations = useMemo(() => {
    const counts = Object.fromEntries(featureSummary.ordered);
    return [
      { label: 'Base perimeter present', ok: (counts.perimeter || 0) >= 1 },
      { label: 'At least 3 zones', ok: (counts.zone || 0) >= 3 },
      { label: 'At least 4 facilities', ok: (counts.facility || 0) >= 4 },
      { label: 'At least 2 power assets', ok: (counts.power_asset || 0) >= 2 },
      { label: 'At least 2 routes', ok: (counts.route || 0) >= 2 },
      { label: 'At least 2 power links', ok: (counts.power_link || 0) >= 2 },
    ];
  }, [featureSummary]);

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
      const res = await axios.get(`${API_BASE}/state`);
      setLayoutState(res.data);
      setRecenterSignal(v => v + 1);
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
      const res = await axios.get(`${API_BASE}/state`);
      setLayoutState(res.data);
      setRecenterSignal(v => v + 1);
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
          <h3>Readiness</h3>
          <div className="readiness-card">
            <div className="readiness-score">{readiness.score}%</div>
            <div className="readiness-label">{readiness.level}</div>
            <div className="readiness-track">
              <div className="readiness-fill" style={{ width: `${readiness.score}%` }} />
            </div>
          </div>
        </div>

        <div className="section stats">
          <h3>Validation Panel</h3>
          <div className="validation-list">
            {validations.map((item) => (
              <div className="validation-row" key={item.label}>
                <span className={item.ok ? 'validation-pass' : 'validation-fail'}>
                  {item.ok ? 'PASS' : 'FAIL'}
                </span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="section stats">
          <h3>Live View State</h3>
          <div className="stat-row">
            <span>Features Rendered:</span>
            <span className="accent">{featureSummary.total}</span>
          </div>
          <div className="stat-row">
            <span>Last Sync:</span>
            <span>{new Date().toLocaleTimeString()}</span>
          </div>
          <div className="feature-breakdown">
            {featureSummary.ordered.length === 0 ? (
              <div className="breakdown-empty">No features yet</div>
            ) : (
              featureSummary.ordered.map(([type, count]) => {
                const width = Math.max(8, Math.round((count / featureSummary.total) * 100));
                return (
                  <div key={type} className="breakdown-row">
                    <div className="breakdown-label">
                      <span>{type}</span>
                      <span>{count}</span>
                    </div>
                    <div className="breakdown-bar-track">
                      <div className="breakdown-bar-fill" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Map Rendering Area */}
      <div className="map-container">
        {layoutState ? (
          <MapRenderer data={layoutState} recenterSignal={recenterSignal} />
        ) : (
          <div className="loading-map">Initializing Engine...</div>
        )}
      </div>
    </div>
  );
}

export default App;
