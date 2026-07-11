"use client";

import { useState, useRef } from "react";
import Papa from "papaparse";

export default function Home() {
  const [file, setFile] = useState(null);
  const [rawHeaders, setRawHeaders] = useState([]);
  const [rawRecords, setRawRecords] = useState([]);
  const [importState, setImportState] = useState("idle"); // idle | preview | importing | completed | error
  const [progress, setProgress] = useState(0);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  
  // Results
  const [importedLeads, setImportedLeads] = useState([]);
  const [skippedLeads, setSkippedLeads] = useState([]);
  const [activeTab, setActiveTab] = useState("imported"); // imported | skipped
  
  const fileInputRef = useRef(null);
  const [isDragActive, setIsDragActive] = useState(false);

  // Handles drag & drop triggers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  // Parses CSV client-side using papaparse for previewing
  const processFile = (selectedFile) => {
    if (!selectedFile.name.endsWith(".csv")) {
      setErrorMessage("Invalid file format. Please upload a valid CSV file.");
      setImportState("error");
      return;
    }

    setFile(selectedFile);
    setErrorMessage("");

    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      trimHeaders: true,
      complete: (results) => {
        if (results.errors.length > 0 && results.data.length === 0) {
          setErrorMessage("Failed to parse CSV: " + results.errors[0].message);
          setImportState("error");
          return;
        }

        setRawHeaders(results.meta.fields || []);
        setRawRecords(results.data || []);
        setImportState("preview");
      },
      error: (err) => {
        setErrorMessage("Error reading CSV file: " + err.message);
        setImportState("error");
      }
    });
  };

  // Run the batch import flow
  const startImport = async () => {
    setImportState("importing");
    setProgress(0);
    setErrorMessage("");
    
    const BATCH_SIZE = 10;
    const totalRecords = rawRecords.length;
    const chunks = [];
    
    for (let i = 0; i < totalRecords; i += BATCH_SIZE) {
      chunks.push(rawRecords.slice(i, i + BATCH_SIZE));
    }
    
    const numBatches = chunks.length;
    setTotalBatches(numBatches);
    
    let processedImported = [];
    let processedSkipped = [];
    
    const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

    for (let idx = 0; idx < numBatches; idx++) {
      setCurrentBatch(idx + 1);
      const batchRecords = chunks[idx];
      
      let success = false;
      let retries = 3;
      let batchResult = null;

      while (retries > 0 && !success) {
        try {
          const response = await fetch(`${API_URL}/api/process-batch`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              records: batchRecords,
              batchIndex: idx + 1
            })
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || `Server responded with status ${response.status}`);
          }

          batchResult = await response.json();
          success = true;
        } catch (error) {
          retries--;
          console.warn(`Batch ${idx + 1} processing failed. Retries left: ${retries}. Error:`, error);
          if (retries === 0) {
            setErrorMessage(`Failed to process batch ${idx + 1} after 3 attempts. Please verify your connection or API key.`);
            // Capture this batch as skipped
            batchRecords.forEach((r, subIdx) => {
              processedSkipped.push({
                original_index: idx * BATCH_SIZE + subIdx,
                reason: `API Error: Max retries exceeded. Details: ${error.message}`,
                data: r
              });
            });
          } else {
            // Exponential backoff wait before retry
            await new Promise(r => setTimeout(r, (3 - retries) * 1000));
          }
        }
      }

      if (success && batchResult) {
        // Append batch results
        if (batchResult.imported) {
          processedImported = [...processedImported, ...batchResult.imported];
        }
        if (batchResult.skipped) {
          // LLM skipped records
          const mappedSkipped = batchResult.skipped.map(s => {
            const originalIndex = s.original_index !== undefined ? idx * BATCH_SIZE + s.original_index : "N/A";
            return {
              original_index: originalIndex,
              reason: s.reason || "Skipped by AI mapping rules",
              data: batchRecords[s.original_index] || {}
            };
          });
          processedSkipped = [...processedSkipped, ...mappedSkipped];
        }
      }

      // Update progress bar percentage
      setProgress(Math.round(((idx + 1) / numBatches) * 100));
    }

    setImportedLeads(processedImported);
    setSkippedLeads(processedSkipped);
    setImportState("completed");
  };

  const resetImporter = () => {
    setFile(null);
    setRawHeaders([]);
    setRawRecords([]);
    setImportState("idle");
    setProgress(0);
    setCurrentBatch(0);
    setTotalBatches(0);
    setErrorMessage("");
    setImportedLeads([]);
    setSkippedLeads([]);
  };

  // Safe Date Renderer helper
  const formatDate = (dateStr) => {
    if (!dateStr) return "N/A";
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Status Badge Mapper helper
  const getStatusBadge = (status) => {
    switch (status) {
      case "GOOD_LEAD_FOLLOW_UP":
        return <span className="badge badge-success">Good Lead (Follow up)</span>;
      case "DID_NOT_CONNECT":
        return <span className="badge badge-warning">Did Not Connect</span>;
      case "BAD_LEAD":
        return <span className="badge badge-danger">Bad Lead</span>;
      case "SALE_DONE":
        return <span className="badge badge-info">Sale Done</span>;
      default:
        return <span className="badge badge-primary">{status || "Unknown"}</span>;
    }
  };

  // Data Source Badge Mapper helper
  const getSourceBadge = (source) => {
    if (!source) return <span className="badge badge-primary" style={{ opacity: 0.6 }}>No Match</span>;
    return <span className="badge badge-primary">{source}</span>;
  };

  return (
    <>
      <header className="app-header">
        <div className="logo-text">
          GrowEasy <span className="logo-badge">CSV AI-Ingester</span>
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: "0.875rem", display: "flex", gap: "1rem", alignItems: "center" }}>
          <span>API: <strong>Groq Cloud</strong></span>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--success)" }}></span>
        </div>
      </header>

      <main className="app-container">
        <div className="bg-glow-1"></div>
        <div className="bg-glow-2"></div>

        {/* Intro Hero Section */}
        <section style={{ textAlign: "center", marginBottom: "3rem" }}>
          <h1 style={{ fontSize: "2.5rem", fontWeight: "800", marginBottom: "0.75rem", color: "var(--primary)" }}>
            AI-Powered CRM Lead Ingestor
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "1.125rem", maxWidth: "600px", margin: "0 auto" }}>
            Upload any CSV format, from Facebook Leads to custom agency sheets. Our Groq AI engine will instantly map columns and clean fields for import.
          </p>
        </section>

        {/* Error Banner (only for inline non-terminal errors) */}
        {errorMessage && importState !== "importing" && importState !== "error" && (
          <div className="error-banner">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
            <div>{errorMessage}</div>
          </div>
        )}

        {/* STEP 1: Upload (Idle State) */}
        {importState === "idle" && (
          <div className="glass-card">
            <h2 className="card-title">Upload Lead Export File</h2>
            <p className="card-subtitle">Supported formats: CSV exports (.csv)</p>
            
            <div 
              className={`dropzone ${isDragActive ? "active" : ""}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={triggerFileInput}
            >
              <input 
                ref={fileInputRef}
                type="file" 
                accept=".csv" 
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
              <svg className="dropzone-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
              </svg>
              <p className="dropzone-text-main">Drag & Drop your CSV file here</p>
              <p className="dropzone-text-sub">or click to browse local files</p>
            </div>
          </div>
        )}

        {/* STEP: Error State with Reupload Capability */}
        {importState === "error" && (
          <div className="glass-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            <div className="error-banner" style={{ width: "100%", maxWidth: "600px", margin: "1rem auto 2rem" }}>
              <div className="error-banner-content">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>Ingestion Error</div>
              </div>
              <div style={{ marginTop: "0.5rem", opacity: 0.9 }}>{errorMessage}</div>
            </div>
            
            <button className="btn-primary" onClick={resetImporter}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" style={{ width: "1.25rem", height: "1.25rem", marginRight: "0.25rem" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
              </svg>
              Go Back & Reupload
            </button>
          </div>
        )}

        {/* STEP 2: Preview State */}
        {importState === "preview" && (
          <div className="glass-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <h2 className="card-title">Preview Uploaded Leads</h2>
                <p className="card-subtitle" style={{ marginBottom: 0 }}>
                  File: <strong style={{ color: "var(--primary)" }}>{file?.name}</strong> ({rawRecords.length} rows detected)
                </p>
              </div>
              <div className="flex-row-gap">
                <button className="btn-secondary" onClick={resetImporter}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={startImport}>
                  Confirm Import ({rawRecords.length} Leads)
                </button>
              </div>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
              ⚠️ Showing the first 100 rows for preview. No AI mapping has occurred yet. Press Confirm to process the full file.
            </p>

            {/* Virtualized/Preview Table */}
            <div className="table-container">
              <table className="lead-table">
                <thead>
                  <tr>
                    <th>Row #</th>
                    {rawHeaders.map((header, idx) => (
                      <th key={idx}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawRecords.slice(0, 100).map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      <td style={{ fontWeight: 600, color: "var(--text-muted)" }}>{rowIdx + 1}</td>
                      {rawHeaders.map((header, colIdx) => (
                        <td key={colIdx} title={row[header]}>
                          {row[header] || <em style={{ color: "rgba(255,255,255,0.1)" }}>empty</em>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* STEP 3: Importing (Processing State) */}
        {importState === "importing" && (
          <div className="glass-card" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div className="progress-container">
              <h2 className="progress-text pulse glow-text">AI Mapping & Validating Rows...</h2>
              <p className="progress-subtext" style={{ marginBottom: "1.5rem" }}>
                Running batch-processing on Groq Cloud Llama-3-70B model.
              </p>
              
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
              </div>
              
              <div style={{ color: "var(--primary)", fontWeight: 700, fontSize: "1.15rem" }}>
                {progress}% Complete
              </div>
              <div style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginTop: "0.5rem" }}>
                Processing Batch {currentBatch} of {totalBatches} ({Math.min(currentBatch * 10, rawRecords.length)} / {rawRecords.length} rows)
              </div>
            </div>
            
            <p style={{ color: "var(--text-muted)", fontSize: "0.825rem", textAlign: "center", maxWidth: "450px" }}>
              💡 Built-in automated retries and exponential backoff are handling API rate limits in the background. Do not close this window.
            </p>
          </div>
        )}

        {/* STEP 4: Completed State */}
        {importState === "completed" && (
          <div>
            {/* Stats Dashboard */}
            <div className="stats-grid">
              <div className="stat-card total">
                <span className="stat-value">{rawRecords.length}</span>
                <span className="stat-label">Total CSV Leads</span>
              </div>
              <div className="stat-card success">
                <span className="stat-value">{importedLeads.length}</span>
                <span className="stat-label">AI Imported Mapped Leads</span>
              </div>
              <div className="stat-card skipped">
                <span className="stat-value">{skippedLeads.length}</span>
                <span className="stat-label">Skipped Leads (Invalid/Empty)</span>
              </div>
            </div>

            <div className="glass-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
                <h2 className="card-title" style={{ margin: 0 }}>Import Summary Dashboard</h2>
                <button className="btn-primary" onClick={resetImporter}>
                  Ingest Another File
                </button>
              </div>

              {/* Tabs */}
              <div className="tabs">
                <button 
                  className={`tab ${activeTab === "imported" ? "active" : ""}`}
                  onClick={() => setActiveTab("imported")}
                >
                  Successfully Mapped ({importedLeads.length})
                </button>
                <button 
                  className={`tab ${activeTab === "skipped" ? "active" : ""}`}
                  onClick={() => setActiveTab("skipped")}
                >
                  Skipped Leads ({skippedLeads.length})
                </button>
              </div>

              {/* Tab Content: Imported */}
              {activeTab === "imported" && (
                <div>
                  {importedLeads.length === 0 ? (
                    <div className="text-center" style={{ padding: "3rem", color: "var(--text-secondary)" }}>
                      No leads were successfully mapped and imported. Check if columns were empty.
                    </div>
                  ) : (
                    <div className="table-container">
                      <table className="lead-table">
                        <thead>
                          <tr>
                            <th>Created At</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Mobile</th>
                            <th>Company</th>
                            <th>CRM Status</th>
                            <th>Data Source</th>
                            <th>City / State</th>
                            <th>Owner</th>
                            <th>Possession Time</th>
                            <th>Description</th>
                            <th>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importedLeads.map((lead, idx) => (
                            <tr key={idx}>
                              <td>{formatDate(lead.created_at)}</td>
                              <td style={{ fontWeight: 700, color: "var(--primary)" }}>{lead.name || "—"}</td>
                              <td>{lead.email || "—"}</td>
                              <td>
                                {lead.country_code ? `${lead.country_code} ` : ""}
                                {lead.mobile_without_country_code || "—"}
                              </td>
                              <td>{lead.company || "—"}</td>
                              <td>{getStatusBadge(lead.crm_status)}</td>
                              <td>{getSourceBadge(lead.data_source)}</td>
                              <td>
                                {lead.city || lead.state 
                                  ? `${lead.city || ""}${lead.city && lead.state ? ", " : ""}${lead.state || ""}` 
                                  : "—"}
                              </td>
                              <td>{lead.lead_owner || "—"}</td>
                              <td>{lead.possession_time || "—"}</td>
                              <td title={lead.description} style={{ maxWidth: "200px" }}>
                                {lead.description || "—"}
                              </td>
                              <td title={lead.crm_note} style={{ maxWidth: "200px", color: "var(--primary-hover)" }}>
                                {lead.crm_note || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Tab Content: Skipped */}
              {activeTab === "skipped" && (
                <div>
                  {skippedLeads.length === 0 ? (
                    <div className="text-center" style={{ padding: "3rem", color: "var(--text-secondary)" }}>
                      Excellent! 0 rows were skipped.
                    </div>
                  ) : (
                    <div className="table-container">
                      <table className="lead-table">
                        <thead>
                          <tr>
                            <th>Row #</th>
                            <th>Original Index</th>
                            <th>Reason for Skipping</th>
                            <th>Raw Record Data Snippet</th>
                          </tr>
                        </thead>
                        <tbody>
                          {skippedLeads.map((lead, idx) => (
                            <tr key={idx}>
                              <td style={{ fontWeight: 600 }}>{idx + 1}</td>
                              <td style={{ color: "var(--text-muted)" }}>{lead.original_index}</td>
                              <td style={{ color: "var(--danger)", fontWeight: 500 }}>{lead.reason}</td>
                              <td style={{ fontFamily: "monospace", fontSize: "0.75rem", opacity: 0.8 }} title={JSON.stringify(lead.data)}>
                                {JSON.stringify(lead.data)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        )}

      </main>

      <footer style={{ marginTop: "auto", borderTop: "1px solid var(--border-color)", padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
        © {new Date().getFullYear()} GrowEasy AI CRM Ingestion Engine. All rights reserved. Created for groweasy.ai assessment.
      </footer>
    </>
  );
}
