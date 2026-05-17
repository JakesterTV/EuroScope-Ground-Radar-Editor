import { useStore } from '../store/useStore';
import { isGeoElement } from '../utils/parser';

export function StatusBar({ devMode, onToggleDevMode }: { devMode: boolean; onToggleDevMode: () => void }) {
  const parsedFile = useStore(s => s.parsedFile);
  const cursorCoords = useStore(s => s.cursorCoords);
  const editMode = useStore(s => s.editMode);
  const isDirty = useStore(s => s.isDirty);
  const undoStack = useStore(s => s.undoStack);

  const totalElements = parsedFile
    ? parsedFile.maps.reduce((a, s) => a + s.items.filter(isGeoElement).length, 0)
    : 0;
  const visibleSections = parsedFile
    ? parsedFile.maps.filter(s => s.visible).length
    : 0;

  const modeLabel: Record<string, string> = {
    select:       '↖ Select / Edit vertices',
    'draw-line':  '╱ Draw Line  (click start, click end)',
    'draw-polygon': '⬡ Draw Polygon  (click points, double-click to close)',
    delete:       '✕ Delete  (click element to remove)',
  };

  return (
    <div className="h-6 flex-shrink-0 bg-slate-950 border-t border-slate-800 flex items-center gap-4 px-3 text-xs text-slate-500 overflow-hidden">
      {/* Cursor coordinates */}
      <span className="font-mono tabular-nums w-52 flex-shrink-0">
        {cursorCoords
          ? `${cursorCoords[0].toFixed(6)}° N  ${cursorCoords[1].toFixed(6)}° E`
          : '— cursor off map —'}
      </span>

      <span className="text-slate-700">|</span>

      {/* Edit mode */}
      <span className="flex-shrink-0">
        {modeLabel[editMode] ?? editMode}
      </span>

      <span className="text-slate-700">|</span>

      {/* Stats */}
      <span>
        {visibleSections} / {parsedFile?.maps.length ?? 0} layers visible
      </span>
      <span>·</span>
      <span>{totalElements} elements</span>

      {/* Dirty indicator */}
      {isDirty && (
        <>
          <span className="text-slate-700">|</span>
          <span className="text-amber-400">● Unsaved changes</span>
        </>
      )}

      {undoStack.length > 0 && (
        <>
          <span className="text-slate-700">|</span>
          <span className="text-slate-600">{undoStack.length} undo steps</span>
        </>
      )}

      {/* Keyboard hints */}
      <span className="ml-auto text-slate-700 flex-shrink-0">
        Ctrl+S Save · Ctrl+Z Undo · Ctrl+Y Redo · Del Delete · S/L/P/X mode keys
      </span>

      <span className="text-slate-700">|</span>

      {/* Dev mode toggle */}
      <button
        onClick={onToggleDevMode}
        title="Toggle dev mode (file text view)"
        className={`flex-shrink-0 px-1.5 rounded text-xs font-mono font-semibold transition-colors ${
          devMode
            ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
            : 'text-slate-600 hover:text-slate-400 hover:bg-slate-800'
        }`}
      >
        DEV
      </button>
    </div>
  );
}
