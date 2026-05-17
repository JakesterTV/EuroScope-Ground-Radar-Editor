import { useState, useRef } from 'react';
import { useStore } from '../store/useStore';
import type { EditMode } from '../types';

interface ToolButtonProps {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}

function ToolButton({ active, title, onClick, children, className = '' }: ToolButtonProps) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`
        px-3 py-1.5 rounded text-xs font-medium transition-colors select-none
        ${active
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}
        ${className}
      `}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-slate-700 mx-1" />;
}

export function Toolbar({ onOpenGitHub, onTogglePdfOverlay, pdfOverlayActive }: { onOpenGitHub: () => void; onTogglePdfOverlay?: () => void; pdfOverlayActive?: boolean }) {
  const filePath = useStore(s => s.filePath);
  const parsedFile = useStore(s => s.parsedFile);
  const isDirty = useStore(s => s.isDirty);
  const editMode = useStore(s => s.editMode);
  const undoStack = useStore(s => s.undoStack);
  const redoStack = useStore(s => s.redoStack);

  const fetchFromServer = useStore(s => s.fetchFromServer);
  const saveToServer = useStore(s => s.saveToServer);
  const loadFromText = useStore(s => s.loadFromText);
  const setEditMode = useStore(s => s.setEditMode);
  const enterDrawText = useStore(s => s.enterDrawText);
  const undo = useStore(s => s.undo);
  const redo = useStore(s => s.redo);
  const getExportText = useStore(s => s.getExportText);
  const selectedMapId = useStore(s => s.selectedMapId);
  const activeDrawGroupId = useStore(s => s.activeDrawGroupId);

  const activeGroup = parsedFile?.maps.find(m => m.id === activeDrawGroupId) ?? null;

  /** Text labels may only go into groups whose name contains these keywords. */
  const TEXT_KEYWORDS = ['label', 'stand', 'building', 'sign'];
  const isTextAllowedGroup = (name: string) =>
    TEXT_KEYWORDS.some(k => name.toLowerCase().includes(k));
  const textAllowed = activeGroup !== null && isTextAllowedGroup(activeGroup.name);

  const [pathInput, setPathInput] = useState(
    filePath ?? ''
  );
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showStatus = (msg: string, ok: boolean) => {
    setStatus({ msg, ok });
    setTimeout(() => setStatus(null), 3000);
  };

  const handleLoadPath = async () => {
    try {
      await fetchFromServer(pathInput);
      showStatus('File loaded successfully', true);
    } catch (err) {
      showStatus(String(err), false);
    }
  };

  const handleSave = async () => {
    try {
      await saveToServer();
      showStatus('Saved successfully (.bak backup created)', true);
    } catch (err) {
      showStatus(String(err), false);
    }
  };

  const handleDownload = () => {
    const text = getExportText();
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'GRpluginMaps.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      loadFromText(text, file.name);
      showStatus(`Loaded ${file.name}`, true);
    };
    reader.readAsText(file);
  };

  const modes: { id: EditMode; label: string; title: string }[] = [
    { id: 'select',       label: '↖ Select',    title: 'Select & edit vertices (S)' },
    { id: 'draw-line',    label: '╲ Draw Line',  title: activeDrawGroupId ? 'Draw a new line segment (L)' : 'Select a group in the sidebar first' },
    { id: 'draw-polygon', label: '⬡ Draw Poly',  title: activeDrawGroupId ? 'Draw a new polygon (P)' : 'Select a group in the sidebar first' },
    { id: 'delete',       label: '✕ Delete',     title: 'Click elements to delete (Del)' },
  ];

  const drawModeDisabled = (id: EditMode) =>
    (id === 'draw-line' || id === 'draw-polygon') && !activeDrawGroupId;

  return (
    <div className="h-10 flex-shrink-0 bg-slate-900 border-b border-slate-700 flex items-center gap-2 px-3 z-10">
      {/* File path + load */}
      <input
        value={pathInput}
        onChange={e => setPathInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleLoadPath()}
        className="w-80 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-blue-500"
        placeholder="File path…"
        title="Press Enter or click Load"
      />
      <ToolButton title="Load from path" onClick={handleLoadPath}>Load</ToolButton>

      {/* Browse button */}
      <ToolButton title="Browse for file" onClick={() => fileInputRef.current?.click()}>
        Browse
      </ToolButton>
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt"
        className="hidden"
        onChange={handleFileInput}
      />

      <Divider />

      {/* Save / Download */}
      <ToolButton
        title="Save file back to disk (Ctrl+S)"
        onClick={handleSave}
        className={isDirty ? 'ring-1 ring-amber-500/50' : ''}
        active={isDirty}
      >
        {isDirty ? '● Save' : 'Save'}
      </ToolButton>
      <ToolButton title="Download edited file" onClick={handleDownload}>
        ↓ Export
      </ToolButton>

      <Divider />

      {/* Undo / Redo */}
      <ToolButton
        title="Undo (Ctrl+Z)"
        onClick={undo}
        className={undoStack.length === 0 ? 'opacity-40' : ''}
      >
        ↩ Undo
      </ToolButton>
      <ToolButton
        title="Redo (Ctrl+Y)"
        onClick={redo}
        className={redoStack.length === 0 ? 'opacity-40' : ''}
      >
        ↪ Redo
      </ToolButton>

      <Divider />

      {/* Edit modes */}
      {modes.map(m => (
        <ToolButton
          key={m.id}
          active={editMode === m.id}
          title={m.title}
          onClick={() => { if (!drawModeDisabled(m.id)) setEditMode(m.id); }}
          className={drawModeDisabled(m.id) ? 'opacity-40 cursor-not-allowed' : ''}
        >
          {m.label}
        </ToolButton>
      ))}

      {/* Active draw group indicator */}
      {activeGroup && (
        <span className="text-[10px] text-amber-400 border border-amber-500/40 rounded px-1.5 py-0.5 flex-shrink-0 max-w-[120px] truncate" title={activeGroup.name}>
          → {activeGroup.name}
        </span>
      )}
      {!activeGroup && (editMode === 'draw-line' || editMode === 'draw-polygon' || editMode === 'draw-text') && (
        <span className="text-[10px] text-red-400 animate-pulse">← select a group</span>
      )}

      {/* Add Text label */}
      <Divider />
      {editMode === 'draw-text' ? (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-amber-400 animate-pulse flex-shrink-0">Click map to place</span>
          <button
            onClick={() => setEditMode('select')}
            className="text-slate-500 hover:text-slate-300 text-xs px-1 flex-shrink-0"
            title="Cancel"
          >✕</button>
        </div>
      ) : (
        <ToolButton
          title={
            !activeGroup
              ? 'Select a group in the sidebar first'
              : !textAllowed
              ? `“${activeGroup.name}” is not a text group — use Taxiway Labels, Stands or Buildings`
              : 'Add a text label — click on the map to place'
          }
          onClick={() => {
            if (!activeGroup || !textAllowed) return;
            enterDrawText(activeGroup.id);
          }}
          className={(!activeGroup || !textAllowed) ? 'opacity-40 cursor-not-allowed' : ''}
          active={editMode === ('draw-text' as EditMode)}
        >
          T Label
        </ToolButton>
      )}

      {/* PDF overlay */}
      <Divider />
      <ToolButton
        title={pdfOverlayActive ? 'Close PDF overlay' : 'Import a PDF and overlay it on the map'}
        active={pdfOverlayActive}
        onClick={() => onTogglePdfOverlay?.()}
      >
        📄 PDF
      </ToolButton>

      {/* GitHub */}
      <Divider />
      <ToolButton title="Open GitHub integration (fetch / PR)" onClick={onOpenGitHub}>
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.3 9.42 7.87 10.95.58.1.79-.25.79-.55v-2.05c-3.2.7-3.88-1.38-3.88-1.38-.53-1.33-1.28-1.68-1.28-1.68-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.02 1.75 2.68 1.25 3.34.95.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a10.99 10.99 0 0 1 2.89-.39c.98 0 1.97.13 2.89.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.24 2.75.12 3.04.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15v3.19c0 .3.2.66.8.55C20.2 21.41 23.5 17.1 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
          </svg>
          GitHub
        </span>
      </ToolButton>

      {/* Status message */}
      {status && (
        <div
          className={`ml-auto text-xs px-2 py-1 rounded ${
            status.ok
              ? 'bg-green-900/50 text-green-400'
              : 'bg-red-900/50 text-red-400'
          }`}
        >
          {status.msg}
        </div>
      )}

      {/* File info */}
      {!status && parsedFile && (
        <div className="ml-auto text-xs text-slate-500 truncate max-w-48" title={filePath ?? ''}>
          {filePath ? filePath.split(/[\\/]/).pop() : 'No file'}
        </div>
      )}
    </div>
  );
}
