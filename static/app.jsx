/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
const { useState, useEffect, useRef } = React;

        const inferApiBase = () => {
            const origin = window.location.origin;
            if (origin && origin.startsWith('http')) {
                return origin.replace(/\/$/, '');
            }
            return 'http://localhost:5000';
        };

        const API_BASE = inferApiBase();
        const apiUrl = (path = '/') => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
        const apiFetch = (path, options = {}) => fetch(apiUrl(path), options);

        // WebSocket connection
        const socket = io(API_BASE, { transports: ['websocket', 'polling'] });

        const FILE_TYPE_OPTIONS = [
            { key: 'images', label: 'Images', category: 'Images', emoji: '🖼️' },
            { key: 'videos', label: 'Vidéos', category: 'Videos', emoji: '🎞️' },
            { key: 'audio', label: 'Audio', category: 'Audio', emoji: '🎧' },
            { key: 'documents', label: 'Textes & Docs', category: 'Documents', emoji: '📄' },
            { key: 'archives', label: 'Archives', category: 'Archives', emoji: '🗜️' },
            { key: 'other', label: 'Autres', category: 'Autres', emoji: '📦' }
        ];

        const DEFAULT_FILE_TYPES = FILE_TYPE_OPTIONS.reduce((acc, option) => {
            acc[option.key] = !['archives', 'other'].includes(option.key);
            return acc;
        }, {});

        // Fonction pour persister l'état
        const saveState = (key, value) => {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {
                console.error('Erreur sauvegarde état:', e);
            }
        };

        const loadState = (key, defaultValue) => {
            try {
                const saved = localStorage.getItem(key);
                return saved ? JSON.parse(saved) : defaultValue;
            } catch (e) {
                return defaultValue;
            }
        };

        const getDefaultConfig = () => ({
            path: '',
            min_age_days: 0,
            min_size_mb: 0,
            max_files: 100,
            model: 'llama3:8b',
            exclude_audio: false,
            exclude_images: false,
            exclude_videos: false,
            delete_empty: true,
            organize_kept_files: true,
            fileTypes: { ...DEFAULT_FILE_TYPES }
        });

        function App() {
            const [status, setStatus] = useState(loadState('status', 'idle')); // idle, scanning, analyzing, complete
            const [config, setConfig] = useState(() => {
                const saved = loadState('config', null);
                if (!saved) {
                    return getDefaultConfig();
                }
                return {
                    ...getDefaultConfig(),
                    ...saved,
                    fileTypes: { ...DEFAULT_FILE_TYPES, ...(saved.fileTypes || {}) }
                };
            });
            
            const [quickDeleteCategories, setQuickDeleteCategories] = useState(loadState('quickDeleteCategories', {
                'Installers': false,
                'Archives': false,
                'Images': false,
                'Documents': false,
                'Audio': false,
                'Videos': false,
                'Autres': false
            }));
            
            const [scanProgress, setScanProgress] = useState(loadState('scanProgress', { scanned: 0, message: '' }));
            const [manualPathInput, setManualPathInput] = useState(config.path || '');
            const [analyzeProgress, setAnalyzeProgress] = useState(loadState('analyzeProgress', { current: 0, total: 0, file: '' }));
            const [aiThinking, setAiThinking] = useState(null);
            const [results, setResults] = useState(loadState('results', { can_delete: [], should_keep: [], need_review: [] }));
            const [selectedDeleteMap, setSelectedDeleteMap] = useState({});
            const [stats, setStats] = useState(loadState('stats', null));
            const [candidates, setCandidates] = useState(loadState('candidates', []));
            const [protectedFiles, setProtectedFiles] = useState(loadState('protectedFiles', []));
            const [logs, setLogs] = useState(loadState('logs', []));
            
            const abortController = useRef(null);

            const activeFileTypes = { ...DEFAULT_FILE_TYPES, ...(config.fileTypes || {}) };
            const activeFileTypeCount = Object.values(activeFileTypes).filter(Boolean).length;

            const toggleFileType = (key) => {
                setConfig(prev => {
                    const merged = { ...DEFAULT_FILE_TYPES, ...(prev.fileTypes || {}) };
                    return {
                        ...prev,
                        fileTypes: {
                            ...merged,
                            [key]: !merged[key]
                        }
                    };
                });
            };

            // Sauvegarder l'état à chaque changement
            useEffect(() => {
                saveState('status', status);
            }, [status]);

            useEffect(() => {
                saveState('config', config);
            }, [config]);

            useEffect(() => {
                saveState('quickDeleteCategories', quickDeleteCategories);
            }, [quickDeleteCategories]);

            useEffect(() => {
                saveState('scanProgress', scanProgress);
            }, [scanProgress]);

            useEffect(() => {
                saveState('analyzeProgress', analyzeProgress);
            }, [analyzeProgress]);

            useEffect(() => {
                saveState('results', results);
            }, [results]);

            useEffect(() => {
                setSelectedDeleteMap(prev => {
                    const next = {};
                    (results.can_delete || []).forEach(entry => {
                        next[entry.file] = prev[entry.file] ?? true;
                    });
                    return next;
                });
            }, [results.can_delete]);

            useEffect(() => {
                saveState('stats', stats);
            }, [stats]);

            useEffect(() => {
                saveState('candidates', candidates);
            }, [candidates]);

            useEffect(() => {
                saveState('protectedFiles', protectedFiles);
            }, [protectedFiles]);

            useEffect(() => {
                saveState('logs', logs);
            }, [logs]);

            useEffect(() => {
                setManualPathInput(config.path || '');
            }, [config.path]);

            useEffect(() => {
                // WebSocket listeners
                socket.on('connected', () => addLog('✅ Connecté au serveur'));

                socket.on('scan_started', (data) => {
                    setStatus('scanning');
                    setCandidates([]);
                    setProtectedFiles([]);
                    setStats(null);
                    setScanProgress({ scanned: 0, message: 'Scan démarré...' });
                    setAiThinking(null);
                    addLog(`🔍 Scan démarré: ${data.path}`);
                });

                socket.on('scan_progress', (data) => {
                    setScanProgress(data);
                });

                socket.on('scan_finished', (data) => {
                    setStatus('idle');
                    const protectedList = data.protected || [];
                    setStats({
                        total_files: data.total_files || data.count,
                        candidate_count: data.count,
                        stats: data.stats || {},
                        selected_categories: data.selected_categories || null
                    });
                    setCandidates(data.files || []);
                    setProtectedFiles(protectedList);
                    addLog(`✅ Scan terminé: ${data.count} candidats IA, ${protectedList.length} protégés`);
                });

                socket.on('scan_cancelled', (data) => {
                    setStatus('idle');
                    addLog('⚠️ Scan annulé');
                });

                socket.on('scan_error', (data) => {
                    setStatus('idle');
                    const detail = data && data.path ? `Path: ${data.path}` : null;
                    addLog({
                        message: `❌ Scan error: ${data && data.error ? data.error : 'Unknown error'}`,
                        detail,
                        color: 'text-red-400'
                    });
                });

                socket.on('analyze_started', (data) => {
                    setStatus('analyzing');
                    setAnalyzeProgress({ current: 0, total: data.total || 0, file: '' });
                });

                socket.on('analyze_progress', (data) => {
                    setAnalyzeProgress(prev => ({
                        current: data.current,
                        total: data.total,
                        file: data.file
                    }));
                    
                    // Log les décisions en temps réel
                    if (data.decision === 'DELETE') {
                        addLog({
                            message: `🟢 SUPPRIMER: ${data.file}`,
                            detail: data.reason,
                            color: 'text-green-400'
                        });
                    } else if (data.decision === 'KEEP') {
                        addLog({
                            message: `🔵 CONSERVER: ${data.file}`,
                            detail: data.reason,
                            color: 'text-blue-400'
                        });
                    } else if (data.decision === 'REVIEW') {
                        addLog({
                            message: `🟡 REVISION: ${data.file}`,
                            detail: data.reason,
                            color: 'text-yellow-400'
                        });
                    }
                });
                
                // CORRIGÉ: Gestion des résultats d'analyse
                socket.on('analyze_complete', (data) => {
                    setStatus('complete');
                    setAiThinking(null);

                    // Organiser les résultats par décision
                    const can_delete = data.results.filter(r => r.decision === 'DELETE');
                    const should_keep = data.results.filter(r => r.decision === 'KEEP');
                    const need_review = data.results.filter(r => r.decision === 'REVIEW');
                    
                    setResults({
                        can_delete: can_delete,
                        should_keep: should_keep,
                        need_review: need_review
                    });
                    
                    addLog(`✅ Analyse terminée: ${can_delete.length} à supprimer, ${should_keep.length} à conserver, ${need_review.length} à réviser`);
                });

                socket.on('analyze_error', (data) => {
                    setStatus('idle');
                    setAiThinking(null);
                    addLog({
                        message: `❌ Analyse erreur: ${data && data.error ? data.error : 'Unknown error'}`,
                        color: 'text-red-400'
                    });
                });

                socket.on('ai_thinking', (data) => {
                    if (data && data.file) {
                        setAiThinking(data);
                    }
                });

                socket.on('ai_result', () => {
                    setAiThinking(null);
                });
                
                socket.on('file_deleted', (data) => {
                    addLog(`🗑️ Supprimé: ${data.path.split('/').pop()}`);
                });

                socket.on('deletion_complete', (data) => {
                    addLog(`✅ Suppression terminée: ${data.deleted} fichiers supprimés (${data.size_freed_h} libérés)`);
                });

                // Cleanup à la fermeture de la page
                const handleUnload = () => {
                    apiFetch('/api/stop', { method: 'POST' })
                        .catch(() => {}); // Ignore les erreurs
                };
                
                window.addEventListener('beforeunload', handleUnload);

                return () => {
                    socket.off('connected');
                    socket.off('scan_started');
                    socket.off('scan_progress');
                    socket.off('scan_finished');
                    socket.off('scan_cancelled');
                    socket.off('scan_error');
                    socket.off('analyze_started');
                    socket.off('analyze_progress');
                    socket.off('analyze_complete');
                    socket.off('analyze_error');
                    socket.off('ai_thinking');
                    socket.off('ai_result');
                    socket.off('file_deleted');
                    socket.off('deletion_complete');
                    window.removeEventListener('beforeunload', handleUnload);
                };
            }, []);

            const addLog = (messageOrObj) => {
                if (typeof messageOrObj === 'string') {
                    setLogs(prev => [...prev, {
                        time: new Date().toLocaleTimeString(),
                        message: messageOrObj,
                        color: 'text-white'
                    }]);
                } else {
                    setLogs(prev => [...prev, {
                        time: new Date().toLocaleTimeString(),
                        ...messageOrObj
                    }]);
                }
            };

            const formatSize = (bytes) => {
                if (bytes < 1024) return bytes + 'B';
                if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
                if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
                return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
            };

            const truncate = (value, max = 160) => {
                if (!value) return '';
                return value.length > max ? value.slice(0, max) + '…' : value;
            };

            const selectFolder = async () => {
                try {
                    const response = await apiFetch('/api/select_folder', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    const data = await response.json();

                    if (data.ok && data.path) {
                        setConfig(prev => ({ ...prev, path: data.path }));
                        addLog(`📁 Dossier sélectionné: ${data.path}`);
                        if (data.warning) {
                            addLog({ message: `⚠️ ${data.warning}`, color: 'text-amber-300' });
                        }
                    } else {
                        addLog('❌ Sélection dossier: ' + (data.error || 'Unknown error'));
                    }
                } catch (error) {
                    addLog('❌ Sélection dossier: ' + error.message);
                }
            };

            const startScan = async () => {
                if (!config.path) {
                    addLog('❌ Sélectionne d\'abord un dossier');
                    return;
                }

                const selectedCategories = FILE_TYPE_OPTIONS
                    .filter(option => activeFileTypes[option.key])
                    .map(option => option.category);

                if (selectedCategories.length === 0) {
                    addLog('⚠️ Select at least one file type to scan');
                    return;
                }

                addLog(`🎯 Types scannés: ${selectedCategories.join(', ')}`);

                abortController.current = new AbortController();

                try {
                    const minAgeDays = Number(config.min_age_days) || 0;
                    const minSizeMb = Number(config.min_size_mb) || 0;

                    const response = await apiFetch('/api/scan', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            path: config.path,
                            categories: selectedCategories,
                            min_age_days: minAgeDays,
                            min_size_mb: minSizeMb
                        }),
                        signal: abortController.current.signal
                    });

                    const data = await response.json();
                    if (!data.ok) {
                        addLog('❌ Erreur scan: ' + data.error);
                    }
                } catch (error) {
                    if (error.name !== 'AbortError') {
                        addLog('❌ Erreur scan: ' + error.message);
                    }
                } finally {
                    abortController.current = null;
                }
            };

            const checkAiStatus = async () => {
                const modelToCheck = (config.model && config.model.trim()) || 'llama3:8b';
                try {
                    const response = await apiFetch(`/api/ai_status?model=${encodeURIComponent(modelToCheck)}`);
                    const data = await response.json();
                    if (data.ok) {
                        addLog(`✅ Ollama prêt (${modelToCheck}) via ${data.ollama_url}`);
                    } else {
                        addLog(`❌ AI setup: ${data.error || 'Unknown error'}`);
                    }
                } catch (error) {
                    addLog('❌ AI status check failed: ' + error.message);
                }
            };

            const startAnalyze = async () => {
                if (!candidates || candidates.length === 0) {
                    addLog('❌ Aucun fichier à analyser. Lancez d\'abord un scan.');
                    return;
                }

                abortController.current = new AbortController();

                const filesToAnalyze = candidates.slice(0, config.max_files);

                if (filesToAnalyze.length === 0) {
                    addLog('⚠️ Aucun fichier disponible pour l\'IA');
                    return;
                }

                const modelToUse = (config.model && config.model.trim()) || 'llama3:8b';
                setStatus('analyzing');
                setAnalyzeProgress({ current: 0, total: filesToAnalyze.length, file: '' });
                addLog(`🧠 Démarrage de l'analyse de ${filesToAnalyze.length} fichiers...`);

                try {
                    const response = await apiFetch('/api/analyze', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            paths: filesToAnalyze.map(file => file.file || file.path || file),
                            model: modelToUse,
                            max_files: config.max_files
                        }),
                        signal: abortController.current.signal
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status} on ${response.url}`);
                    }

                    const data = await response.json();

                    if (data.ok) {
                        const analyzedCount = data.count ?? filesToAnalyze.length;
                        addLog(`✅ Analyse API terminée: ${analyzedCount} fichiers traités`);
                    } else {
                        addLog('❌ Erreur analyse: ' + (data.error || 'Unknown error'));
                        setStatus('idle');
                    }
                } catch (error) {
                    if (error.name !== 'AbortError') {
                        addLog('❌ Erreur analyse: ' + error.message);
                        setStatus('idle');
                    }
                } finally {
                    abortController.current = null;
                }
            };

            const stopProcess = async () => {
                if (abortController.current) {
                    abortController.current.abort();
                    abortController.current = null;
                }

                try {
                    await apiFetch('/api/stop', {
                        method: 'POST'
                    });
                    addLog('⏹️ Processus arrêté');
                    setStatus('idle');
                    setAiThinking(null);
                } catch (error) {
                    addLog('❌ Erreur arrêt: ' + error.message);
                }
            };

            const restartProcess = () => {
                setStatus('idle');
                setScanProgress({ scanned: 0, message: '' });
                setAnalyzeProgress({ current: 0, total: 0, file: '' });
                setResults({ can_delete: [], should_keep: [], need_review: [] });
                setStats(null);
                setCandidates([]);
                setProtectedFiles([]);
                setLogs([]);
                setAiThinking(null);
                setConfig(getDefaultConfig());
                setManualPathInput('');

                localStorage.clear();

                addLog('🔄 Redémarrage - État réinitialisé');
            };

            const quickDeleteByCategory = async () => {
                const selected = Object.keys(quickDeleteCategories).filter(k => quickDeleteCategories[k]);

                if (selected.length === 0) {
                    addLog('⚠️ Aucune catégorie sélectionnée');
                    return;
                }

                if (!confirm(`Supprimer TOUS les fichiers des catégories: ${selected.join(', ')} ?`)) {
                    return;
                }

                try {
                    const response = await apiFetch('/api/delete_by_category', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ categories: selected })
                    });

                    const data = await response.json();
                    if (data.ok) {
                        addLog(`✅ Suppression rapide: ${data.deleted} fichiers (${data.size_freed_h} libérés)`);

                        if (data.errors > 0) {
                            addLog(`⚠️ ${data.errors} erreurs`);
                        }
                    } else {
                        addLog('❌ Erreur suppression: ' + data.error);
                    }
                } catch (error) {
                    addLog('❌ Erreur suppression: ' + error.message);
                }
            };

            const deleteSelected = async () => {
                const selectedPaths = results.can_delete
                    .filter(r => selectedDeleteMap[r.file])
                    .map(r => r.file);

                if (selectedPaths.length === 0) {
                    addLog('⚠️ Sélectionne au moins un fichier à supprimer');
                    return;
                }

                if (!confirm(`Supprimer ${selectedPaths.length} fichier(s) ?`)) {
                    return;
                }

                try {
                    const response = await apiFetch('/api/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            files: selectedPaths,
                            simulate: false
                        })
                    });

                    const data = await response.json();
                    if (data.ok) {
                        addLog(`✅ Supprimés: ${data.deleted} fichiers (${data.size_freed_h} libérés)`);

                        if (data.errors > 0) {
                            addLog(`⚠️ ${data.errors} erreurs`);
                        }

                        const remaining = results.can_delete.filter(item => !selectedDeleteMap[item.file]);
                        setResults({
                            ...results,
                            can_delete: remaining
                        });
                    } else {
                        addLog('❌ Erreur suppression: ' + data.error);
                    }
                } catch (error) {
                    addLog('❌ Erreur suppression: ' + error.message);
                }
            };

            const totalCandidateBytes = candidates.reduce((sum, file) => sum + (file.size || 0), 0);
            const overviewSizeLabel = totalCandidateBytes > 0 ? formatSize(totalCandidateBytes) : '0.0 B';
            const scanStatusLabel = status === 'scanning' ? 'Scan…' : (config.path ? 'Ready' : 'Choisir');
            const aiStatusLabel = status === 'analyzing' ? 'Analyse…' : (results.can_delete.length || results.should_keep.length ? 'Terminé' : 'Waiting');
            const selectedDeleteCount = results.can_delete.filter(r => selectedDeleteMap[r.file]).length;

            const toggleDeleteSelection = (file, checked) => {
                setSelectedDeleteMap(prev => ({
                    ...prev,
                    [file]: checked
                }));
            };

            return (
                <div className="min-h-screen text-white" style={{ background: 'radial-gradient(circle at 0% 0%, rgba(57,84,222,0.3), transparent 60%), #050a19' }}>
                    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
                        <header className="space-y-2">
                            <p className="text-xs uppercase tracking-[0.3em] text-white/50">AI Cleaner</p>
                            <div className="flex flex-wrap items-end justify-between gap-4">
                                <div>
                                    <h1 className="text-4xl font-semibold tracking-tight">AI Cleaner v3.0</h1>
                                    <p className="text-sm text-white/70">Nettoyage assisté par IA dans une seule vue lisible.</p>
                                </div>
                                <div style={{ textAlign: 'right' }} className="text-xs text-white/60 space-y-1">
                                    <p>{candidates.length} fichiers candidats</p>
                                    <p>{selectedDeleteCount} prêts à supprimer</p>
                                </div>
                            </div>
                        </header>

                        <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)360px]">
                            <aside className="space-y-5">
                                <div className="rounded-3xl bg-white/5 border border-white/10 p-5 space-y-3 backdrop-blur">
                                    {[
                                        { label: 'Overview', icon: '📦', value: overviewSizeLabel },
                                        { label: 'Scan Folder', icon: '🗂️', value: scanStatusLabel },
                                        { label: 'AI Analysis', icon: '🧠', value: aiStatusLabel }
                                    ].map(item => (
                                        <div key={item.label} className="flex items-center justify-between rounded-2xl px-3 py-2 bg-white/5 border border-white/10">
                                            <div className="flex items-center gap-3">
                                                <span className="text-lg">{item.icon}</span>
                                                <span className="text-sm font-medium">{item.label}</span>
                                            </div>
                                            <span className="text-xs text-white/60">{item.value}</span>
                                        </div>
                                    ))}
                                </div>

                                <div className="rounded-3xl bg-white/5 border border-white/10 p-5 space-y-4 backdrop-blur">
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm font-semibold">Dossier</p>
                                        <span className="text-xs text-white/50">{config.path ? 'Sélectionné' : 'Aucun'}</span>
                                    </div>
                                    <div className="rounded-2xl bg-white/10 border border-white/10 px-3 py-2 text-sm truncate">{config.path || 'Choisis un dossier dans Finder'}</div>
                                    <div className="flex gap-3">
                                        <button onClick={selectFolder} className="btn-primary flex-1">Choisir…</button>
                                        <button onClick={restartProcess} className="btn-ghost">Reset</button>
                                    </div>
                                </div>

                                <div className="rounded-3xl bg-white/5 border border-white/10 p-5 space-y-4 backdrop-blur">
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm font-semibold">Types analysés</p>
                                        <span className="text-xs text-white/60">{activeFileTypeCount}/6 actifs</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                    {FILE_TYPE_OPTIONS.map(option => {
                                        const isActive = !!activeFileTypes[option.key];
                                        return (
                                            <button
                                                key={option.key}
                                                onClick={() => toggleFileType(option.key)}
                                                className={`flex items-center gap-3 rounded-2xl border px-3 py-2 text-left transition ${isActive ? 'bg-white text-slate-900 border-white/80 shadow-lg' : 'bg-white/5 border-white/20 text-white/70'}`}
                                            >
                                                <span className="text-lg">{option.emoji}</span>
                                                <div>
                                                    <p className="text-sm font-semibold">{option.label}</p>
                                                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/60">{option.category}</p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 text-xs text-white/70">
                                        <label className="space-y-1">
                                            <span>Âge min (jours)</span>
                                            <input
                                                type="number"
                                                min="0"
                                                value={config.min_age_days}
                                                onChange={(e) => setConfig({ ...config, min_age_days: Math.max(0, parseInt(e.target.value) || 0) })}
                                                className="filter-input"
                                            />
                                        </label>
                                        <label className="space-y-1">
                                            <span>Taille min (MB)</span>
                                            <input
                                                type="number"
                                                min="0"
                                                value={config.min_size_mb}
                                                onChange={(e) => setConfig({ ...config, min_size_mb: Math.max(0, parseFloat(e.target.value) || 0) })}
                                                className="filter-input"
                                            />
                                        </label>
                                    </div>
                                </div>
                            </aside>

                            <main className="space-y-5">
                                <section className="rounded-3xl border border-white/15 bg-white/5 p-5 space-y-4 backdrop-blur">
                                    <div className="flex flex-wrap items-center justify-between gap-4">
                                        <div>
                                            <p className="text-xs uppercase tracking-[0.2em] text-white/60">Contrôle</p>
                                            <p className="text-lg font-semibold">Scan & Analyse des fichiers</p>
                                            <p className="text-sm text-white/60">{config.path ? 'Prêt à scanner' : 'Sélectionne un dossier pour commencer'}</p>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                onClick={startScan}
                                                disabled={!config.path || status === 'scanning'}
                                                className="btn-primary"
                                            >
                                                ▶ Scan
                                            </button>
                                            <button
                                                onClick={stopProcess}
                                                disabled={status === 'idle'}
                                                className="btn-outline"
                                            >
                                                ⏸ Stop
                                            </button>
                                            <button
                                                onClick={startAnalyze}
                                                disabled={status === 'analyzing' || candidates.length === 0}
                                                className="btn-outline"
                                            >
                                                🧠 Lancer l'IA
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
                                        <span>{scanProgress.message || 'Attente de scan'}</span>
                                        <span>•</span>
                                        <span>{analyzeProgress.total ? `${analyzeProgress.current}/${analyzeProgress.total} analysés` : 'Analyse non démarrée'}</span>
                                    </div>
                                </section>

                                {(status === 'scanning' || status === 'analyzing' || aiThinking) && (
                                    <section className="rounded-3xl border border-white/10 bg-white/5 p-4 space-y-3 backdrop-blur">
                                        <div className="flex items-center justify-between text-xs text-white/70">
                                            <span>{status === 'scanning' ? (scanProgress.message || 'Scan en cours') : 'Analyse IA en cours'}</span>
                                            <span>{status === 'scanning' ? `${scanProgress.scanned} fichiers` : `${analyzeProgress.current}/${analyzeProgress.total || 0}`}</span>
                                        </div>
                                        <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-white"
                                                style={{ width: status === 'scanning' ? '100%' : `${(analyzeProgress.current / (analyzeProgress.total || 1)) * 100}%` }}
                                            ></div>
                                        </div>
                                        {aiThinking && (
                                            <div className="text-xs text-white/80 font-mono thinking space-y-1">
                                                <p>Analyse: {aiThinking.file}</p>
                                                {aiThinking.prompt && (
                                                    <p className="text-white/60">Prompt: {truncate(aiThinking.prompt, 160)}</p>
                                                )}
                                            </div>
                                        )}
                                    </section>
                                )}

                                <section className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4 backdrop-blur">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-lg font-semibold">Résultats IA</h3>
                                        <span className="text-xs text-white/60">{selectedDeleteCount} sélectionnés</span>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-3">
                                        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                                            <p className="text-xs uppercase tracking-[0.25em] text-white/60">Protégés</p>
                                            <ul className="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1">
                                                {protectedFiles.length > 0 ? protectedFiles.map((file, idx) => (
                                                    <li key={`${file.file}-${idx}`} className="flex items-start gap-3 text-sm">
                                                        <span className="text-rose-200">⚑</span>
                                                        <div>
                                                            <p className="font-semibold">{file.name}</p>
                                                            <p className="text-[11px] text-white/60">{file.keyword} • {file.size_h}</p>
                                                        </div>
                                                    </li>
                                                )) : (
                                                    <p className="text-xs text-white/60">Aucun fichier sensible.</p>
                                                )}
                                            </ul>
                                        </div>
                                        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                                            <p className="text-xs uppercase tracking-[0.25em] text-white/60">Conservés</p>
                                            <ul className="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1">
                                                {results.should_keep.length > 0 ? results.should_keep.map((file, idx) => (
                                                    <li key={`${file.file}-keep-${idx}`} className="flex items-start gap-3 text-sm">
                                                        <span className="text-emerald-200">•</span>
                                                        <div>
                                                            <p className="font-semibold">{file.name}</p>
                                                            <p className="text-[11px] text-white/60">{file.reason}</p>
                                                        </div>
                                                    </li>
                                                )) : (
                                                    <p className="text-xs text-white/60">Pas encore de décision.</p>
                                                )}
                                            </ul>
                                        </div>
                                        <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                                            <p className="text-xs uppercase tracking-[0.25em] text-white/60">À supprimer</p>
                                            <ul className="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1">
                                                {results.can_delete.length > 0 ? results.can_delete.map((file, idx) => (
                                                    <li key={`${file.file}-delete-${idx}`} className="flex items-center gap-3 text-sm">
                                                        <input
                                                            type="checkbox"
                                                            checked={!!selectedDeleteMap[file.file]}
                                                            onChange={(e) => toggleDeleteSelection(file.file, e.target.checked)}
                                                            className="rounded border-white/40 bg-transparent"
                                                        />
                                                        <div className="flex-1">
                                                            <p className="font-semibold">{file.name}</p>
                                                            <p className="text-[11px] text-white/60">{file.reason}</p>
                                                        </div>
                                                        <span className="text-xs text-white/60">{file.size_h}</span>
                                                    </li>
                                                )) : (
                                                    <p className="text-xs text-white/60">Aucun fichier à supprimer.</p>
                                                )}
                                            </ul>
                                        </div>
                                    </div>
                                    <button
                                        onClick={deleteSelected}
                                        disabled={selectedDeleteCount === 0}
                                        className="btn-primary w-full"
                                    >
                                        Supprimer les fichiers sélectionnés ({selectedDeleteCount})
                                    </button>
                                </section>

                                <section className="grid gap-4 md:grid-cols-2">
                                    <div className="rounded-3xl bg-white/5 border border-white/10 p-5 space-y-3 backdrop-blur">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-lg font-semibold">Statistiques</h3>
                                            <span className="text-xs text-white/50">Dernier scan</span>
                                        </div>
                                        {stats ? (
                                            <div className="space-y-2 text-sm text-white/70">
                                                <div className="flex justify-between">
                                                    <span>Total scannés</span>
                                                    <span>{stats.total_files || 0}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span>Candidats IA</span>
                                                    <span>{stats.candidate_count ?? candidates.length}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span>Limite analyse</span>
                                                    <span>{Math.min(candidates.length, config.max_files)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span>Protégés</span>
                                                    <span>{protectedFiles.length}</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-white/60">Aucune donnée pour l'instant.</p>
                                        )}
                                    </div>
                                    <div className="rounded-3xl bg-white/5 border border-white/10 p-5 space-y-3 backdrop-blur">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-lg font-semibold">Suppression rapide</h3>
                                            <span className="text-xs text-white/50">Catégories</span>
                                        </div>
                                        {stats && stats.stats ? (
                                            <div className="space-y-2 text-sm">
                                                {Object.keys(quickDeleteCategories).map(category => {
                                                    const categoryStats = stats.stats[category];
                                                    if (!categoryStats || categoryStats.count === 0) return null;
                                                    return (
                                                        <label key={category} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={quickDeleteCategories[category]}
                                                                onChange={(e) => setQuickDeleteCategories({
                                                                    ...quickDeleteCategories,
                                                                    [category]: e.target.checked
                                                                })}
                                                                className="rounded border-white/40 bg-transparent"
                                                            />
                                                            <div className="flex-1">
                                                                <p className="font-medium">{category}</p>
                                                                <p className="text-xs text-white/60">{categoryStats.count} fichiers • {categoryStats.size_h}</p>
                                                            </div>
                                                        </label>
                                                    );
                                                })}
                                                <button onClick={quickDeleteByCategory} className="btn-outline w-full">Supprimer les catégories cochées</button>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-white/60">Lance un scan pour afficher ces options.</p>
                                        )}
                                    </div>
                                </section>
                            </main>

                            <aside className="rounded-3xl bg-white/5 border border-white/10 p-5 flex flex-col backdrop-blur">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-lg font-semibold">Logs en direct</h3>
                                    <button className="btn-ghost text-xs" onClick={() => setLogs([])}>Effacer</button>
                                </div>
                                <div className="flex-1 rounded-2xl border border-white/10 p-4 overflow-y-auto font-mono text-xs leading-relaxed text-white/80 space-y-3" style={{ background: '#070c1f' }}>
                                    {logs.length === 0 && <p className="text-white/40">En attente d'évènements…</p>}
                                    {logs.map((log, i) => (
                                        <div key={i} className="space-y-1">
                                            <div className={log.color || 'text-white/80'}>
                                                <span className="text-white/40">[{log.time}]</span> {log.message}
                                            </div>
                                            {log.detail && (
                                                <div className="text-[11px] text-white/40 pl-6">
                                                    {log.detail}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <p className="mt-4 text-[11px] text-white/50">Les journaux sont mis à jour automatiquement.</p>
                            </aside>
                        </div>
                    </div>
                </div>
            );
        }

        ReactDOM.render(<App />, document.getElementById('app'));
