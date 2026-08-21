"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import type { ViewerMode } from "../components/ToolpathViewer";
import { DEMO_FILENAME, DEMO_SBP } from "../lib/demo";
import { CUTTER_PRESETS, DEFAULT_CONFIG, STOCK_PRESETS } from "../lib/presets";
import type { AnalysisConfig, AnalysisIssue, AnalysisResult, CutterPreset, Severity, StockConfig } from "../lib/sbp";
import AnalyzerWorker from "../workers/analyzer.worker?worker";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ToolpathViewer = dynamic(
  () => import("../components/ToolpathViewer").then((module) => module.ToolpathViewer),
  { ssr: false, loading: () => <div className="viewer-loading">Preparing 3D view…</div> },
);

function formatExtent(min: number, max: number): string {
  return `${min.toFixed(2)} → ${max.toFixed(2)} in`;
}

function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "—";
  if (totalSeconds < 60) return `${Math.ceil(totalSeconds)} sec`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  return hours ? `${hours} hr ${minutes} min` : `${minutes} min`;
}

function statusFor(result: AnalysisResult | null): { label: string; severity: Severity } {
  if (!result) return { label: "Waiting", severity: "info" };
  if (!result.complete) return { label: "Incomplete", severity: "error" };
  if (result.issues.some((item) => item.severity === "error")) return { label: "Stop", severity: "error" };
  if (result.issues.some((item) => item.severity === "warning")) return { label: "Review", severity: "warning" };
  return { label: "Ready", severity: "pass" };
}

function issueSymbol(issue: AnalysisIssue): string {
  if (issue.severity === "error") return "×";
  if (issue.severity === "warning") return "!";
  if (issue.severity === "pass") return "✓";
  return "i";
}

