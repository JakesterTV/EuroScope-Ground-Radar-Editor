import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { exportFileWithMap } from '../utils/exporter';

// ─── Syntax token classifier ──────────────────────────────────────────────────

type TokenKind = 'comment' | 'map' | 'section-header' | 'geo' | 'color' | 'normal' | 'empty';

function classifyLine(line: string): TokenKind {
  const t = line.trim();
  if (t === '') return 'empty';
  if (t.startsWith('//')) return 'comment';
  if (t.startsWith('MAP:')) return 'map';
  if (
    t.startsWith('FOLDER:') || t.startsWith('AIRPORT:') || t.startsWith('ACTIVE:') ||
    t.startsWith('STYLE:')  || t.startsWith('FONTSIZE:')|| t.startsWith('TEXTALIGN:')
  ) return 'section-header';
  if (
    t.startsWith('COORDTYPE:') || t.startsWith('COORD:') || t.startsWith('COORD_CIRCLE:') ||
    t.startsWith('LINE:')      || t.startsWith('SYMBOL:')|| t.startsWith('TEXT:')
  ) return 'geo';
  if (t.startsWith('COLOR:') || t.startsWith('COLORDEF:') || t.startsWith('SYMBOLDEF:')) return 'color';
  return 'normal';
}

const TOKEN_COLORS: Record<TokenKind, string> = {
  comment:        'text-slate-500 italic',
  map:            'text-amber-300 font-bold',
  'section-header': 'text-sky-400',
  geo:            'text-emerald-400',
  color:          'text-violet-400',
  normal:         'text-slate-300',
  empty:          'text-transparent',
};

// ─── Component ────────────────────────────────────────────────────────────────

const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 280;
const MAX_HEIGHT_FRACTION = 0.65; // 65% of window

export function DevDrawer({ onClose }: { onClose: () => void }) {
  const parsedFile = useStore(s => s.parsedFile);
  const selectedElementId = useStore(s => s.selectedElementId);
  const selectedMapId     = useStore(s => s.selectedMapId);

  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLTableRowElement>(null);

  // Build exported text + line map
  const { lines, elementLineMap } = useMemo(() => {
    if (!parsedFile) return { lines: [] as string[], elementLineMap: new Map<string, { start: number; end: number }>() };
    const { text, elementLineMap } = exportFileWithMap(parsedFile);
    return { lines: text.split('\n'), elementLineMap };
  }, [parsedFile]);

  // Line range of the selected element
  const highlightRange = useMemo(() => {
    if (!selectedElementId) return null;
    return elementLineMap.get(selectedElementId) ?? null;
  }, [selectedElementId, elementLineMap]);

  // Scroll highlighted lines into view whenever selection changes
  useEffect(() => {
    if (!highlightRef.current || !scrollRef.current) return;
    highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightRange]);

  // ─── Drag-to-resize ───────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragStartY.current = e.clientY;
    dragStartH.current = height;
  }, [height]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dy = dragStartY.current - e.clientY; // drag up = taller
      const maxH = window.innerHeight * MAX_HEIGHT_FRACTION;
      setHeight(Math.max(MIN_HEIGHT, Math.min(maxH, dragStartH.current + dy)));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      style={{ height }}
      className="flex-shrink-0 flex flex-col bg-slate-950 border-t border-slate-700 overflow-hidden select-none"
    >
      {/* Drag handle */}
      <div
        className="h-1.5 flex-shrink-0 bg-slate-800 hover:bg-slate-600 cursor-row-resize flex items-center justify-center group transition-colors"
        onMouseDown={onMouseDown}
      >
        <div className="w-8 h-0.5 rounded-full bg-slate-600 group-hover:bg-slate-400 transition-colors" />
      </div>

      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-slate-800 flex-shrink-0 bg-slate-900">
        <span className="text-xs font-mono font-semibold text-amber-400">DEV</span>
        <span className="text-xs text-slate-500 font-mono">— file text view</span>
        {highlightRange && (
          <span className="text-xs text-slate-600 font-mono ml-2">
            line {highlightRange.start + 1}–{highlightRange.end + 1} selected
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-600 font-mono">{lines.length} lines</span>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 text-xs px-1 rounded transition-colors"
            title="Close dev mode"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Code area */}
      {!parsedFile ? (
        <div className="flex-1 flex items-center justify-center text-slate-600 text-xs font-mono">
          No file loaded
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-auto">
          <table className="text-xs font-mono w-full border-collapse">
            <tbody>
              {lines.map((line, i) => {
                const isHighlighted = highlightRange !== null && i >= highlightRange.start && i <= highlightRange.end;
                const isHighlightStart = highlightRange !== null && i === highlightRange.start;
                const kind = classifyLine(line);
                return (
                  <tr
                    key={i}
                    ref={isHighlightStart ? highlightRef : undefined}
                    className={isHighlighted ? 'bg-amber-950/60' : 'hover:bg-slate-900/60'}
                  >
                    {/* Line number */}
                    <td className="select-none text-right pr-3 pl-2 text-slate-600 w-12 align-top border-r border-slate-800 whitespace-nowrap">
                      {isHighlighted
                        ? <span className="text-amber-500">{i + 1}</span>
                        : i + 1
                      }
                    </td>
                    {/* Line content */}
                    <td className={`pl-3 pr-4 whitespace-pre align-top ${TOKEN_COLORS[kind]} ${isHighlighted ? 'text-amber-100' : ''}`}>
                      {line || ' '}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
