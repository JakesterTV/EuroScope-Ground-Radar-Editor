import { useState, useCallback, useEffect } from 'react';
import { useStore } from './store/useStore';
import { MapView } from './components/MapView';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { StatusBar } from './components/StatusBar';
import { DevDrawer } from './components/DevDrawer';
import { FileUpload } from './components/FileUpload';
import { GitHubPanel } from './components/GitHubPanel';
import { useKeyboard } from './hooks/useKeyboard';

export default function App() {
  const parsedFile = useStore(s => s.parsedFile);
  const loadFromText = useStore(s => s.loadFromText);
  const setGithubToken = useStore(s => s.setGithubToken);
  const [showUpload, setShowUpload] = useState(false);
  const [showGitHub, setShowGitHub] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [showPdfOverlay, setShowPdfOverlay] = useState(false);

  // Enable global keyboard shortcuts
  useKeyboard();

  // Receive OAuth token from the popup window via postMessage,
  // or via URL hash if the popup redirected back to this page directly.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      // Allow same origin (production) and any localhost port (development).
      const sameOrigin = e.origin === window.location.origin;
      const isLocalhost = e.origin.startsWith('http://localhost');
      if (!sameOrigin && !isLocalhost) return;
      if (e.data?.type === 'github_oauth_token' && typeof e.data.token === 'string') {
        setGithubToken(e.data.token);
        setShowGitHub(true);
      }
    };
    window.addEventListener('message', handler);
    // Fallback: token in hash (when popup is not supported)
    const hash = window.location.hash;
    if (hash.startsWith('#token=')) {
      const token = decodeURIComponent(hash.slice(7));
      setGithubToken(token);
      setShowGitHub(true);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    return () => window.removeEventListener('message', handler);
  }, [setGithubToken]);

  // Global drag-and-drop support (anywhere on the window)
  const handleWindowDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        loadFromText(ev.target!.result as string, file.name);
      };
      reader.readAsText(file, 'utf-8');
    },
    [loadFromText]
  );

  return (
    <div
      className="flex flex-col w-screen h-screen bg-slate-950 text-slate-200 overflow-hidden"
      onDragOver={e => e.preventDefault()}
      onDrop={handleWindowDrop}
    >
      {/* Top toolbar */}
      <Toolbar onOpenGitHub={() => setShowGitHub(true)} onTogglePdfOverlay={() => setShowPdfOverlay(v => !v)} pdfOverlayActive={showPdfOverlay} />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <Sidebar />

        {/* Map viewport */}
        <div className="flex-1 relative min-w-0 bg-slate-950">
          {parsedFile ? (
            <MapView showPdfOverlay={showPdfOverlay} onClosePdfOverlay={() => setShowPdfOverlay(false)} />
          ) : (
            /* Empty state */
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-slate-600 cursor-pointer select-none"
              onClick={() => setShowUpload(true)}
            >
              <div className="text-6xl">🗺️</div>
              <div className="text-xl font-semibold text-slate-500">
                EuroScope Map Editor
              </div>
              <div className="text-sm">
                Drop a <code className="text-slate-400 bg-slate-800 px-1 rounded">GRpluginMaps.txt</code> file here
              </div>
              <div className="text-xs text-slate-700">
                or enter the path in the toolbar and click Load
              </div>
              <button
                className="mt-2 px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors"
                onClick={e => { e.stopPropagation(); setShowUpload(true); }}
              >
                Open File
              </button>
            </div>
          )}
        </div>

        {/* Right properties panel */}
        <PropertiesPanel />
      </div>

      {/* Dev mode drawer — sits above the status bar */}
      {devMode && <DevDrawer onClose={() => setDevMode(false)} />}

      {/* Bottom status bar */}
      <StatusBar devMode={devMode} onToggleDevMode={() => setDevMode(v => !v)} />

      {/* File upload overlay */}
      {showUpload && <FileUpload onClose={() => setShowUpload(false)} />}

      {/* GitHub panel */}
      {showGitHub && <GitHubPanel onClose={() => setShowGitHub(false)} />}
    </div>
  );
}
