import { useState, useCallback, useRef } from 'react'
import { convertKicad9to8, detectVersion } from './lib/converter'
import './App.css'

function App() {
  const [files, setFiles] = useState([])
  const [results, setResults] = useState(null)
  const [converting, setConverting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [activeTab, setActiveTab] = useState('log') // 'log' | 'preview'
  const fileInputRef = useRef(null)

  const handleFiles = useCallback(async (fileList) => {
    const schFiles = Array.from(fileList).filter(f => f.name.endsWith('.kicad_sch'))
    if (schFiles.length === 0) {
      alert('Please select .kicad_sch files')
      return
    }

    const parsed = await Promise.all(schFiles.map(async (file) => {
      const text = await file.text()
      const info = detectVersion(text)
      return {
        file,
        name: file.name,
        size: file.size,
        content: text,
        version: info.version,
        generatorVersion: info.generatorVersion,
        isKicad9: info.isKicad9,
        status: 'pending',
        result: null,
      }
    }))

    setFiles(parsed)
    setResults(null)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragActive(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    setDragActive(false)
  }, [])

  const handleConvert = useCallback(async () => {
    if (files.length === 0) return
    setConverting(true)
    setActiveTab('log')

    const allLogs = []
    const allWarnings = []
    const convertedFiles = []
    let totalStats = {
      r1_header: 0,
      r2_pin_names_hide: 0,
      r3_pin_hide: 0,
      r4_embedded_fonts: 0,
      r5_sheet_pin_uuid: 0,
      r6_sheet_attrs: 0,
      r7_k9_elements: 0,
    }

    const updatedFiles = [...files]

    for (let i = 0; i < updatedFiles.length; i++) {
      const f = updatedFiles[i]
      allLogs.push(`\n━━━ Converting: ${f.name} ━━━`)

      try {
        const result = convertKicad9to8(f.content)
        updatedFiles[i] = { ...f, status: 'success', result }

        allLogs.push(...result.log)
        allWarnings.push(...result.warnings.map(w => `[${f.name}] ${w}`))

        convertedFiles.push({
          name: f.name,
          content: result.output,
        })

        // Accumulate stats from log
        for (const line of result.log) {
          const m2 = line.match(/R2 pin_names hide converted: (\d+)/)
          const m3 = line.match(/R3 pin hide converted: (\d+)/)
          const m4 = line.match(/R4 embedded_fonts removed: (\d+)/)
          const m5 = line.match(/R5 sheet pin uuid reordered: (\d+)/)
          const m6 = line.match(/R6 sheet attributes removed: (\d+)/)
          const m7 = line.match(/R7 K9-only elements removed: (\d+)/)
          if (m2) totalStats.r2_pin_names_hide += parseInt(m2[1])
          if (m3) totalStats.r3_pin_hide += parseInt(m3[1])
          if (m4) totalStats.r4_embedded_fonts += parseInt(m4[1])
          if (m5) totalStats.r5_sheet_pin_uuid += parseInt(m5[1])
          if (m6) totalStats.r6_sheet_attrs += parseInt(m6[1])
          if (m7) totalStats.r7_k9_elements += parseInt(m7[1])
        }
        totalStats.r1_header++
      } catch (err) {
        updatedFiles[i] = { ...f, status: 'error', error: err.message }
        allLogs.push(`ERROR: ${err.message}`)
        allWarnings.push(`[${f.name}] Conversion failed: ${err.message}`)
      }
    }

    setFiles(updatedFiles)
    setResults({
      logs: allLogs,
      warnings: allWarnings,
      convertedFiles,
      stats: totalStats,
      fileCount: files.length,
      successCount: convertedFiles.length,
    })
    setConverting(false)
  }, [files])

  const downloadFile = useCallback((name, content) => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const downloadAll = useCallback(() => {
    if (!results) return
    for (const f of results.convertedFiles) {
      downloadFile(f.name, f.content)
    }
  }, [results, downloadFile])

  const reset = useCallback(() => {
    setFiles([])
    setResults(null)
  }, [])

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon">⚡</div>
          <h1 className="app-title">KiCad Schematic Converter</h1>
        </div>
        <p className="app-subtitle">Convert KiCad 9 schematics to KiCad 8 format</p>
        <div className="version-badges">
          <span className="version-badge from">KiCad 9</span>
          <span className="version-arrow">→</span>
          <span className="version-badge to">KiCad 8</span>
        </div>
      </header>

      {/* Drop Zone */}
      {files.length === 0 && (
        <div className="drop-zone-wrapper fade-in">
          <div
            className={`drop-zone ${dragActive ? 'drag-active' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="drop-zone-icon">📂</div>
            <div className="drop-zone-title">
              Drop .kicad_sch files here
            </div>
            <div className="drop-zone-hint">
              or click to browse • Supports batch conversion of multiple files
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".kicad_sch"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      )}

      {/* File List */}
      {files.length > 0 && !results && (
        <div className="fade-in">
          <div className="batch-controls">
            <button className="btn btn-primary" onClick={handleConvert} disabled={converting}>
              {converting ? '⏳ Converting...' : '🔄 Convert All'}
            </button>
            <button className="btn btn-ghost" onClick={reset}>
              ✕ Clear
            </button>
            <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>
              + Add Files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".kicad_sch"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const newFiles = Array.from(e.target.files)
                if (newFiles.length > 0) {
                  handleFiles([...files.map(f => f.file), ...newFiles])
                }
              }}
            />
          </div>

          <div className="file-list">
            {files.map((f, idx) => (
              <div key={idx} className="file-list-item">
                <span>📄</span>
                <span className="file-name">{f.name}</span>
                <span className="file-info-meta">
                  {formatSize(f.size)}
                </span>
                <span className={`file-info-version ${f.isKicad9 ? 'k9' : 'k8'}`}>
                  v{f.version}
                </span>
                <span className={`file-status ${f.status}`}>
                  {f.status === 'pending' && 'Ready'}
                  {f.status === 'success' && '✓ Done'}
                  {f.status === 'error' && '✗ Error'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="fade-in">
          {/* Success Panel */}
          <div className="result-panel">
            <div className="result-header">
              <div className="result-icon">✓</div>
              <div>
                <div className="result-title">
                  Conversion Complete
                </div>
                <div className="result-subtitle">
                  {results.successCount}/{results.fileCount} file(s) converted successfully
                </div>
              </div>
            </div>

            <div className="result-stats">
              <div className="stat-item">
                <span className="stat-label">pin_names hide</span>
                <span className="stat-value">{results.stats.r2_pin_names_hide}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">pin hide</span>
                <span className="stat-value">{results.stats.r3_pin_hide}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">embedded_fonts</span>
                <span className="stat-value">{results.stats.r4_embedded_fonts}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">sheet pin uuid</span>
                <span className="stat-value">{results.stats.r5_sheet_pin_uuid}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">sheet attrs</span>
                <span className="stat-value">{results.stats.r6_sheet_attrs}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">K9 elements</span>
                <span className="stat-value">{results.stats.r7_k9_elements}</span>
              </div>
            </div>

            <div className="result-actions">
              {results.convertedFiles.length === 1 ? (
                <button
                  className="btn btn-success"
                  onClick={() => downloadFile(results.convertedFiles[0].name, results.convertedFiles[0].content)}
                >
                  ⬇ Download Converted File
                </button>
              ) : (
                <button className="btn btn-success" onClick={downloadAll}>
                  ⬇ Download All ({results.convertedFiles.length} files)
                </button>
              )}
              <button className="btn btn-ghost" onClick={reset}>
                🔄 Convert Another
              </button>
            </div>
          </div>

          {/* Warnings */}
          {results.warnings.length > 0 && (
            <div className="warnings-panel">
              <div className="warnings-title">⚠ Warnings</div>
              <ul className="warnings-list">
                {results.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* File list with status */}
          {files.length > 1 && (
            <div className="file-list" style={{ marginBottom: '1.5rem' }}>
              {files.map((f, idx) => (
                <div key={idx} className="file-list-item">
                  <span>📄</span>
                  <span className="file-name">{f.name}</span>
                  <span className="file-info-meta">{formatSize(f.size)}</span>
                  <span className={`file-status ${f.status}`}>
                    {f.status === 'success' && '✓ Converted'}
                    {f.status === 'error' && `✗ ${f.error}`}
                  </span>
                  {f.status === 'success' && (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                      onClick={() => downloadFile(f.name, f.result.output)}
                    >
                      ⬇
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Conversion Log */}
          <div className="log-section">
            <div className="log-header">
              <div className="log-title">
                📋 Conversion Log
              </div>
            </div>
            <div className="log-container">
              {results.logs.map((line, i) => {
                let className = 'log-line'
                if (line.startsWith('R')) className += ' rule'
                else if (line.startsWith('WARNING') || line.includes('WARNING')) className += ' warning'
                else if (line.startsWith('ERROR')) className += ' error'
                else if (line.startsWith('---')) className += ' summary'
                else if (line.startsWith('━━━')) className += ' summary'

                return (
                  <div key={i} className={className}>
                    <span className="prefix">{String(i + 1).padStart(3, ' ')}│</span>
                    {line}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="app-footer">
        KiCad Schematic Version Converter • Lossy conversion — K9-only features will be removed
      </footer>
    </div>
  )
}

export default App
