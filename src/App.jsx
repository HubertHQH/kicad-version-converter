import { useState, useCallback, useRef } from 'react'
import { convertKicad, detectVersion } from './lib/converter'
import './App.css'

function App() {
  const [files, setFiles] = useState([])
  const [results, setResults] = useState(null)
  const [converting, setConverting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [targetVersion, setTargetVersion] = useState('KICAD8')
  const fileInputRef = useRef(null)

  const targetOptions = [
    { key: 'KICAD8', label: 'KiCad 8', version: '20231120' },
    { key: 'KICAD7', label: 'KiCad 7', version: '20230121' },
  ]

  const handleFiles = useCallback(async (fileList) => {
    const validExts = ['.kicad_sch', '.kicad_sym', '.kicad_pcb']
    const validFiles = Array.from(fileList).filter(f => validExts.some(ext => f.name.endsWith(ext)))
    if (validFiles.length === 0) {
      alert('Please select .kicad_sch, .kicad_sym, or .kicad_pcb files')
      return
    }

    const parsed = await Promise.all(validFiles.map(async (file) => {
      const text = await file.text()
      const isSymLib = file.name.endsWith('.kicad_sym')
      const isPcb = file.name.endsWith('.kicad_pcb')
      const info = detectVersion(text)
      return {
        file,
        name: file.name,
        size: file.size,
        content: text,
        version: info.version,
        generatorVersion: info.generatorVersion,
        label: info.label,
        isKicad9: info.isKicad9,
        fileType: isPcb ? 'PCB' : (isSymLib ? 'Symbol Library' : 'Schematic'),
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

    const allLogs = []
    const allWarnings = []
    const convertedFiles = []

    const updatedFiles = [...files]
    const target = targetOptions.find(t => t.key === targetVersion)

    for (let i = 0; i < updatedFiles.length; i++) {
      const f = updatedFiles[i]
      allLogs.push(`\n━━━ Converting: ${f.name} → ${target.label} ━━━`)

      try {
        const result = await convertKicad(f.content, targetVersion)
        updatedFiles[i] = { ...f, status: 'success', result }

        allLogs.push(...result.log)
        allWarnings.push(...result.warnings.map(w => `[${f.name}] ${w}`))

        convertedFiles.push({
          name: f.name,
          content: result.output,
        })
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
      fileCount: files.length,
      successCount: convertedFiles.length,
      targetLabel: target.label,
    })
    setConverting(false)
  }, [files, targetVersion])

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

  const getVersionClass = (label) => {
    if (label === 'KiCad 9') return 'k9'
    if (label === 'KiCad 8') return 'k8'
    if (label === 'KiCad 7') return 'k7'
    return ''
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon">⚡</div>
          <h1 className="app-title">KiCad Version Converter</h1>
        </div>
        <p className="app-subtitle">Convert KiCad schematics, symbol libraries & PCBs between versions</p>
        <div className="version-badges">
          <span className="version-badge from">KiCad 9 / 8</span>
          <span className="version-arrow">→</span>
          <span className="version-badge to">KiCad 8 / 7</span>
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
              Drop .kicad_sch / .kicad_sym / .kicad_pcb files here
            </div>
            <div className="drop-zone-hint">
              or click to browse • Supports schematics, symbol libraries &amp; PCBs
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".kicad_sch,.kicad_sym,.kicad_pcb"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      )}

      {/* File List + Target Version Selector */}
      {files.length > 0 && !results && (
        <div className="fade-in">
          <div className="batch-controls">
            <div className="target-version-selector">
              <label className="target-label">Target Version:</label>
              {targetOptions.map(opt => (
                <button
                  key={opt.key}
                  className={`btn btn-version ${targetVersion === opt.key ? 'active' : ''}`}
                  onClick={() => setTargetVersion(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="batch-actions">
              <button className="btn btn-primary" onClick={handleConvert} disabled={converting}>
                {converting ? '⏳ Converting...' : '🔄 Convert All'}
              </button>
              <button className="btn btn-ghost" onClick={reset}>
                ✕ Clear
              </button>
              <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>
                + Add Files
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".kicad_sch,.kicad_sym,.kicad_pcb"
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
                <span>{f.fileType === 'PCB' ? '🔧' : (f.fileType === 'Symbol Library' ? '🔣' : '📄')}</span>
                <span className="file-name">{f.name}</span>
                <span className="file-info-meta">
                  {formatSize(f.size)}
                </span>
                <span className={`file-info-version ${getVersionClass(f.label)}`}>
                  {f.label}
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
                  {results.successCount}/{results.fileCount} file(s) converted to {results.targetLabel}
                </div>
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
        KiCad Version Converter • Supports .kicad_sch, .kicad_sym &amp; .kicad_pcb • Lossy conversion — version-specific features will be removed
      </footer>
    </div>
  )
}

export default App