function updateNumber(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function ShopbotApp() {
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const [config, setConfig] = useState<AnalysisConfig>(DEFAULT_CONFIG);
  const [filename, setFilename] = useState(DEMO_FILENAME);
  const [sourceText, setSourceText] = useState(DEMO_SBP);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [viewerMode, setViewerMode] = useState<ViewerMode>("orbit");

  useEffect(() => {
    const worker = new AnalyzerWorker();
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ id: number; result?: AnalysisResult; error?: string }>) => {
      if (event.data.id !== requestRef.current) return;
      setBusy(false);
      if (event.data.error) {
        setError(event.data.error);
        setResult(null);
      } else if (event.data.result) {
        setError(null);
        setResult(event.data.result);
      }
    };
    worker.onerror = () => {
      setBusy(false);
      setError("The analyzer stopped unexpectedly. Reload the page and try the file again.");
    };
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!workerRef.current || !sourceText) return;
      requestRef.current += 1;
      setBusy(true);
      workerRef.current.postMessage({ id: requestRef.current, filename, text: sourceText, config });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [config, filename, sourceText]);

  const reviewIssues = result?.issues.filter((item) => item.severity !== "pass") ?? [];
  const selected = result?.issues.find((item) => item.id === selectedIssue) ?? null;
  const status = statusFor(result);
  const selectedLine = selected?.line ?? null;
  const effectiveCutterName = result?.metadata.toolName ?? config.cutter.name;
  const issueCounts = useMemo(() => {
    const counts = { error: 0, warning: 0, info: 0, pass: 0 };
    result?.issues.forEach((item) => { counts[item.severity] += 1; });
    return counts;
  }, [result]);

  const loadFile = async (file: File) => {
    setDragging(false);
    setSelectedIssue(null);
    if (!file.name.toLowerCase().endsWith(".sbp")) {
      setError("Choose a ShopBot part file ending in .sbp.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("This first version supports SBP files up to 20 MB.");
      return;
    }
    setError(null);
    setFilename(file.name);
    setSourceText(await file.text());
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  const chooseCutter = (id: string) => {
    const preset = CUTTER_PRESETS.find((item) => item.id === id);
    if (preset) setConfig((current) => ({ ...current, cutter: preset }));
  };

  const updateCutter = (patch: Partial<CutterPreset>) => {
    setConfig((current) => ({
      ...current,
      cutter: { ...current.cutter, ...patch, id: "custom", name: "Custom cutter", source: "Operator-entered" },
    }));
  };

  const chooseStock = (material: string) => {
    const preset = STOCK_PRESETS.find((item) => item.material === material);
    if (preset) setConfig((current) => ({ ...current, stock: preset }));
  };

  const updateStock = (patch: Partial<StockConfig>) => {
    setConfig((current) => ({ ...current, stock: { ...current.stock, ...patch } }));
  };

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="https://eastbaymakersclub.com/" target="_blank" rel="noreferrer">
          <Image src="/ebmc-mark.png" alt="East Bay Makers Club" width={40} height={40} priority />
          <span className="brand-copy"><strong>ShopBot Check</strong><small>East Bay Makers Club</small></span>
        </a>
        <div className="header-meta">
          <span className="privacy-pill"><i /> Files stay in your browser</span>
          <span className="machine-pill">PRSalpha 96 × 48</span>
        </div>
      </header>

      <section className="intro-row">
        <div>
          <p className="eyebrow">OpenSBP preflight</p>
          <h1>See the cut before the machine does.</h1>
          <p className="intro-copy">Inspect toolpaths, machine bounds, setup commands, and cutting loads before an SBP file reaches the shop floor.</p>
        </div>
        <div className="file-actions">
          <label
            className={`file-drop ${dragging ? "is-dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input type="file" accept=".sbp" onChange={onFileInput} />
            <span className="upload-icon">↑</span>
            <span><strong>Drop an .SBP file</strong><small>or choose from your computer</small></span>
          </label>
          <button className="demo-button" onClick={() => { setFilename(DEMO_FILENAME); setSourceText(DEMO_SBP); setSelectedIssue(null); }}>Reload synthetic demo</button>
        </div>
      </section>

      {error && <div className="error-banner" role="alert"><strong>Couldn’t analyze this file.</strong><span>{error}</span></div>}

      <section className={`workspace ${busy ? "is-busy" : ""}`}>
        <article className="viewport-panel">
          <div className="panel-heading">
            <div className="filename-block">
              <p className="eyebrow">Toolpath</p>
              <h2 title={filename}>{filename}</h2>
              {busy && <small>Analyzing locally…</small>}
            </div>
            <div className="view-controls" aria-label="Toolpath view">
              {(["orbit", "top", "machine"] as ViewerMode[]).map((mode) => (
                <button key={mode} className={viewerMode === mode ? "active" : ""} onClick={() => setViewerMode(mode)}>
                  {mode === "machine" ? "Machine" : mode[0].toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="toolpath-stage">
            <ToolpathViewer result={result} config={config} selectedLine={selectedLine} mode={viewerMode} />
            <div className="stage-legend">
              <span><i className="legend-cut" /> Cutting move</span>
              <span><i className="legend-jog" /> Jog move</span>
              <span><i className="legend-alert" /> Violation / selected</span>
            </div>
            <div className="stage-stats">
              <span>{result?.stats.moveCount.toLocaleString() ?? "—"}<small>moves</small></span>
              <span>{result?.stats.arcCount.toLocaleString() ?? "—"}<small>arcs</small></span>
              <span>{formatDuration(result?.stats.estimatedSeconds ?? 0)}<small>estimated</small></span>
            </div>
          </div>

          <div className="bounds-strip">
            <div><small>X extent</small><strong>{result ? formatExtent(result.bounds.minX, result.bounds.maxX) : "—"}</strong></div>
            <div><small>Y extent</small><strong>{result ? formatExtent(result.bounds.minY, result.bounds.maxY) : "—"}</strong></div>
            <div><small>Z extent</small><strong>{result ? formatExtent(result.bounds.minZ, result.bounds.maxZ) : "—"}</strong></div>
            <div className={result && (result.bounds.minX < 0 || result.bounds.minY < 0) ? "origin-shift" : ""}>
              <small>Allowed table-base zero</small>
              <strong>{result ? `X ${result.zeroRange.x.min.toFixed(2)}…${result.zeroRange.x.max.toFixed(2)} · Y ${result.zeroRange.y.min.toFixed(2)}…${result.zeroRange.y.max.toFixed(2)}` : "—"}</strong>
            </div>
          </div>
        </article>

        <aside className="review-panel">
          <div className="review-heading">
            <div><p className="eyebrow">Preflight review</p><h2>{reviewIssues.length ? `${reviewIssues.length} ${reviewIssues.length === 1 ? "item" : "items"} to review` : "No issues detected"}</h2></div>
            <span className={`status-badge ${status.severity}`}>{status.label}</span>
          </div>

          <div className={`score-card ${result?.complete ? "" : "incomplete"}`}>
            <div className="score-ring">{result?.score ?? "—"}</div>
            <div>
              <strong>{result?.complete ? "Static analysis complete" : "Analysis incomplete"}</strong>
              <small>{result ? `${result.lineCount.toLocaleString()} lines · ${result.unknownCommands.length} unknown constructs` : "Waiting for a file"}</small>
            </div>
            <div className="count-pills"><span className="error">{issueCounts.error}</span><span className="warning">{issueCounts.warning}</span></div>
          </div>

          <div className="issue-list" aria-label="Analysis findings">
            {result?.issues.map((item) => (
              <button
                key={item.id}
                className={`issue ${item.severity} ${selectedIssue === item.id ? "selected" : ""}`}
                onClick={() => setSelectedIssue(selectedIssue === item.id ? null : item.id)}
                aria-expanded={selectedIssue === item.id}
              >
                <span className="issue-symbol">{issueSymbol(item)}</span>
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                <em>{item.category.replace("-", " ")}</em>
              </button>
            ))}
          </div>

          {selected && (
            <div className="issue-detail">
              <div><span>{selected.line ? `Line ${selected.line}` : "Finding details"}</span><button aria-label="Close finding details" onClick={() => setSelectedIssue(null)}>×</button></div>
              <p>{selected.detail}</p>
              {selected.source && <code>{selected.source}</code>}
              {selected.recommendation && <strong>{selected.recommendation}</strong>}
            </div>
          )}

          <details className="configuration" open>
            <summary>Job setup <span>Adjust</span></summary>
            <div className="setup-fields">
              <label className="wide"><span>Cutter preset</span><select value={config.cutter.id} onChange={(event) => chooseCutter(event.target.value)}><option value="custom">Custom cutter</option>{CUTTER_PRESETS.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label>
              <label><span>Diameter (in)</span><input type="number" min="0.01" step="0.001" value={config.cutter.diameter} onChange={(event) => updateCutter({ diameter: updateNumber(event.target.value, config.cutter.diameter) })} /></label>
              <label><span>Flutes</span><input type="number" min="1" max="8" step="1" value={config.cutter.flutes} onChange={(event) => updateCutter({ flutes: Math.max(1, Math.round(updateNumber(event.target.value, config.cutter.flutes))) })} /></label>
              <label className="wide"><span>Stock material</span><select value={config.stock.material} onChange={(event) => chooseStock(event.target.value)}>{STOCK_PRESETS.map((preset) => <option value={preset.material} key={preset.id}>{preset.name}</option>)}</select></label>
              <label><span>Thickness (in)</span><input type="number" min="0.01" step="0.001" value={config.stock.thickness} onChange={(event) => updateStock({ thickness: updateNumber(event.target.value, config.stock.thickness) })} /></label>
              <label><span>Z zero</span><select value={config.stock.zOrigin} onChange={(event) => updateStock({ zOrigin: event.target.value as StockConfig["zOrigin"] })}><option value="top">Stock surface</option><option value="table">Table surface</option></select></label>
              <label><span>Stock X (in)</span><input type="number" min="0.01" step="0.1" value={config.stock.width} onChange={(event) => updateStock({ width: updateNumber(event.target.value, config.stock.width) })} /></label>
              <label><span>Stock Y (in)</span><input type="number" min="0.01" step="0.1" value={config.stock.height} onChange={(event) => updateStock({ height: updateNumber(event.target.value, config.stock.height) })} /></label>
              <label><span>Table-base X zero</span><input type="number" step="0.01" value={config.workOffset.x} onChange={(event) => setConfig((current) => ({ ...current, workOffset: { ...current.workOffset, x: updateNumber(event.target.value) } }))} /></label>
              <label><span>Table-base Y zero</span><input type="number" step="0.01" value={config.workOffset.y} onChange={(event) => setConfig((current) => ({ ...current, workOffset: { ...current.workOffset, y: updateNumber(event.target.value) } }))} /></label>
            </div>
            <div className="detected-settings">
              <span><small>Using stock</small><strong>{result ? `${result.effectiveStock.thickness.toFixed(3)}″ ${result.effectiveStock.material}` : config.stock.material}</strong></span>
              <span><small>Using cutter</small><strong>{effectiveCutterName}</strong></span>
              <span><small>File speed</small><strong>{result?.stats.maxFeedIpm ? `${result.stats.maxFeedIpm.toFixed(0)} ipm @ ${(result.stats.rpm ?? 0).toLocaleString()} RPM` : "Not detected"}</strong></span>
              <span><small>Cut model</small><strong>{result ? `${result.stats.maxPassDepth.toFixed(3)}″ max pass · ${result.stats.maximumDepth.toFixed(3)}″ total` : "Not detected"}</strong></span>
            </div>
          </details>
        </aside>
      </section>

      <section className="safety-note">
        <strong>Preflight aid, not a safety guarantee.</strong>
        <span>Fixtures, workholding, cutter condition, tool stick-out, and the physical machine still require an operator check.</span>
        <a href="https://shopbottools.com/wp-content/uploads/2024/01/FeedsandSpeeds.pdf" target="_blank" rel="noreferrer">ShopBot feeds & speeds reference ↗</a>
      </section>

      <footer>
        <span>Built for safer, more confident making.</span>
        <a href="https://github.com/eastbaymakersclub/shopbot-check" target="_blank" rel="noreferrer">Open source · East Bay Makers Club ↗</a>
      </footer>
    </main>
  );
}
