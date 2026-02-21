import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import MapRenderer from './components/MapRenderer';
import { Upload, Play, RefreshCw, Layers } from 'lucide-react';
import './index.css';

const API_BASE = 'http://localhost:8000';

function App() {
  const [layoutState, setLayoutState] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [prompt, setPrompt] = useState(
    "Design a forward operating base with a 700m perimeter around 33.3, 44.2. Define high, medium, and low security zones. Place a command HQ, field hospital, barracks, and drone hangar as facilities. Add generator, battery, and solar power assets, connect them with power links, and create internal road/convoy routes."
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [generationStatus, setGenerationStatus] = useState('');
  const [scenarioPreset, setScenarioPreset] = useState('Grid Outage');
  const [gridConnected, setGridConnected] = useState(false);
  const [weatherStress, setWeatherStress] = useState(35);
  const [threatStress, setThreatStress] = useState(30);
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

  const validations = analysis?.validation?.checks || [];

  useEffect(() => {
    if (scenarioPreset === 'Grid Outage') {
      setGridConnected(false);
      setWeatherStress(45);
      setThreatStress(35);
    } else if (scenarioPreset === 'Severe Weather') {
      setGridConnected(false);
      setWeatherStress(80);
      setThreatStress(25);
    } else if (scenarioPreset === 'Cyber-Physical Attack') {
      setGridConnected(false);
      setWeatherStress(30);
      setThreatStress(85);
    } else if (scenarioPreset === 'Normal Grid Ops') {
      setGridConnected(true);
      setWeatherStress(15);
      setThreatStress(10);
    }
  }, [scenarioPreset]);

  const scenarioAdjusted = useMemo(() => {
    const sim = analysis?.simulation || {};
    const baseCoverage = Number(sim.critical_coverage_pct || 0);
    const baseAutonomy = Number(sim.fuel_autonomy_hours || 0);
    const baseExposure = Number(sim.grid_dependency_exposure_pct || 0);
    const redundancy = Number(sim.redundancy_pct || 0);

    const weatherPenalty = weatherStress * 0.22;
    const threatPenalty = threatStress * 0.2;
    const outagePenalty = gridConnected ? 0 : 12;
    const coverage = Math.max(0, Math.min(100, baseCoverage - weatherPenalty - threatPenalty * 0.25));
    const autonomy = Math.max(0, baseAutonomy - weatherStress * 0.08 - threatStress * 0.04);
    const exposure = Math.max(
      0,
      Math.min(100, (gridConnected ? baseExposure * 0.45 : baseExposure + outagePenalty + threatStress * 0.1))
    );
    const scoreRaw =
      0.4 * coverage +
      0.25 * Math.min(100, (autonomy / 72) * 100) +
      0.2 * redundancy +
      0.15 * (100 - exposure);
    const score = Math.max(0, Math.min(100, scoreRaw));

    const label = score >= 85 ? 'Mission Ready' : score >= 65 ? 'Operationally Viable' : 'At Risk';
    return { coverage, autonomy, exposure, redundancy, score, label };
  }, [analysis, gridConnected, weatherStress, threatStress]);

  const riskFactors = useMemo(() => {
    const risks = [];
    if (!gridConnected) {
      risks.push({ title: 'Commercial Grid Outage', score: Math.round(scenarioAdjusted.exposure), detail: 'Islanded operations active.' });
    }
    if (scenarioAdjusted.autonomy < 24) {
      risks.push({ title: 'Low Fuel/Battery Autonomy', score: Math.round(100 - (scenarioAdjusted.autonomy / 24) * 100), detail: `Autonomy only ${scenarioAdjusted.autonomy.toFixed(1)}h.` });
    }
    if (scenarioAdjusted.coverage < 90) {
      risks.push({ title: 'Critical Load Coverage Gap', score: Math.round(100 - scenarioAdjusted.coverage), detail: `${scenarioAdjusted.coverage.toFixed(1)}% critical coverage.` });
    }
    if (scenarioAdjusted.redundancy < 60) {
      risks.push({ title: 'Insufficient Redundancy', score: Math.round(100 - scenarioAdjusted.redundancy), detail: `${scenarioAdjusted.redundancy.toFixed(1)}% redundant critical assets.` });
    }
    for (const v of validations) {
      if (!v.ok) {
        risks.push({ title: `Validation Failure: ${v.label}`, score: 80, detail: 'Deterministic constraint violation.' });
      }
    }
    return risks.sort((a, b) => b.score - a.score).slice(0, 5);
  }, [gridConnected, scenarioAdjusted, validations]);

  // Poll for state updates every 2 seconds
  useEffect(() => {
    const fetchState = async () => {
      try {
        const res = await axios.get(`${API_BASE}/state`);
        setLayoutState(res.data);
        const a = await axios.get(`${API_BASE}/analysis`);
        setAnalysis(a.data);
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
    setGenerationStatus('');
    try {
      const g = await axios.post(`${API_BASE}/generate`, { prompt });
      setGenerationStatus(g?.data?.message || 'Layout generated.');
      const res = await axios.get(`${API_BASE}/state`);
      setLayoutState(res.data);
      const a = await axios.get(`${API_BASE}/analysis`);
      setAnalysis(a.data);
      setRecenterSignal(v => v + 1);
    } catch (err) {
      console.error("Generation failed:", err);
      const msg = err?.response?.data?.detail;
      if (msg?.failed_checks) {
        alert(`Generation rejected by validation:\n- ${msg.failed_checks.join('\n- ')}`);
      } else {
        alert("AI Generation failed. Check backend logs.");
      }
      setGenerationStatus('Generation failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = async () => {
    try {
      await axios.post(`${API_BASE}/reset`);
      const res = await axios.get(`${API_BASE}/state`);
      setLayoutState(res.data);
      const a = await axios.get(`${API_BASE}/analysis`);
      setAnalysis(a.data);
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
          <h1>BasePulse</h1>
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
          <h3>Scenario Stress Test</h3>
          <p className="subtitle">Apply disruption assumptions without regenerating geometry.</p>
          <select
            value={scenarioPreset}
            onChange={(e) => setScenarioPreset(e.target.value)}
            className="prompt-input"
            style={{ minHeight: 'auto', marginBottom: '10px' }}
          >
            <option>Grid Outage</option>
            <option>Severe Weather</option>
            <option>Cyber-Physical Attack</option>
            <option>Normal Grid Ops</option>
          </select>
          <label className="stat-row">
            <span>Commercial Grid Connected</span>
            <input type="checkbox" checked={gridConnected} onChange={(e) => setGridConnected(e.target.checked)} />
          </label>
          <label className="stat-row">
            <span>Weather Stress</span>
            <span>{weatherStress}%</span>
          </label>
          <input type="range" min="0" max="100" value={weatherStress} onChange={(e) => setWeatherStress(Number(e.target.value))} />
          <label className="stat-row">
            <span>Threat Stress</span>
            <span>{threatStress}%</span>
          </label>
          <input type="range" min="0" max="100" value={threatStress} onChange={(e) => setThreatStress(Number(e.target.value))} />
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
          {generationStatus && <div className="status-text">{generationStatus}</div>}
        </div>

        <div className="section stats">
          <h3>Readiness</h3>
          <div className="readiness-card">
            <div className="readiness-score">{scenarioAdjusted.score.toFixed(1)}%</div>
            <div className="readiness-label">{scenarioAdjusted.label}</div>
            <div className="readiness-track">
              <div className="readiness-fill" style={{ width: `${scenarioAdjusted.score}%` }} />
            </div>
          </div>
        </div>

        <div className="section stats">
          <h3>Validation Panel</h3>
          <div className="validation-list">
            {validations.map((item) => (
              <div className="validation-row" key={item.id || item.label}>
                <span className={item.ok ? 'validation-pass' : 'validation-fail'}>
                  {item.ok ? 'PASS' : 'FAIL'}
                </span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="section stats">
          <h3>Top Risk Factors</h3>
          <div className="validation-list">
            {riskFactors.length === 0 ? (
              <div className="breakdown-empty">No major risks detected.</div>
            ) : (
              riskFactors.map((r) => (
                <div className="validation-row" key={r.title}>
                  <span className="validation-fail">{r.score}</span>
                  <span>{r.title}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="section stats">
          <h3>72h Simulation</h3>
          <div className="stat-row">
            <span>Critical Coverage:</span>
            <span className="accent">{scenarioAdjusted.coverage.toFixed(1)}%</span>
          </div>
          <div className="stat-row">
            <span>Fuel Autonomy:</span>
            <span className="accent">{scenarioAdjusted.autonomy.toFixed(1)}h</span>
          </div>
          <div className="stat-row">
            <span>Grid Exposure:</span>
            <span className="accent">{scenarioAdjusted.exposure.toFixed(1)}%</span>
          </div>
          <div className="stat-row">
            <span>Critical Load:</span>
            <span className="accent">{analysis?.simulation?.critical_load_kw ?? 0} kW</span>
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
