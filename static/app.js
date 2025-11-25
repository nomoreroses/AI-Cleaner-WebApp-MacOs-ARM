/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
const { useState, useEffect, useRef } = React;

// --- ICONS ---
const Icons = {
    Folder: () => React.createElement('svg', { width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "2", viewBox: "0 0 24 24" },
        React.createElement('path', { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" })
    ),
    Cpu: () => React.createElement('svg', { width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "2", viewBox: "0 0 24 24" },
        React.createElement('rect', { x: "4", y: "4", width: "16", height: "16", rx: "2", ry: "2" }),
        React.createElement('rect', { x: "9", y: "9", width: "6", height: "6" }),
        React.createElement('path', { d: "M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" })
    ),
    Trash: () => React.createElement('svg', { width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "2", viewBox: "0 0 24 24" },
        React.createElement('polyline', { points: "3 6 5 6 21 6" }),
        React.createElement('path', { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" })
    ),
    Shield: () => React.createElement('svg', { width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "2", viewBox: "0 0 24 24" },
        React.createElement('path', { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" })
    ),
    Stop: () => React.createElement('svg', { width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "2", viewBox: "0 0 24 24" },
        React.createElement('rect', { x: "6", y: "4", width: "4", height: "16" }),
        React.createElement('rect', { x: "14", y: "4", width: "4", height: "16" })
    ),
    Zap: () => React.createElement('svg', { width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "2", viewBox: "0 0 24 24" },
        React.createElement('polygon', { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" })
    ),
    Search: () => React.createElement('svg', { width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "2", viewBox: "0 0 24 24" },
        React.createElement('circle', { cx: "11", cy: "11", r: "8" }),
        React.createElement('line', { x1: "21", y1: "21", x2: "16.65", y2: "16.65" })
    ),
    Terminal: () => React.createElement('svg', { width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "2", viewBox: "0 0 24 24" },
        React.createElement('polyline', { points: "4 17 10 11 4 5" }),
        React.createElement('line', { x1: "12", y1: "19", x2: "20", y2: "19" })
    ),
    Move: () => React.createElement('svg', { width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "2", viewBox: "0 0 24 24" },
        React.createElement('polyline', { points: "9 11 12 14 22 14 22 4 12 4 9 7" }),
        React.createElement('path', { d: "M4 14h6" })
    )
};

// --- CONFIG ---
const inferApiBase = () => { 
    const o = window.location.origin; 
    return (o && o.startsWith('http')) ? o.replace(/\/$/, '') : 'http://localhost:5000'; 
};
const API_BASE = inferApiBase();
const apiFetch = (path, options = {}) => fetch(`${API_BASE}${path}`, options);

// FIX: Configuration SocketIO corrigée
const socket = io(API_BASE, { 
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10
});

const FILE_TYPES = [
    { key: 'images', value: 'Images', label: 'IMAGES' },
    { key: 'videos', value: 'Videos', label: 'VIDEOS' },
    { key: 'audio', value: 'Audio', label: 'AUDIO' },
    { key: 'documents', value: 'Documents', label: 'DOCS' },
    { key: 'archives', value: 'Archives', label: 'ARCHIVES' },
    { key: 'other', value: 'Autres', label: 'AUTRES' }
];
const DEFAULT_TYPES = FILE_TYPES.reduce((acc, o) => ({ ...acc, [o.key]: true }), {});

const App = () => {
    const [status, setStatus] = useState('idle');
    const [config, setConfig] = useState({ path: '', max_files: 100, types: DEFAULT_TYPES });
    const [files, setFiles] = useState([]);
    const [results, setResults] = useState({ delete: [], keep: [], review: [] });
    const [selected, setSelected] = useState({});
    const [logs, setLogs] = useState([]);
    const [progress, setProgress] = useState({ val: 0, max: 100, txt: '' });
    const [aiThinking, setAiThinking] = useState(null);
    const [activeTab, setActiveTab] = useState('delete');

    const logsEndRef = useRef(null);

    const fmtSize = (b) => b < 1024 ? b + ' B' : b < 1024**2 ? (b/1024).toFixed(1) + ' KB' : (b/1024**2).toFixed(1) + ' MB';
    const addLog = (m, type = 'info') => setLogs(p => [...p, { time: new Date().toLocaleTimeString(), msg: m, type }]);
    
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [logs]);
    
    useEffect(() => {
        const handleConnect = () => addLog('✅ SYSTEM :: Connected', 'success');
        const handleScanStarted = () => { 
            setStatus('scanning'); 
            setFiles([]); 
            setResults({delete:[],keep:[],review:[]}); 
            setProgress({val:0,max:0,txt:'Scanning...'}); 
        };
        
        const handleScanUpdate = (d) => setProgress(p => ({...p, val: d.total_files, txt: `Scanning: ${d.total_files} files` }));
        
        // FIX: Correction de la réception des fichiers scannés
        const handleScanComplete = (d) => { 
            setStatus('idle'); 
            setFiles(d.candidates || []); // FIX: Utilisation de candidates au lieu de files
            setProgress({val:0,max:0,txt:'Scan complete'});
            addLog(`✅ SCAN COMPLETE :: ${d.total_files} files found, ${d.candidates_count} candidates`, 'success');
        };
        
        const handleAnalyzeStarted = (d) => { 
            setStatus('analyzing'); 
            setResults({delete:[],keep:[],review:[]}); 
            setProgress({val:0, max:d.total_candidates, txt:'Neural analysis...'}); 
        };
        
        const handleAnalyzeUpdate = (d) => {
            setProgress({val: d.analyzed_files, max: d.total_candidates, txt: `Analyzing: ${d.analyzed_files}/${d.total_candidates}`});
        };
        
        // FIX: Correction de la réception des résultats d'analyse
        const handleAnalyzeComplete = (d) => { 
            setStatus('idle'); 
            setAiThinking(null);
            if (d.results) {
                const deleteFiles = d.results.filter(r => r.decision === 'DELETE');
                const keepFiles = d.results.filter(r => r.decision === 'KEEP');
                const reviewFiles = d.results.filter(r => r.decision === 'REVIEW');
                setResults({ delete: deleteFiles, keep: keepFiles, review: reviewFiles });
            }
            addLog(d.cancelled ? '🛑 Analysis stopped' : '✅ ANALYSIS COMPLETE', d.cancelled ? 'warn' : 'success');
        };
        
        const handleAiThinking = (d) => setAiThinking(d);
        const handleAiResult = () => setAiThinking(null);
        const handleFileDeleted = (d) => addLog(`🗑️ REMOVED :: ${d.path.split('/').pop()}`, 'warn');
        const handleLog = (data) => addLog(data.msg, data.type);

        socket.on('connect', handleConnect);
        socket.on('scan_started', handleScanStarted);
        socket.on('scan_update', handleScanUpdate);
        socket.on('scan_complete', handleScanComplete); // FIX: Changé de scan_finished à scan_complete
        socket.on('analyze_started', handleAnalyzeStarted);
        socket.on('analyze_update', handleAnalyzeUpdate);
        socket.on('analyze_complete', handleAnalyzeComplete);
        socket.on('ai_thinking', handleAiThinking);
        socket.on('ai_result', handleAiResult);
        socket.on('file_deleted', handleFileDeleted);
        socket.on('log', handleLog);

        return () => {
            socket.off('connect', handleConnect);
            socket.off('scan_started', handleScanStarted);
            socket.off('scan_update', handleScanUpdate);
            socket.off('scan_complete', handleScanComplete);
            socket.off('analyze_started', handleAnalyzeStarted);
            socket.off('analyze_update', handleAnalyzeUpdate);
            socket.off('analyze_complete', handleAnalyzeComplete);
            socket.off('ai_thinking', handleAiThinking);
            socket.off('ai_result', handleAiResult);
            socket.off('file_deleted', handleFileDeleted);
            socket.off('log', handleLog);
        };
    }, []);

    const handleSelectFolder = async () => {
        addLog('📂 Opening native folder picker...', 'info');
        try {
            const res = await apiFetch('/api/select_folder', { 
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ use_native: true })
            });
            const data = await res.json();
            
            if (data.ok && data.path) {
                setConfig(p => ({...p, path: data.path}));
                addLog(`✅ Folder selected: ${data.path.split('/').pop() || data.path}`, 'success');
            } else {
                addLog(`❌ Folder selection failed: ${data.error}`, 'warn');
            }
        } catch (e) { 
            addLog(`⚠️ Failed to open picker: ${e.message}`, 'warn'); 
        }
    };

    const handleScan = async () => {
        if (!config.path) { addLog("❌ Please select a folder first", "warn"); return; }
        const cats = FILE_TYPES.filter(t => config.types[t.key]).map(t => t.value);
        try {
            const response = await apiFetch('/api/scan', { 
                method: 'POST', 
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ 
                    path: config.path, 
                    categories: cats,
                    min_age_days: 30,
                    min_size_mb: 0
                }) 
            });
            const data = await response.json();
            if (!data.ok) {
                addLog(`❌ Scan error: ${data.error}`, 'error');
            }
        } catch (e) {
            addLog(`❌ Scan failed: ${e.message}`, 'error');
        }
    };

    const handleAnalyze = async () => {
        if (files.length === 0) {
            addLog("❌ No files to analyze. Please scan first.", "warn");
            return;
        }
        try {
            const response = await apiFetch('/api/analyze', { 
                method: 'POST', 
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ model: 'llama3:8b' }) 
            });
            const data = await response.json();
            if (!data.ok) {
                addLog(`❌ Analysis error: ${data.error}`, 'error');
            }
        } catch (e) {
            addLog(`❌ Analysis failed: ${e.message}`, 'error');
        }
    };

    const handleStop = async () => {
        addLog('🛑 SENDING STOP SIGNAL...', 'warn');
        try {
            await apiFetch('/api/stop', { method: 'POST' });
            setStatus('idle');
        } catch (e) {
            addLog(`❌ Stop failed: ${e.message}`, 'error');
        }
    };

    const handleDelete = async () => {
        const toDelete = results.delete.filter(f => selected[f.file]).map(f => f.file);
        if(toDelete.length === 0) return;
        if(confirm(`🗑️ PERMANENTLY DELETE ${toDelete.length} FILES?\n\nThis action cannot be undone!`)) {
            try {
                const response = await apiFetch('/api/delete', { 
                    method: 'POST', 
                    headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ files: toDelete }) 
                });
                const data = await response.json();
                if (data.ok) {
                    setResults(p => ({...p, delete: p.delete.filter(f => !selected[f.file])}));
                    const nextSel = {...selected};
                    toDelete.forEach(f => delete nextSel[f]);
                    setSelected(nextSel);
                    addLog(`✅ Deleted ${data.deleted} files`, 'success');
                }
            } catch (e) {
                addLog(`❌ Delete failed: ${e.message}`, 'error');
            }
        }
    };

    const handleMoveToDelete = () => {
        const filesToMove = results.review.filter(f => selected[f.file]);
        if (filesToMove.length === 0) return;
        setResults(prev => ({
            ...prev,
            review: prev.review.filter(f => !selected[f.file]),
            delete: [...prev.delete, ...filesToMove]
        }));
        const nextSel = {...selected};
        filesToMove.forEach(f => delete nextSel[f.file]);
        setSelected(nextSel);
        addLog(`📤 Moved ${filesToMove.length} files to Delete list`, 'info');
    };

    const handleToggleSelectAll = (e) => {
        const isChecked = e.target.checked;
        const newSel = { ...selected };
        (results[activeTab] || []).forEach(f => {
            if (isChecked) newSel[f.file] = true;
            else delete newSel[f.file];
        });
        setSelected(newSel);
    };

    // Helpers UI
    const currentList = results[activeTab] || [];
    const totalCount = results.delete.length + results.keep.length + results.review.length;
    const totalBytes = currentList.reduce((acc, f) => acc + (f.size || 0), 0);
    const isBusy = status === 'scanning' || status === 'analyzing';
    const selectionCount = currentList.filter(f => selected[f.file]).length;
    const isAllSelected = currentList.length > 0 && currentList.every(f => selected[f.file]);
    const canAnalyze = !isBusy && files.length > 0; // FIX: Correction de la condition

    return React.createElement('div', { className: "h-full flex flex-col overflow-hidden relative bg-gray-900" }, // FIX: Couleur de fond fixe
        React.createElement('div', { className: "absolute inset-0 grid-bg pointer-events-none opacity-30" }),

        aiThinking && React.createElement('div', { className: "fixed bottom-4 right-4 z-50 animate-slide-up" },
            React.createElement('div', { className: "bg-black/90 border border-purple-500/50 px-4 py-3 rounded-lg shadow-[0_0_20px_rgba(168,85,247,0.3)] flex items-center gap-3 backdrop-blur-xl" },
                React.createElement('div', { className: "relative" },
                    React.createElement('div', { className: "w-3 h-3 bg-purple-500 rounded-full animate-ping absolute" }),
                    React.createElement('div', { className: "w-3 h-3 bg-purple-500 rounded-full relative" })
                ),
                React.createElement('div', { className: "flex flex-col" },
                    React.createElement('span', { className: "text-[10px] font-bold text-purple-400 uppercase tracking-wider" }, "Neural Engine"),
                    React.createElement('span', { className: "text-xs text-white font-mono truncate max-w-[200px]" }, aiThinking.file)
                )
            )
        ),

        React.createElement('div', { className: "flex flex-1 overflow-hidden" },
            // SIDEBAR
            React.createElement('aside', { className: "w-72 bg-gray-800 border-r border-gray-700 flex flex-col z-20 relative shrink-0 h-full" },
                React.createElement('div', { className: "p-6 border-b border-gray-700 shrink-0" },
                    React.createElement('div', { className: "flex items-center gap-3 text-cyan-400 mb-1" },
                        React.createElement('div', { className: "p-2 bg-cyan-500/10 rounded-lg border border-cyan-500/20" }, React.createElement(Icons.Shield)),
                        React.createElement('span', { className: "text-lg font-bold tracking-wider font-mono" }, "AI.CLEANER")
                    ),
                    React.createElement('div', { className: "flex items-center gap-2 mt-2" },
                        React.createElement('span', { className: `w-2 h-2 rounded-full ${status === 'idle' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}` }),
                        React.createElement('span', { className: "text-[10px] text-gray-400 uppercase tracking-widest font-mono" }, status === 'idle' ? 'SYSTEM READY' : `PROCESS: ${status.toUpperCase()}`)
                    )
                ),
                React.createElement('div', { className: "flex-1 overflow-y-auto p-4 space-y-6" },
                    React.createElement('div', { className: "space-y-2" },
                        React.createElement('label', { className: "text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1" }, "Target Sector"),
                        React.createElement('div', { 
                            onClick: handleSelectFolder, 
                            className: "bg-gray-900 rounded-lg p-4 border border-gray-700 hover:border-cyan-500/50 transition-all cursor-pointer group relative overflow-hidden" 
                        },
                            React.createElement('div', { className: "absolute inset-0 bg-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity" }),
                            React.createElement('div', { className: "flex justify-between items-center mb-2 relative z-10" },
                                React.createElement('div', { className: "text-cyan-400" }, React.createElement(Icons.Folder)),
                                React.createElement('span', { className: "text-[10px] bg-gray-700 px-2 py-1 rounded text-white group-hover:bg-cyan-500 group-hover:text-black transition-colors uppercase font-bold" }, "Browse")
                            ),
                            React.createElement('div', { className: "text-xs text-gray-300 font-mono truncate relative z-10" }, config.path || 'Click to select')
                        )
                    ),
                    React.createElement('div', { className: "space-y-2" },
                        React.createElement('label', { className: "text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1" }, "File Types"),
                        React.createElement('div', { className: "grid grid-cols-2 gap-2" },
                            FILE_TYPES.map(t => 
                                React.createElement('button', { 
                                    key: t.key, 
                                    onClick: () => setConfig(p => ({...p, types: {...p.types, [t.key]: !p.types[t.key]}})),
                                    className: `text-[10px] font-bold py-2 px-1 rounded border transition-all truncate ${config.types[t.key] ? 'bg-gray-700 text-white border-gray-600' : 'bg-transparent text-gray-600 border-transparent hover:bg-gray-700/50'}` 
                                }, t.label)
                            )
                        )
                    )
                ),
                React.createElement('div', { className: "p-4 border-t border-gray-700 bg-gray-900 space-y-3 shrink-0" },
                    isBusy ? 
                        React.createElement('button', { onClick: handleStop, className: "w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg font-bold uppercase text-xs transition-all" },
                            React.createElement(Icons.Stop), " ABORT"
                        ) :
                        React.createElement('button', { onClick: handleScan, className: "w-full flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white py-3 rounded-lg font-bold uppercase text-xs transition-all" },
                            React.createElement(Icons.Search), " SCAN TARGET"
                        ),
                    React.createElement('button', { 
                        onClick: handleAnalyze, 
                        disabled: !canAnalyze,
                        className: `w-full flex items-center justify-center gap-2 border border-purple-500 text-purple-300 hover:bg-purple-500 hover:text-white transition-all py-3 rounded-lg font-bold uppercase text-xs ${!canAnalyze ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-lg'}` 
                    },
                        React.createElement(Icons.Cpu), " NEURAL ANALYZE"
                    )
                )
            ),

            // MAIN CONTENT
            React.createElement('main', { className: "flex-1 flex flex-col min-w-0 h-full relative z-10" },
                React.createElement('header', { className: "h-16 flex items-center justify-between px-6 border-b border-gray-700 bg-gray-800 shrink-0" },
                    React.createElement('div', { className: "flex items-center gap-2" },
                        ['delete', 'review', 'keep'].map(tab => 
                            React.createElement('button', { 
                                key: tab,
                                onClick: () => setActiveTab(tab),
                                className: `relative px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${activeTab === tab ? 
                                    (tab === 'delete' ? 'bg-red-500/10 text-red-400 border border-red-500/30' : 
                                     tab === 'review' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' : 
                                     'bg-green-500/10 text-green-400 border border-green-500/30') : 
                                    'text-gray-500 hover:text-gray-200 hover:bg-gray-700 border border-transparent'}` 
                            },
                                tab,
                                React.createElement('span', { className: "bg-gray-900 px-1.5 py-0.5 rounded text-[10px] font-mono ml-1" }, results[tab]?.length || 0)
                            )
                        )
                    ),
                    React.createElement('div', { className: "flex items-center gap-6 text-xs font-mono text-gray-400" },
                        React.createElement('div', { className: "text-right" },
                            React.createElement('div', { className: "text-[10px] text-gray-500 uppercase font-bold" }, "Processed"),
                            React.createElement('div', { className: "text-white" }, `${totalCount} items`)
                        ),
                        React.createElement('div', { className: "w-[1px] h-8 bg-gray-600" }),
                        React.createElement('div', { className: "text-right" },
                            React.createElement('div', { className: "text-[10px] text-gray-500 uppercase font-bold" }, "Total Size"),
                            React.createElement('div', { className: "text-cyan-400" }, fmtSize(totalBytes))
                        )
                    )
                ),

                React.createElement('div', { className: "flex-1 flex overflow-hidden p-6 gap-6" },
                    React.createElement('div', { className: "flex-1 bg-gray-800 rounded-xl flex flex-col overflow-hidden border border-gray-700" },
                        React.createElement('div', { className: "p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900 shrink-0" },
                            React.createElement('div', { className: "flex items-center gap-3" },
                                (activeTab === 'delete' || activeTab === 'review') && currentList.length > 0 &&
                                    React.createElement('input', { 
                                        type: "checkbox",
                                        checked: isAllSelected,
                                        onChange: handleToggleSelectAll,
                                        className: "w-4 h-4 rounded border-gray-600 bg-gray-800 cursor-pointer accent-cyan-500",
                                        title: "Select All"
                                    }),
                                React.createElement('div', { className: "text-xs font-bold text-gray-500 uppercase tracking-widest" }, "Filename / Path")
                            ),
                            React.createElement('div', { className: "text-xs font-bold text-gray-500 uppercase tracking-widest" }, "Size / Reason")
                        ),
                        React.createElement('div', { className: "flex-1 overflow-y-auto p-2 space-y-1" },
                            currentList.length === 0 ? 
                                React.createElement('div', { className: "h-full flex flex-col items-center justify-center text-gray-600 space-y-4" },
                                    React.createElement(Icons.Folder),
                                    React.createElement('p', { className: "text-sm font-mono uppercase tracking-widest" }, "NO DATA")
                                ) :
                                currentList.map((f, i) => 
                                    React.createElement('div', { key: i, className: "group flex items-start justify-between p-3 rounded bg-gray-700/50 hover:bg-gray-700 border border-transparent hover:border-gray-600 transition-all" },
                                        React.createElement('div', { className: "flex items-start gap-3 min-w-0 max-w-[75%]" },
                                            (activeTab === 'delete' || activeTab === 'review') &&
                                                React.createElement('input', { 
                                                    type: "checkbox",
                                                    checked: !!selected[f.file],
                                                    onChange: e => setSelected(p => ({...p, [f.file]: e.target.checked})),
                                                    className: `mt-1 w-4 h-4 rounded border-gray-600 bg-gray-800 cursor-pointer shrink-0 transition-all ${activeTab==='delete'?'accent-red-500':'accent-amber-500'}` 
                                                }),
                                            React.createElement('div', { className: "min-w-0" },
                                                React.createElement('div', { className: "text-sm text-gray-200 break-all font-medium leading-tight mb-1" }, f.name),
                                                React.createElement('div', { className: "text-[10px] text-gray-500 truncate font-mono" }, f.file)
                                            )
                                        ),
                                        React.createElement('div', { className: "text-right pl-4 shrink-0" },
                                            React.createElement('div', { className: "text-xs text-cyan-400 font-mono mb-1" }, fmtSize(f.size || 0)),
                                            f.reason && React.createElement('div', { className: `text-[10px] max-w-[200px] leading-tight ${activeTab==='delete'?'text-red-400':activeTab==='keep'?'text-green-400':'text-amber-400'}` }, f.reason)
                                        )
                                    )
                                )
                        ),
                        (activeTab === 'delete' || activeTab === 'review') && selectionCount > 0 &&
                            React.createElement('div', { className: "p-4 border-t border-gray-700 bg-gray-900 shrink-0" },
                                activeTab === 'delete' ? 
                                    React.createElement('button', { 
                                        onClick: handleDelete, 
                                        disabled: isBusy,
                                        className: "w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg font-bold uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all" 
                                    },
                                        React.createElement(Icons.Trash), ` PERMANENTLY DELETE ${selectionCount} FILES`
                                    ) :
                                    React.createElement('button', { 
                                        onClick: handleMoveToDelete,
                                        className: "w-full bg-amber-600 hover:bg-amber-500 text-white py-3 rounded-lg font-bold uppercase text-xs shadow-lg flex items-center justify-center gap-2 transition-all" 
                                    },
                                        React.createElement(Icons.Move), ` MOVE ${selectionCount} FILES TO DELETION LIST`
                                    )
                            )
                    ),
                    React.createElement('div', { className: "w-80 flex flex-col gap-6 shrink-0" },
                        React.createElement('div', { className: "bg-gray-800 rounded-xl p-5 relative overflow-hidden border border-gray-700" },
                            React.createElement('div', { className: "absolute top-0 right-0 p-2 opacity-20" }, React.createElement(Icons.Zap)),
                            React.createElement('h3', { className: "text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2" }, "Activity"),
                            React.createElement('div', { className: "mb-4 text-center" },
                                status === 'scanning' ? 
                                    React.createElement(React.Fragment, null,
                                        React.createElement('div', { className: "text-2xl font-bold text-cyan-400 font-mono animate-pulse" }, "SCANNING"),
                                        React.createElement('div', { className: "text-[10px] text-cyan-400 font-mono truncate px-2 mt-1" }, progress.txt || 'IDLE')
                                    ) :
                                    React.createElement(React.Fragment, null,
                                        React.createElement('div', { className: "text-3xl font-bold text-white font-mono" }, `${progress.max > 0 ? Math.round((progress.val / progress.max) * 100) : 0}%`),
                                        React.createElement('div', { className: "text-[10px] text-cyan-400 font-mono truncate px-2 mt-1" }, progress.txt || 'IDLE')
                                    )
                            ),
                            React.createElement('div', { className: "h-1.5 w-full bg-gray-700 rounded-full overflow-hidden border border-gray-600 relative" },
                                status === 'scanning' ?
                                    React.createElement('div', { className: "h-full bg-cyan-500 w-full animate-pulse" }) :
                                    React.createElement('div', { 
                                        className: "h-full bg-cyan-500 transition-all duration-300",
                                        style: { width: `${progress.max > 0 ? (progress.val / progress.max) * 100 : 0}%` }
                                    })
                            )
                        ),
                        React.createElement('div', { className: "flex-1 bg-gray-800 rounded-xl flex flex-col overflow-hidden relative border border-gray-700" },
                            React.createElement('div', { className: "p-2 border-b border-gray-700 bg-gray-900 flex justify-between items-center shrink-0" },
                                React.createElement('div', { className: "flex items-center gap-2 text-[10px] font-mono text-gray-400" },
                                    React.createElement(Icons.Terminal), " LOGS"
                                ),
                                React.createElement('button', { onClick: () => setLogs([]), className: "text-[10px] text-gray-600 hover:text-white uppercase px-2 transition-colors" }, "CLR")
                            ),
                            React.createElement('div', { className: "flex-1 overflow-y-auto p-3 font-mono text-[10px] space-y-1.5" },
                                logs.length === 0 && React.createElement('span', { className: "text-gray-700" }, "// System ready..."),
                                logs.map((l, i) => 
                                    React.createElement('div', { key: i, className: "flex gap-2" },
                                        React.createElement('span', { className: "text-gray-600 shrink-0" }, `[${l.time}]`),
                                        React.createElement('span', { className: `${l.type === 'warn' ? 'text-amber-400' : l.type === 'success' ? 'text-green-400' : l.type === 'error' ? 'text-red-400' : 'text-cyan-300'}` }, `${l.type === 'warn' ? '⚠ ' : l.type === 'error' ? '❌ ' : '> '}${l.msg}`)
                                    )
                                ),
                                React.createElement('div', { ref: logsEndRef })
                            )
                        )
                    )
                )
            )
        )
    );
};

// FIX: Utilisation de createRoot pour React 18
const root = ReactDOM.createRoot(document.getElementById('app'));
root.render(React.createElement(App));