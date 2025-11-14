const { useState, useEffect, useRef } = React;

const _jsxDEV = (type, config, maybeKey, ...rest) => {
  let props = config == null ? config : { ...config };
  if (maybeKey !== undefined && maybeKey !== null) {
    if (props == null) {
      props = { key: maybeKey };
    } else {
      props = { ...props, key: maybeKey };
    }
  }
  return React.createElement(type, props);
};
const inferApiBase = () => {
  const origin = window.location.origin;
  if (origin && origin.startsWith("http")) {
    return origin.replace(/\/$/, "");
  }
  return "http://localhost:5000";
};
const API_BASE = inferApiBase();
const apiUrl = (path = "/") => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
const apiFetch = (path, options = {}) => fetch(apiUrl(path), options);
const socket = io(API_BASE, { transports: ["websocket", "polling"] });
const FILE_TYPE_OPTIONS = [
  { key: "images", label: "Images", category: "Images", emoji: "\uD83D\uDDBC️" },
  { key: "videos", label: "Vidéos", category: "Videos", emoji: "\uD83C\uDF9E️" },
  { key: "audio", label: "Audio", category: "Audio", emoji: "\uD83C\uDFA7" },
  { key: "documents", label: "Textes & Docs", category: "Documents", emoji: "\uD83D\uDCC4" },
  { key: "archives", label: "Archives", category: "Archives", emoji: "\uD83D\uDDDC️" },
  { key: "other", label: "Autres", category: "Autres", emoji: "\uD83D\uDCE6" }
];
const DEFAULT_FILE_TYPES = FILE_TYPE_OPTIONS.reduce((acc, option) => {
  acc[option.key] = !["archives", "other"].includes(option.key);
  return acc;
}, {});
const saveState = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("Erreur sauvegarde état:", e);
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
  path: "",
  min_age_days: 0,
  min_size_mb: 0,
  max_files: 100,
  model: "llama3:8b",
  exclude_audio: false,
  exclude_images: false,
  exclude_videos: false,
  delete_empty: true,
  organize_kept_files: true,
  fileTypes: { ...DEFAULT_FILE_TYPES }
});
function App() {
  const [status, setStatus] = useState(loadState("status", "idle"));
  const [config, setConfig] = useState(() => {
    const saved = loadState("config", null);
    if (!saved) {
      return getDefaultConfig();
    }
    return {
      ...getDefaultConfig(),
      ...saved,
      fileTypes: { ...DEFAULT_FILE_TYPES, ...saved.fileTypes || {} }
    };
  });
  const [quickDeleteCategories, setQuickDeleteCategories] = useState(loadState("quickDeleteCategories", {
    Installers: false,
    Archives: false,
    Images: false,
    Documents: false,
    Audio: false,
    Videos: false,
    Autres: false
  }));
  const [scanProgress, setScanProgress] = useState(loadState("scanProgress", { scanned: 0, message: "" }));
  const [manualPathInput, setManualPathInput] = useState(config.path || "");
  const [analyzeProgress, setAnalyzeProgress] = useState(loadState("analyzeProgress", { current: 0, total: 0, file: "" }));
  const [aiThinking, setAiThinking] = useState(null);
  const [results, setResults] = useState(loadState("results", { can_delete: [], should_keep: [], need_review: [] }));
  const [selectedDeleteMap, setSelectedDeleteMap] = useState({});
  const [stats, setStats] = useState(loadState("stats", null));
  const [candidates, setCandidates] = useState(loadState("candidates", []));
  const [protectedFiles, setProtectedFiles] = useState(loadState("protectedFiles", []));
  const [logs, setLogs] = useState(loadState("logs", []));
  const abortController = useRef(null);
  const activeFileTypes = { ...DEFAULT_FILE_TYPES, ...config.fileTypes || {} };
  const activeFileTypeCount = Object.values(activeFileTypes).filter(Boolean).length;
  const toggleFileType = (key) => {
    setConfig((prev) => {
      const merged = { ...DEFAULT_FILE_TYPES, ...prev.fileTypes || {} };
      return {
        ...prev,
        fileTypes: {
          ...merged,
          [key]: !merged[key]
        }
      };
    });
  };
  useEffect(() => {
    saveState("status", status);
  }, [status]);
  useEffect(() => {
    saveState("config", config);
  }, [config]);
  useEffect(() => {
    saveState("quickDeleteCategories", quickDeleteCategories);
  }, [quickDeleteCategories]);
  useEffect(() => {
    saveState("scanProgress", scanProgress);
  }, [scanProgress]);
  useEffect(() => {
    saveState("analyzeProgress", analyzeProgress);
  }, [analyzeProgress]);
  useEffect(() => {
    saveState("results", results);
  }, [results]);
  useEffect(() => {
    setSelectedDeleteMap((prev) => {
      const next = {};
      (results.can_delete || []).forEach((entry) => {
        next[entry.file] = prev[entry.file] ?? true;
      });
      return next;
    });
  }, [results.can_delete]);
  useEffect(() => {
    saveState("stats", stats);
  }, [stats]);
  useEffect(() => {
    saveState("candidates", candidates);
  }, [candidates]);
  useEffect(() => {
    saveState("protectedFiles", protectedFiles);
  }, [protectedFiles]);
  useEffect(() => {
    saveState("logs", logs);
  }, [logs]);
  useEffect(() => {
    setManualPathInput(config.path || "");
  }, [config.path]);
  useEffect(() => {
    socket.on("connected", () => addLog("✅ Connecté au serveur"));
    socket.on("scan_started", (data) => {
      setStatus("scanning");
      setCandidates([]);
      setProtectedFiles([]);
      setStats(null);
      setScanProgress({ scanned: 0, message: "Scan démarré..." });
      setAiThinking(null);
      addLog(`\uD83D\uDD0D Scan démarré: ${data.path}`);
    });
    socket.on("scan_progress", (data) => {
      setScanProgress(data);
    });
    socket.on("scan_finished", (data) => {
      setStatus("idle");
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
    socket.on("scan_cancelled", (data) => {
      setStatus("idle");
      addLog("⚠️ Scan annulé");
    });
    socket.on("scan_error", (data) => {
      setStatus("idle");
      const detail = data && data.path ? `Path: ${data.path}` : null;
      addLog({
        message: `❌ Scan error: ${data && data.error ? data.error : "Unknown error"}`,
        detail,
        color: "text-red-400"
      });
    });
    socket.on("analyze_started", (data) => {
      setStatus("analyzing");
      setAnalyzeProgress({ current: 0, total: data.total || 0, file: "" });
    });
    socket.on("analyze_progress", (data) => {
      setAnalyzeProgress((prev) => ({
        current: data.current,
        total: data.total,
        file: data.file
      }));
      if (data.decision === "DELETE") {
        addLog({
          message: `\uD83D\uDFE2 SUPPRIMER: ${data.file}`,
          detail: data.reason,
          color: "text-green-400"
        });
      } else if (data.decision === "KEEP") {
        addLog({
          message: `\uD83D\uDD35 CONSERVER: ${data.file}`,
          detail: data.reason,
          color: "text-blue-400"
        });
      } else if (data.decision === "REVIEW") {
        addLog({
          message: `\uD83D\uDFE1 REVISION: ${data.file}`,
          detail: data.reason,
          color: "text-yellow-400"
        });
      }
    });
    socket.on("analyze_complete", (data) => {
      setStatus("complete");
      setAiThinking(null);
      const can_delete = data.results.filter((r) => r.decision === "DELETE");
      const should_keep = data.results.filter((r) => r.decision === "KEEP");
      const need_review = data.results.filter((r) => r.decision === "REVIEW");
      setResults({
        can_delete,
        should_keep,
        need_review
      });
      addLog(`✅ Analyse terminée: ${can_delete.length} à supprimer, ${should_keep.length} à conserver, ${need_review.length} à réviser`);
    });
    socket.on("analyze_error", (data) => {
      setStatus("idle");
      setAiThinking(null);
      addLog({
        message: `❌ Analyse erreur: ${data && data.error ? data.error : "Unknown error"}`,
        color: "text-red-400"
      });
    });
    socket.on("ai_thinking", (data) => {
      if (data && data.file) {
        setAiThinking(data);
      }
    });
    socket.on("ai_result", () => {
      setAiThinking(null);
    });
    socket.on("file_deleted", (data) => {
      addLog(`\uD83D\uDDD1️ Supprimé: ${data.path.split("/").pop()}`);
    });
    socket.on("deletion_complete", (data) => {
      addLog(`✅ Suppression terminée: ${data.deleted} fichiers supprimés (${data.size_freed_h} libérés)`);
    });
    const handleUnload = () => {
      apiFetch("/api/stop", { method: "POST" }).catch(() => {});
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      socket.off("connected");
      socket.off("scan_started");
      socket.off("scan_progress");
      socket.off("scan_finished");
      socket.off("scan_cancelled");
      socket.off("scan_error");
      socket.off("analyze_started");
      socket.off("analyze_progress");
      socket.off("analyze_complete");
      socket.off("analyze_error");
      socket.off("ai_thinking");
      socket.off("ai_result");
      socket.off("file_deleted");
      socket.off("deletion_complete");
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);
  const addLog = (messageOrObj) => {
    if (typeof messageOrObj === "string") {
      setLogs((prev) => [...prev, {
        time: new Date().toLocaleTimeString(),
        message: messageOrObj,
        color: "text-white"
      }]);
    } else {
      setLogs((prev) => [...prev, {
        time: new Date().toLocaleTimeString(),
        ...messageOrObj
      }]);
    }
  };
  const formatSize = (bytes) => {
    if (bytes < 1024)
      return bytes + "B";
    if (bytes < 1024 * 1024)
      return (bytes / 1024).toFixed(1) + "KB";
    if (bytes < 1024 * 1024 * 1024)
      return (bytes / (1024 * 1024)).toFixed(1) + "MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + "GB";
  };
  const truncate = (value, max = 160) => {
    if (!value)
      return "";
    return value.length > max ? value.slice(0, max) + "…" : value;
  };
  const selectFolder = async () => {
    try {
      const response = await apiFetch("/api/select_folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await response.json();
      if (data.ok && data.path) {
        setConfig((prev) => ({ ...prev, path: data.path }));
        addLog(`\uD83D\uDCC1 Dossier sélectionné: ${data.path}`);
        if (data.warning) {
          addLog({ message: `⚠️ ${data.warning}`, color: "text-amber-300" });
        }
      } else {
        addLog("❌ Sélection dossier: " + (data.error || "Unknown error"));
      }
    } catch (error) {
      addLog("❌ Sélection dossier: " + error.message);
    }
  };
  const startScan = async () => {
    if (!config.path) {
      addLog("❌ Sélectionne d'abord un dossier");
      return;
    }
    const selectedCategories = FILE_TYPE_OPTIONS.filter((option) => activeFileTypes[option.key]).map((option) => option.category);
    if (selectedCategories.length === 0) {
      addLog("⚠️ Select at least one file type to scan");
      return;
    }
    addLog(`\uD83C\uDFAF Types scannés: ${selectedCategories.join(", ")}`);
    abortController.current = new AbortController;
    try {
      const minAgeDays = Number(config.min_age_days) || 0;
      const minSizeMb = Number(config.min_size_mb) || 0;
      const response = await apiFetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        addLog("❌ Erreur scan: " + data.error);
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        addLog("❌ Erreur scan: " + error.message);
      }
    } finally {
      abortController.current = null;
    }
  };
  const checkAiStatus = async () => {
    const modelToCheck = config.model && config.model.trim() || "llama3:8b";
    try {
      const response = await apiFetch(`/api/ai_status?model=${encodeURIComponent(modelToCheck)}`);
      const data = await response.json();
      if (data.ok) {
        addLog(`✅ Ollama prêt (${modelToCheck}) via ${data.ollama_url}`);
      } else {
        addLog(`❌ AI setup: ${data.error || "Unknown error"}`);
      }
    } catch (error) {
      addLog("❌ AI status check failed: " + error.message);
    }
  };
  const startAnalyze = async () => {
    if (!candidates || candidates.length === 0) {
      addLog("❌ Aucun fichier à analyser. Lancez d'abord un scan.");
      return;
    }
    abortController.current = new AbortController;
    const filesToAnalyze = candidates.slice(0, config.max_files);
    if (filesToAnalyze.length === 0) {
      addLog("⚠️ Aucun fichier disponible pour l'IA");
      return;
    }
    const modelToUse = config.model && config.model.trim() || "llama3:8b";
    setStatus("analyzing");
    setAnalyzeProgress({ current: 0, total: filesToAnalyze.length, file: "" });
    addLog(`\uD83E\uDDE0 Démarrage de l'analyse de ${filesToAnalyze.length} fichiers...`);
    try {
      const response = await apiFetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paths: filesToAnalyze.map((file) => file.file || file.path || file),
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
        addLog("❌ Erreur analyse: " + (data.error || "Unknown error"));
        setStatus("idle");
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        addLog("❌ Erreur analyse: " + error.message);
        setStatus("idle");
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
      await apiFetch("/api/stop", {
        method: "POST"
      });
      addLog("⏹️ Processus arrêté");
      setStatus("idle");
      setAiThinking(null);
    } catch (error) {
      addLog("❌ Erreur arrêt: " + error.message);
    }
  };
  const restartProcess = () => {
    setStatus("idle");
    setScanProgress({ scanned: 0, message: "" });
    setAnalyzeProgress({ current: 0, total: 0, file: "" });
    setResults({ can_delete: [], should_keep: [], need_review: [] });
    setStats(null);
    setCandidates([]);
    setProtectedFiles([]);
    setLogs([]);
    setAiThinking(null);
    setConfig(getDefaultConfig());
    setManualPathInput("");
    localStorage.clear();
    addLog("\uD83D\uDD04 Redémarrage - État réinitialisé");
  };
  const quickDeleteByCategory = async () => {
    const selected = Object.keys(quickDeleteCategories).filter((k) => quickDeleteCategories[k]);
    if (selected.length === 0) {
      addLog("⚠️ Aucune catégorie sélectionnée");
      return;
    }
    if (!confirm(`Supprimer TOUS les fichiers des catégories: ${selected.join(", ")} ?`)) {
      return;
    }
    try {
      const response = await apiFetch("/api/delete_by_category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: selected })
      });
      const data = await response.json();
      if (data.ok) {
        addLog(`✅ Suppression rapide: ${data.deleted} fichiers (${data.size_freed_h} libérés)`);
        if (data.errors > 0) {
          addLog(`⚠️ ${data.errors} erreurs`);
        }
      } else {
        addLog("❌ Erreur suppression: " + data.error);
      }
    } catch (error) {
      addLog("❌ Erreur suppression: " + error.message);
    }
  };
  const deleteSelected = async () => {
    const selectedPaths = results.can_delete.filter((r) => selectedDeleteMap[r.file]).map((r) => r.file);
    if (selectedPaths.length === 0) {
      addLog("⚠️ Sélectionne au moins un fichier à supprimer");
      return;
    }
    if (!confirm(`Supprimer ${selectedPaths.length} fichier(s) ?`)) {
      return;
    }
    try {
      const response = await apiFetch("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        const remaining = results.can_delete.filter((item) => !selectedDeleteMap[item.file]);
        setResults({
          ...results,
          can_delete: remaining
        });
      } else {
        addLog("❌ Erreur suppression: " + data.error);
      }
    } catch (error) {
      addLog("❌ Erreur suppression: " + error.message);
    }
  };
  const totalCandidateBytes = candidates.reduce((sum, file) => sum + (file.size || 0), 0);
  const overviewSizeLabel = totalCandidateBytes > 0 ? formatSize(totalCandidateBytes) : "0.0 B";
  const scanStatusLabel = status === "scanning" ? "Scan…" : config.path ? "Ready" : "Choisir";
  const aiStatusLabel = status === "analyzing" ? "Analyse…" : results.can_delete.length || results.should_keep.length ? "Terminé" : "Waiting";
  const selectedDeleteCount = results.can_delete.filter((r) => selectedDeleteMap[r.file]).length;
  const toggleDeleteSelection = (file, checked) => {
    setSelectedDeleteMap((prev) => ({
      ...prev,
      [file]: checked
    }));
  };
  return _jsxDEV("div", {
    className: "min-h-screen text-white",
    style: { background: "radial-gradient(circle at 0% 0%, rgba(57,84,222,0.3), transparent 60%), #050a19" },
    children: _jsxDEV("div", {
      className: "max-w-7xl mx-auto px-4 py-8 space-y-6",
      children: [
        _jsxDEV("header", {
          className: "space-y-2",
          children: [
            _jsxDEV("p", {
              className: "text-xs uppercase tracking-[0.3em] text-white/50",
              children: "AI Cleaner"
            }, undefined, false, undefined, this),
            _jsxDEV("div", {
              className: "flex flex-wrap items-end justify-between gap-4",
              children: [
                _jsxDEV("div", {
                  children: [
                    _jsxDEV("h1", {
                      className: "text-4xl font-semibold tracking-tight",
                      children: "AI Cleaner v3.0"
                    }, undefined, false, undefined, this),
                    _jsxDEV("p", {
                      className: "text-sm text-white/70",
                      children: "Nettoyage assisté par IA dans une seule vue lisible."
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                _jsxDEV("div", {
                  style: { textAlign: "right" },
                  className: "text-xs text-white/60 space-y-1",
                  children: [
                    _jsxDEV("p", {
                      children: [
                        candidates.length,
                        " fichiers candidats"
                      ]
                    }, undefined, true, undefined, this),
                    _jsxDEV("p", {
                      children: [
                        selectedDeleteCount,
                        " prêts à supprimer"
                      ]
                    }, undefined, true, undefined, this)
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this)
          ]
        }, undefined, true, undefined, this),
        _jsxDEV("div", {
          className: "grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)360px]",
          children: [
            _jsxDEV("aside", {
              className: "space-y-5",
              children: [
                _jsxDEV("div", {
                  className: "rounded-3xl bg-white/5 border border-white/10 p-5 space-y-3 backdrop-blur",
                  children: [
                    { label: "Overview", icon: "\uD83D\uDCE6", value: overviewSizeLabel },
                    { label: "Scan Folder", icon: "\uD83D\uDDC2️", value: scanStatusLabel },
                    { label: "AI Analysis", icon: "\uD83E\uDDE0", value: aiStatusLabel }
                  ].map((item) => _jsxDEV("div", {
                    className: "flex items-center justify-between rounded-2xl px-3 py-2 bg-white/5 border border-white/10",
                    children: [
                      _jsxDEV("div", {
                        className: "flex items-center gap-3",
                        children: [
                          _jsxDEV("span", {
                            className: "text-lg",
                            children: item.icon
                          }, undefined, false, undefined, this),
                          _jsxDEV("span", {
                            className: "text-sm font-medium",
                            children: item.label
                          }, undefined, false, undefined, this)
                        ]
                      }, undefined, true, undefined, this),
                      _jsxDEV("span", {
                        className: "text-xs text-white/60",
                        children: item.value
                      }, undefined, false, undefined, this)
                    ]
                  }, item.label, true, undefined, this))
                }, undefined, false, undefined, this),
                _jsxDEV("div", {
                  className: "rounded-3xl bg-white/5 border border-white/10 p-5 space-y-4 backdrop-blur",
                  children: [
                    _jsxDEV("div", {
                      className: "flex items-center justify-between",
                      children: [
                        _jsxDEV("p", {
                          className: "text-sm font-semibold",
                          children: "Dossier"
                        }, undefined, false, undefined, this),
                        _jsxDEV("span", {
                          className: "text-xs text-white/50",
                          children: config.path ? "Sélectionné" : "Aucun"
                        }, undefined, false, undefined, this)
                      ]
                    }, undefined, true, undefined, this),
                    _jsxDEV("div", {
                      className: "rounded-2xl bg-white/10 border border-white/10 px-3 py-2 text-sm truncate",
                      children: config.path || "Choisis un dossier dans Finder"
                    }, undefined, false, undefined, this),
                    _jsxDEV("div", {
                      className: "flex gap-3",
                      children: [
                        _jsxDEV("button", {
                          onClick: selectFolder,
                          className: "btn-primary flex-1",
                          children: "Choisir…"
                        }, undefined, false, undefined, this),
                        _jsxDEV("button", {
                          onClick: restartProcess,
                          className: "btn-ghost",
                          children: "Reset"
                        }, undefined, false, undefined, this)
                      ]
                    }, undefined, true, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                _jsxDEV("div", {
                  className: "rounded-3xl bg-white/5 border border-white/10 p-5 space-y-4 backdrop-blur",
                  children: [
                    _jsxDEV("div", {
                      className: "flex items-center justify-between",
                      children: [
                        _jsxDEV("p", {
                          className: "text-sm font-semibold",
                          children: "Types analysés"
                        }, undefined, false, undefined, this),
                        _jsxDEV("span", {
                          className: "text-xs text-white/60",
                          children: [
                            activeFileTypeCount,
                            "/6 actifs"
                          ]
                        }, undefined, true, undefined, this)
                      ]
                    }, undefined, true, undefined, this),
                    _jsxDEV("div", {
                      className: "grid grid-cols-2 gap-3",
                      children: FILE_TYPE_OPTIONS.map((option) => {
                        const isActive = !!activeFileTypes[option.key];
                        return _jsxDEV("button", {
                          onClick: () => toggleFileType(option.key),
                          className: `flex items-center gap-3 rounded-2xl border px-3 py-2 text-left transition ${isActive ? "bg-white text-slate-900 border-white/80 shadow-lg" : "bg-white/5 border-white/20 text-white/70"}`,
                          children: [
                            _jsxDEV("span", {
                              className: "text-lg",
                              children: option.emoji
                            }, undefined, false, undefined, this),
                            _jsxDEV("div", {
                              children: [
                                _jsxDEV("p", {
                                  className: "text-sm font-semibold",
                                  children: option.label
                                }, undefined, false, undefined, this),
                                _jsxDEV("p", {
                                  className: "text-[11px] uppercase tracking-[0.2em] text-white/60",
                                  children: option.category
                                }, undefined, false, undefined, this)
                              ]
                            }, undefined, true, undefined, this)
                          ]
                        }, option.key, true, undefined, this);
                      })
                    }, undefined, false, undefined, this),
                    _jsxDEV("div", {
                      className: "grid grid-cols-2 gap-3 text-xs text-white/70",
                      children: [
                        _jsxDEV("label", {
                          className: "space-y-1",
                          children: [
                            _jsxDEV("span", {
                              children: "Âge min (jours)"
                            }, undefined, false, undefined, this),
                            _jsxDEV("input", {
                              type: "number",
                              min: "0",
                              value: config.min_age_days,
                              onChange: (e) => setConfig({ ...config, min_age_days: Math.max(0, parseInt(e.target.value) || 0) }),
                              className: "filter-input"
                            }, undefined, false, undefined, this)
                          ]
                        }, undefined, true, undefined, this),
                        _jsxDEV("label", {
                          className: "space-y-1",
                          children: [
                            _jsxDEV("span", {
                              children: "Taille min (MB)"
                            }, undefined, false, undefined, this),
                            _jsxDEV("input", {
                              type: "number",
                              min: "0",
                              value: config.min_size_mb,
                              onChange: (e) => setConfig({ ...config, min_size_mb: Math.max(0, parseFloat(e.target.value) || 0) }),
                              className: "filter-input"
                            }, undefined, false, undefined, this)
                          ]
                        }, undefined, true, undefined, this)
                      ]
                    }, undefined, true, undefined, this)
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this),
            _jsxDEV("main", {
              className: "space-y-5",
              children: [
                _jsxDEV("section", {
                  className: "rounded-3xl border border-white/15 bg-white/5 p-5 space-y-4 backdrop-blur",
                  children: [
                    _jsxDEV("div", {
                      className: "flex flex-wrap items-center justify-between gap-4",
                      children: [
                        _jsxDEV("div", {
                          children: [
                            _jsxDEV("p", {
                              className: "text-xs uppercase tracking-[0.2em] text-white/60",
                              children: "Contrôle"
                            }, undefined, false, undefined, this),
                            _jsxDEV("p", {
                              className: "text-lg font-semibold",
                              children: "Scan & Analyse des fichiers"
                            }, undefined, false, undefined, this),
                            _jsxDEV("p", {
                              className: "text-sm text-white/60",
                              children: config.path ? "Prêt à scanner" : "Sélectionne un dossier pour commencer"
                            }, undefined, false, undefined, this)
                          ]
                        }, undefined, true, undefined, this),
                        _jsxDEV("div", {
                          className: "flex flex-wrap gap-2",
                          children: [
                            _jsxDEV("button", {
                              onClick: startScan,
                              disabled: !config.path || status === "scanning",
                              className: "btn-primary",
                              children: "▶ Scan"
                            }, undefined, false, undefined, this),
                            _jsxDEV("button", {
                              onClick: stopProcess,
                              disabled: status === "idle",
                              className: "btn-outline",
                              children: "⏸ Stop"
                            }, undefined, false, undefined, this),
                            _jsxDEV("button", {
                              onClick: startAnalyze,
                              disabled: status === "analyzing" || candidates.length === 0,
                              className: "btn-outline",
                              children: "\uD83E\uDDE0 Lancer l'IA"
                            }, undefined, false, undefined, this)
                          ]
                        }, undefined, true, undefined, this)
                      ]
                    }, undefined, true, undefined, this),
                    _jsxDEV("div", {
                      className: "flex flex-wrap items-center gap-3 text-xs text-white/60",
                      children: [
                        _jsxDEV("span", {
                          children: scanProgress.message || "Attente de scan"
                        }, undefined, false, undefined, this),
                        _jsxDEV("span", {
                          children: "•"
                        }, undefined, false, undefined, this),
                        _jsxDEV("span", {
                          children: analyzeProgress.total ? `${analyzeProgress.current}/${analyzeProgress.total} analysés` : "Analyse non démarrée"
                        }, undefined, false, undefined, this)
                      ]
                    }, undefined, true, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                (status === "scanning" || status === "analyzing" || aiThinking) && _jsxDEV("section", {
                  className: "rounded-3xl border border-white/10 bg-white/5 p-4 space-y-3 backdrop-blur",
                  children: [
                    _jsxDEV("div", {
                      className: "flex items-center justify-between text-xs text-white/70",
                      children: [
                        _jsxDEV("span", {
                          children: status === "scanning" ? scanProgress.message || "Scan en cours" : "Analyse IA en cours"
                        }, undefined, false, undefined, this),
                        _jsxDEV("span", {
                          children: status === "scanning" ? `${scanProgress.scanned} fichiers` : `${analyzeProgress.current}/${analyzeProgress.total || 0}`
                        }, undefined, false, undefined, this)
                      ]
                    }, undefined, true, undefined, this),
                    _jsxDEV("div", {
                      className: "w-full bg-white/10 rounded-full h-2 overflow-hidden",
                      children: _jsxDEV("div", {
                        className: "h-full rounded-full bg-white",
                        style: { width: status === "scanning" ? "100%" : `${analyzeProgress.current / (analyzeProgress.total || 1) * 100}%` }
                      }, undefined, false, undefined, this)
                    }, undefined, false, undefined, this),
                    aiThinking && _jsxDEV("div", {
                      className: "text-xs text-white/80 font-mono thinking space-y-1",
                      children: [
                        _jsxDEV("p", {
                          children: [
                            "Analyse: ",
                            aiThinking.file
                          ]
                        }, undefined, true, undefined, this),
                        aiThinking.prompt && _jsxDEV("p", {
                          className: "text-white/60",
                          children: [
                            "Prompt: ",
                            truncate(aiThinking.prompt, 160)
                          ]
                        }, undefined, true, undefined, this)
                      ]
                    }, undefined, true, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                _jsxDEV("section", {
                  className: "rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4 backdrop-blur",
                  children: [
                    _jsxDEV("div", {
                      className: "flex items-center justify-between",
                      children: [
                        _jsxDEV("h3", {
                          className: "text-lg font-semibold",
                          children: "Résultats IA"
                        }, undefined, false, undefined, this),
                        _jsxDEV("span", {
                          className: "text-xs text-white/60",
                          children: [
                            selectedDeleteCount,
                            " sélectionnés"
                          ]
                        }, undefined, true, undefined, this)
                      ]
                    }, undefined, true, undefined, this),
                    _jsxDEV("div", {
                      className: "grid gap-4 md:grid-cols-3",
                      children: [
                        _jsxDEV("div", {
                          className: "rounded-2xl bg-white/5 border border-white/10 p-4",
                          children: [
                            _jsxDEV("p", {
                              className: "text-xs uppercase tracking-[0.25em] text-white/60",
                              children: "Protégés"
                            }, undefined, false, undefined, this),
                            _jsxDEV("ul", {
                              className: "mt-3 space-y-2 max-h-48 overflow-y-auto pr-1",
                              children: protectedFiles.length > 0 ? protectedFiles.map((file, idx) => _jsxDEV("li", {
                                className: "flex items-start gap-3 text-sm",
                                children: [
                                  _jsxDEV("span", {
                                    className: "text-rose-200",
                                    children: "⚑"
                                  }, undefined, false, undefined, this),
                                  _jsxDEV("div", {
                                    children: [
                                      _jsxDEV("p", {
                                        className: "font-semibold",
                                        children: file.name
                                      }, undefined, false, undefined, this),
                                      _jsxDEV("p", {
                                        className: "text-[11px] text-white/60",
                                        children: [
                                          file.keyword,
                                          " • ",
                                          file.size_h
                                        ]
                                      }, undefined, true, undefined, this)
                                    ]
                                  }, undefined, true, undefined, this)
                                ]
                              }, `${file.file}-${idx}`, true, undefined, this)) : _jsxDEV("p", {
                                className: "text-xs text-white/60",
                                children: "Aucun fichier sensible."
                              }, undefined, false, undefined, this)
                            }, undefined, false, undefined, this)
                          ]
                        }, undefined, true, undefined, this),
                        _jsxDEV("div", {
                          className: "rounded-2xl bg-white/5 border border-white/10 p-4",
                          children: [
                            _jsxDEV("p", {
                              className: "text-xs uppercase tracking-[0.25em] text-white/60",
                              children: "Conservés"
                            }, undefined, false, undefined, this),
                            _jsxDEV("ul", {
                              className: "mt-3 space-y-2 max-h-48 overflow-y-auto pr-1",
                              children: results.should_keep.length > 0 ? results.should_keep.map((file, idx) => _jsxDEV("li", {
                                className: "flex items-start gap-3 text-sm",
                                children: [
                                  _jsxDEV("span", {
                                    className: "text-emerald-200",
                                    children: "•"
                                  }, undefined, false, undefined, this),
                                  _jsxDEV("div", {
                                    children: [
                                      _jsxDEV("p", {
                                        className: "font-semibold",
                                        children: file.name
                                      }, undefined, false, undefined, this),
                                      _jsxDEV("p", {
                                        className: "text-[11px] text-white/60",
                                        children: file.reason
                                      }, undefined, false, undefined, this)
                                    ]
                                  }, undefined, true, undefined, this)
                                ]
                              }, `${file.file}-keep-${idx}`, true, undefined, this)) : _jsxDEV("p", {
                                className: "text-xs text-white/60",
                                children: "Pas encore de décision."
                              }, undefined, false, undefined, this)
                            }, undefined, false, undefined, this)
                          ]
                        }, undefined, true, undefined, this),
                        _jsxDEV("div", {
                          className: "rounded-2xl bg-white/5 border border-white/10 p-4",
                          children: [
                            _jsxDEV("p", {
                              className: "text-xs uppercase tracking-[0.25em] text-white/60",
                              children: "À supprimer"
                            }, undefined, false, undefined, this),
                            _jsxDEV("ul", {
                              className: "mt-3 space-y-2 max-h-48 overflow-y-auto pr-1",
                              children: results.can_delete.length > 0 ? results.can_delete.map((file, idx) => _jsxDEV("li", {
                                className: "flex items-center gap-3 text-sm",
                                children: [
                                  _jsxDEV("input", {
                                    type: "checkbox",
                                    checked: !!selectedDeleteMap[file.file],
                                    onChange: (e) => toggleDeleteSelection(file.file, e.target.checked),
                                    className: "rounded border-white/40 bg-transparent"
                                  }, undefined, false, undefined, this),
                                  _jsxDEV("div", {
                                    className: "flex-1",
                                    children: [
                                      _jsxDEV("p", {
                                        className: "font-semibold",
                                        children: file.name
                                      }, undefined, false, undefined, this),
                                      _jsxDEV("p", {
                                        className: "text-[11px] text-white/60",
                                        children: file.reason
                                      }, undefined, false, undefined, this)
                                    ]
                                  }, undefined, true, undefined, this),
                                  _jsxDEV("span", {
                                    className: "text-xs text-white/60",
                                    children: file.size_h
                                  }, undefined, false, undefined, this)
                                ]
                              }, `${file.file}-delete-${idx}`, true, undefined, this)) : _jsxDEV("p", {
                                className: "text-xs text-white/60",
                                children: "Aucun fichier à supprimer."
                              }, undefined, false, undefined, this)
                            }, undefined, false, undefined, this)
                          ]
                        }, undefined, true, undefined, this)
                      ]
                    }, undefined, true, undefined, this),
                    _jsxDEV("button", {
                      onClick: deleteSelected,
                      disabled: selectedDeleteCount === 0,
                      className: "btn-primary w-full",
                      children: [
                        "Supprimer les fichiers sélectionnés (",
                        selectedDeleteCount,
                        ")"
                      ]
                    }, undefined, true, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                _jsxDEV("section", {
                  className: "grid gap-4 md:grid-cols-2",
                  children: [
                    _jsxDEV("div", {
                      className: "rounded-3xl bg-white/5 border border-white/10 p-5 space-y-3 backdrop-blur",
                      children: [
                        _jsxDEV("div", {
                          className: "flex items-center justify-between",
                          children: [
                            _jsxDEV("h3", {
                              className: "text-lg font-semibold",
                              children: "Statistiques"
                            }, undefined, false, undefined, this),
                            _jsxDEV("span", {
                              className: "text-xs text-white/50",
                              children: "Dernier scan"
                            }, undefined, false, undefined, this)
                          ]
                        }, undefined, true, undefined, this),
                        stats ? _jsxDEV("div", {
                          className: "space-y-2 text-sm text-white/70",
                          children: [
                            _jsxDEV("div", {
                              className: "flex justify-between",
                              children: [
                                _jsxDEV("span", {
                                  children: "Total scannés"
                                }, undefined, false, undefined, this),
                                _jsxDEV("span", {
                                  children: stats.total_files || 0
                                }, undefined, false, undefined, this)
                              ]
                            }, undefined, true, undefined, this),
                            _jsxDEV("div", {
                              className: "flex justify-between",
                              children: [
                                _jsxDEV("span", {
                                  children: "Candidats IA"
                                }, undefined, false, undefined, this),
                                _jsxDEV("span", {
                                  children: stats.candidate_count ?? candidates.length
                                }, undefined, false, undefined, this)
                              ]
                            }, undefined, true, undefined, this),
                            _jsxDEV("div", {
                              className: "flex justify-between",
                              children: [
                                _jsxDEV("span", {
                                  children: "Limite analyse"
                                }, undefined, false, undefined, this),
                                _jsxDEV("span", {
                                  children: Math.min(candidates.length, config.max_files)
                                }, undefined, false, undefined, this)
                              ]
                            }, undefined, true, undefined, this),
                            _jsxDEV("div", {
                              className: "flex justify-between",
                              children: [
                                _jsxDEV("span", {
                                  children: "Protégés"
                                }, undefined, false, undefined, this),
                                _jsxDEV("span", {
                                  children: protectedFiles.length
                                }, undefined, false, undefined, this)
                              ]
                            }, undefined, true, undefined, this)
                          ]
                        }, undefined, true, undefined, this) : _jsxDEV("p", {
                          className: "text-sm text-white/60",
                          children: "Aucune donnée pour l'instant."
                        }, undefined, false, undefined, this)
                      ]
                    }, undefined, true, undefined, this),
                    _jsxDEV("div", {
                      className: "rounded-3xl bg-white/5 border border-white/10 p-5 space-y-3 backdrop-blur",
                      children: [
                        _jsxDEV("div", {
                          className: "flex items-center justify-between",
                          children: [
                            _jsxDEV("h3", {
                              className: "text-lg font-semibold",
                              children: "Suppression rapide"
                            }, undefined, false, undefined, this),
                            _jsxDEV("span", {
                              className: "text-xs text-white/50",
                              children: "Catégories"
                            }, undefined, false, undefined, this)
                          ]
                        }, undefined, true, undefined, this),
                        stats && stats.stats ? _jsxDEV("div", {
                          className: "space-y-2 text-sm",
                          children: [
                            Object.keys(quickDeleteCategories).map((category) => {
                              const categoryStats = stats.stats[category];
                              if (!categoryStats || categoryStats.count === 0)
                                return null;
                              return _jsxDEV("label", {
                                className: "flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2",
                                children: [
                                  _jsxDEV("input", {
                                    type: "checkbox",
                                    checked: quickDeleteCategories[category],
                                    onChange: (e) => setQuickDeleteCategories({
                                      ...quickDeleteCategories,
                                      [category]: e.target.checked
                                    }),
                                    className: "rounded border-white/40 bg-transparent"
                                  }, undefined, false, undefined, this),
                                  _jsxDEV("div", {
                                    className: "flex-1",
                                    children: [
                                      _jsxDEV("p", {
                                        className: "font-medium",
                                        children: category
                                      }, undefined, false, undefined, this),
                                      _jsxDEV("p", {
                                        className: "text-xs text-white/60",
                                        children: [
                                          categoryStats.count,
                                          " fichiers • ",
                                          categoryStats.size_h
                                        ]
                                      }, undefined, true, undefined, this)
                                    ]
                                  }, undefined, true, undefined, this)
                                ]
                              }, category, true, undefined, this);
                            }),
                            _jsxDEV("button", {
                              onClick: quickDeleteByCategory,
                              className: "btn-outline w-full",
                              children: "Supprimer les catégories cochées"
                            }, undefined, false, undefined, this)
                          ]
                        }, undefined, true, undefined, this) : _jsxDEV("p", {
                          className: "text-sm text-white/60",
                          children: "Lance un scan pour afficher ces options."
                        }, undefined, false, undefined, this)
                      ]
                    }, undefined, true, undefined, this)
                  ]
                }, undefined, true, undefined, this)
              ]
            }, undefined, true, undefined, this),
            _jsxDEV("aside", {
              className: "rounded-3xl bg-white/5 border border-white/10 p-5 flex flex-col backdrop-blur",
              children: [
                _jsxDEV("div", {
                  className: "flex items-center justify-between mb-3",
                  children: [
                    _jsxDEV("h3", {
                      className: "text-lg font-semibold",
                      children: "Logs en direct"
                    }, undefined, false, undefined, this),
                    _jsxDEV("button", {
                      className: "btn-ghost text-xs",
                      onClick: () => setLogs([]),
                      children: "Effacer"
                    }, undefined, false, undefined, this)
                  ]
                }, undefined, true, undefined, this),
                _jsxDEV("div", {
                  className: "flex-1 rounded-2xl border border-white/10 p-4 overflow-y-auto font-mono text-xs leading-relaxed text-white/80 space-y-3",
                  style: { background: "#070c1f" },
                  children: [
                    logs.length === 0 && _jsxDEV("p", {
                      className: "text-white/40",
                      children: "En attente d'évènements…"
                    }, undefined, false, undefined, this),
                    logs.map((log, i) => _jsxDEV("div", {
                      className: "space-y-1",
                      children: [
                        _jsxDEV("div", {
                          className: log.color || "text-white/80",
                          children: [
                            _jsxDEV("span", {
                              className: "text-white/40",
                              children: [
                                "[",
                                log.time,
                                "]"
                              ]
                            }, undefined, true, undefined, this),
                            " ",
                            log.message
                          ]
                        }, undefined, true, undefined, this),
                        log.detail && _jsxDEV("div", {
                          className: "text-[11px] text-white/40 pl-6",
                          children: log.detail
                        }, undefined, false, undefined, this)
                      ]
                    }, i, true, undefined, this))
                  ]
                }, undefined, true, undefined, this),
                _jsxDEV("p", {
                  className: "mt-4 text-[11px] text-white/50",
                  children: "Les journaux sont mis à jour automatiquement."
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          ]
        }, undefined, true, undefined, this)
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
ReactDOM.render(_jsxDEV(App, {}, undefined, false, undefined, this), document.getElementById("app"));
