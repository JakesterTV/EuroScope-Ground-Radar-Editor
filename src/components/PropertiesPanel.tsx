import { useState } from 'react';
import { useStore } from '../store/useStore';
import { isGeoElement } from '../utils/parser';
import type { GeoElement, PolygonElement, LineElement, CircleElement, SymbolElement, TextElement, PathElement, MapSection, ActiveLine } from '../types';
import { activeLineToRaw, parseActiveLine } from '../types';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="text-slate-500 text-xs w-20 flex-shrink-0">{label}</span>
      <span className="text-slate-300 text-xs break-all">{value}</span>
    </div>
  );
}

function CoordField({
  label,
  lat,
  lon,
  format,
  onChange,
}: {
  label: string;
  lat: number;
  lon: number;
  format: string;
  onChange: (lat: number, lon: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [latVal, setLatVal] = useState(lat.toFixed(8));
  const [lonVal, setLonVal] = useState(lon.toFixed(8));

  if (!editing) {
    return (
      <div
        className="flex gap-2 py-0.5 cursor-pointer hover:bg-slate-700/30 rounded px-1 -mx-1"
        onClick={() => {
          setLatVal(lat.toFixed(8));
          setLonVal(lon.toFixed(8));
          setEditing(true);
        }}
      >
        <span className="text-slate-500 text-xs w-20 flex-shrink-0">{label}</span>
        <span className="text-slate-300 text-xs">
          {lat.toFixed(6)}, {lon.toFixed(6)}
          <span className="ml-1 text-slate-600 text-[10px]">({format})</span>
        </span>
      </div>
    );
  }

  return (
    <div className="py-0.5">
      <div className="text-slate-500 text-xs mb-1">{label}</div>
      <div className="flex gap-1">
        <input
          value={latVal}
          onChange={e => setLatVal(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-200 outline-none focus:border-blue-400"
          placeholder="lat"
        />
        <input
          value={lonVal}
          onChange={e => setLonVal(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-200 outline-none focus:border-blue-400"
          placeholder="lon"
        />
      </div>
      <div className="flex gap-1 mt-1">
        <button
          onClick={() => {
            const newLat = parseFloat(latVal);
            const newLon = parseFloat(lonVal);
            if (!isNaN(newLat) && !isNaN(newLon)) onChange(newLat, newLon);
            setEditing(false);
          }}
          className="flex-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded px-2 py-0.5"
        >
          Apply
        </button>
        <button
          onClick={() => setEditing(false)}
          className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded px-2 py-0.5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function LineProps({ el, mapId }: { el: LineElement; mapId: string }) {
  const updateLineEndpoint = useStore(s => s.updateLineEndpoint);
  return (
    <>
      <Row label="Type" value="Line segment" />
      <CoordField
        label="Start"
        lat={el.p1.lat}
        lon={el.p1.lon}
        format={el.p1.format}
        onChange={(lat, lon) => updateLineEndpoint(mapId, el.id, 'p1', lat, lon)}
      />
      <CoordField
        label="End"
        lat={el.p2.lat}
        lon={el.p2.lon}
        format={el.p2.format}
        onChange={(lat, lon) => updateLineEndpoint(mapId, el.id, 'p2', lat, lon)}
      />
      <Row
        label="Length"
        value={`${(
          Math.hypot(el.p2.lat - el.p1.lat, el.p2.lon - el.p1.lon) * 111_000
        ).toFixed(1)} m (approx)`}
      />
    </>
  );
}

function PolygonProps({ el, mapId }: { el: PolygonElement; mapId: string }) {
  const updatePolygonVertex = useStore(s => s.updatePolygonVertex);
  const deletePolygonVertex = useStore(s => s.deletePolygonVertex);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? el.coords : el.coords.slice(0, 5);

  return (
    <>
      <Row label="Type" value={el.coordType} />
      <Row label="Vertices" value={String(el.coords.length)} />
      <div className="mt-1 text-xs text-slate-500 uppercase tracking-wide mb-0.5">Vertices</div>
      {visible.map((c, i) => (
        <div key={i} className="flex items-center gap-1 group">
          <CoordField
            label={`#${i + 1}`}
            lat={c.lat}
            lon={c.lon}
            format={c.format}
            onChange={(lat, lon) => updatePolygonVertex(mapId, el.id, i, lat, lon)}
          />
          <button
            className="invisible group-hover:visible text-red-500 hover:text-red-300 text-xs px-1 flex-shrink-0"
            title="Delete vertex"
            onClick={() => deletePolygonVertex(mapId, el.id, i)}
          >
            ✕
          </button>
        </div>
      ))}
      {el.coords.length > 5 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="text-xs text-blue-400 hover:text-blue-300 mt-1"
        >
          {showAll ? '▲ Show less' : `▾ Show all ${el.coords.length} vertices`}
        </button>
      )}
    </>
  );
}

function CircleProps({ el }: { el: CircleElement }) {
  return (
    <>
      <Row label="Type" value={`Circle (${el.coordType})`} />
      <Row label="Center" value={`${el.center.lat.toFixed(6)}, ${el.center.lon.toFixed(6)}`} />
      <Row label="Radius" value={`${el.radius.toFixed(2)} NM`} />
      <Row label="Points" value={String(el.points)} />
    </>
  );
}

function SymbolProps({ el }: { el: SymbolElement }) {
  return (
    <>
      <Row label="Type" value={el.symbolType} />
      <Row label="Label" value={el.label} />
      <Row label="Coord" value={`${el.coord.lat.toFixed(6)}, ${el.coord.lon.toFixed(6)}`} />
      <Row label="OffsetX" value={String(el.offsetX)} />
      <Row label="OffsetY" value={String(el.offsetY)} />
    </>
  );
}

function TextProps({ el, mapId }: { el: TextElement; mapId: string }) {
  const updateTextElement = useStore(s => s.updateTextElement);
  const [editing, setEditing] = useState(false);
  const [textVal, setTextVal] = useState(el.text);
  const [latVal, setLatVal] = useState(el.coord.lat.toFixed(8));
  const [lonVal, setLonVal] = useState(el.coord.lon.toFixed(8));

  const startEdit = () => {
    setTextVal(el.text);
    setLatVal(el.coord.lat.toFixed(8));
    setLonVal(el.coord.lon.toFixed(8));
    setEditing(true);
  };

  const applyEdit = () => {
    const lat = parseFloat(latVal);
    const lon = parseFloat(lonVal);
    if (textVal.trim() && !isNaN(lat) && !isNaN(lon)) {
      updateTextElement(mapId, el.id, textVal.trim(), lat, lon);
    }
    setEditing(false);
  };

  return (
    <>
      <Row label="Type" value="Text label" />
      {!editing ? (
        <div
          className="flex gap-2 py-0.5 cursor-pointer hover:bg-slate-700/30 rounded px-1 -mx-1"
          onClick={startEdit}
          title="Click to edit"
        >
          <span className="text-slate-500 text-xs w-20 flex-shrink-0">Text</span>
          <span className="text-slate-300 text-xs break-all">{el.text}</span>
        </div>
      ) : (
        <div className="py-0.5 space-y-1">
          <label className="block text-xs text-slate-500">Text</label>
          <input
            value={textVal}
            onChange={e => setTextVal(e.target.value)}
            autoFocus
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-200 outline-none focus:border-blue-400"
          />
          <label className="block text-xs text-slate-500 mt-1">Lat / Lon</label>
          <div className="flex gap-1">
            <input value={latVal} onChange={e => setLatVal(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-200 outline-none focus:border-blue-400" placeholder="lat" />
            <input value={lonVal} onChange={e => setLonVal(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-200 outline-none focus:border-blue-400" placeholder="lon" />
          </div>
          <div className="flex gap-1 mt-1">
            <button onClick={applyEdit} className="flex-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded px-2 py-0.5">Apply</button>
            <button onClick={() => setEditing(false)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded px-2 py-0.5">Cancel</button>
          </div>
        </div>
      )}
      {!editing && <Row label="Coord" value={`${el.coord.lat.toFixed(6)}, ${el.coord.lon.toFixed(6)}`} />}
    </>
  );
}

function PathProps({ el, mapId }: { el: PathElement; mapId: string }) {
  const updatePathVertex = useStore(s => s.updatePathVertex);
  const deletePathVertex = useStore(s => s.deletePathVertex);
  const [showAll, setShowAll] = useState(false);

  const vertices = [
    el.lines[0].p1,
    ...el.lines.map(l => l.p2),
  ];
  const visible = showAll ? vertices : vertices.slice(0, 5);

  return (
    <>
      <Row label="Type" value="Path" />
      <Row label="Segments" value={String(el.lines.length)} />
      <Row label="Vertices" value={String(vertices.length)} />
      <div className="mt-1 text-xs text-slate-500 uppercase tracking-wide mb-0.5">Vertices</div>
      {visible.map((c, i) => (
        <div key={i} className="flex items-center gap-1 group">
          <CoordField
            label={`#${i + 1}`}
            lat={c.lat}
            lon={c.lon}
            format={c.format}
            onChange={(lat, lon) => updatePathVertex(mapId, el.id, i, lat, lon)}
          />
          <button
            className="invisible group-hover:visible text-red-500 hover:text-red-300 text-xs px-1 flex-shrink-0"
            title="Delete vertex"
            onClick={() => deletePathVertex(mapId, el.id, i)}
          >
            ✕
          </button>
        </div>
      ))}
      {vertices.length > 5 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="text-xs text-blue-400 hover:text-blue-300 mt-1"
        >
          {showAll ? '▲ Show less' : `▾ Show all ${vertices.length} vertices`}
        </button>
      )}
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Build a pretty title for an ACTIVE line */
function activeLineTitle(al: ActiveLine): string {
  switch (al.kind) {
    case 'always':   return 'Always active';
    case 'schedule': return 'Schedule';
    case 'runway':   return 'Runway based';
    case 'id':       return 'Controller ID';
    case 'callsign': return 'Callsign based';
    case 'lvp':      return 'LVP';
    case 'map':      return 'Map state';
    case 'stand':    return 'Stand based';
    default:         return 'Unknown';
  }
}

/** Format MMDD or YYMMDD into human-readable string */
function formatDate(d: string): string {
  if (d.length === 4) {
    const m = d.slice(0, 2);
    const day = d.slice(2, 4);
    return `${m}/${day} (yearly)`;
  }
  if (d.length === 6) {
    const y = `20${d.slice(0, 2)}`;
    const m = d.slice(2, 4);
    const day = d.slice(4, 6);
    return `${y}-${m}-${day}`;
  }
  return d;
}

/** Format HHMM into HH:MM */
function formatTime(t: string): string {
  if (t.length === 4) return `${t.slice(0, 2)}:${t.slice(2, 4)} UTC`;
  return t;
}

// ─── Schedule editor ─────────────────────────────────────────────────────────

interface ScheduleEditorState {
  startDate: string;
  endDate: string;
  weekdays: string;
  startTime: string;
  endTime: string;
}

function ScheduleEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: ScheduleEditorState;
  onSave: (s: ScheduleEditorState) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState<ScheduleEditorState>(initial);

  const continuous = s.weekdays === '0';
  const toggleDay = (d: string) => {
    if (continuous) return;
    setS(prev => {
      const existing = prev.weekdays.split('').filter(Boolean);
      const next = existing.includes(d)
        ? existing.filter(x => x !== d)
        : [...existing, d].sort();
      return { ...prev, weekdays: next.join('') || '1' };
    });
  };

  const inputCls = 'bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-200 outline-none focus:border-blue-400 w-full';

  return (
    <div className="bg-slate-800/50 rounded p-2 space-y-2 text-xs">
      {/* Dates */}
      <div className="grid grid-cols-2 gap-1">
        <div>
          <div className="text-slate-500 mb-0.5">Start date</div>
          <input
            value={s.startDate}
            onChange={e => setS(p => ({ ...p, startDate: e.target.value }))}
            className={inputCls}
            placeholder="MMDD or YYMMDD"
          />
          <div className="text-slate-600 text-[10px] mt-0.5">MMDD yearly / YYMMDD once</div>
        </div>
        <div>
          <div className="text-slate-500 mb-0.5">End date</div>
          <input
            value={s.endDate}
            onChange={e => setS(p => ({ ...p, endDate: e.target.value }))}
            className={inputCls}
            placeholder="MMDD or YYMMDD"
          />
        </div>
      </div>

      {/* Times */}
      <div className="grid grid-cols-2 gap-1">
        <div>
          <div className="text-slate-500 mb-0.5">Start time (UTC)</div>
          <input
            value={s.startTime}
            onChange={e => setS(p => ({ ...p, startTime: e.target.value }))}
            className={inputCls}
            placeholder="HHMM"
            maxLength={4}
          />
        </div>
        <div>
          <div className="text-slate-500 mb-0.5">End time (UTC)</div>
          <input
            value={s.endTime}
            onChange={e => setS(p => ({ ...p, endTime: e.target.value }))}
            className={inputCls}
            placeholder="HHMM"
            maxLength={4}
          />
        </div>
      </div>

      {/* Weekdays */}
      <div>
        <div className="text-slate-500 mb-1">Active days</div>
        <label className="flex items-center gap-1.5 mb-1 cursor-pointer">
          <input
            type="checkbox"
            checked={continuous}
            onChange={e => setS(p => ({ ...p, weekdays: e.target.checked ? '0' : '12345' }))}
            className="accent-blue-400"
          />
          <span className="text-slate-300">Continuous period (no day filter)</span>
        </label>
        {!continuous && (
          <div className="flex gap-1">
            {WEEKDAY_LABELS.map((label, i) => {
              const digit = String(i + 1);
              const active = s.weekdays.includes(digit);
              return (
                <button
                  key={digit}
                  onClick={() => toggleDay(digit)}
                  className={`flex-1 py-0.5 rounded text-[10px] transition-colors ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Apply / Cancel */}
      <div className="flex gap-1 pt-1">
        <button
          onClick={() => onSave(s)}
          className="flex-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded px-2 py-1"
        >
          Apply
        </button>
        <button
          onClick={onCancel}
          className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded px-2 py-1"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Single ACTIVE line row ───────────────────────────────────────────────────

function ActiveLineRow({
  al,
  index,
  onDelete,
  onUpdate,
}: {
  al: ActiveLine;
  index: number;
  onDelete: () => void;
  onUpdate: (updated: ActiveLine) => void;
}) {
  const [editing, setEditing] = useState(false);

  const isSchedule = al.kind === 'schedule';

  return (
    <div className="bg-slate-800/40 rounded p-1.5 mb-1">
      <div className="flex items-center gap-1 mb-0.5">
        <span
          className={`text-[10px] uppercase tracking-wide font-semibold px-1 rounded ${
            al.kind === 'always'   ? 'bg-green-900/60 text-green-300' :
            al.kind === 'schedule' ? 'bg-blue-900/60 text-blue-300'   :
                                     'bg-slate-700 text-slate-400'
          }`}
        >
          {activeLineTitle(al)}
        </span>
        <span className="flex-1" />
        {isSchedule && (
          <button
            onClick={() => setEditing(v => !v)}
            className="text-slate-400 hover:text-blue-300 text-[10px] px-1"
            title="Edit schedule"
          >
            {editing ? '▲' : '✏'}
          </button>
        )}
        <button
          onClick={onDelete}
          className="text-slate-600 hover:text-red-400 text-[10px] px-1"
          title="Remove this ACTIVE line"
        >
          ✕
        </button>
      </div>

      {al.kind === 'always' && (
        <div className="text-xs text-green-300/70">Map is always visible</div>
      )}

      {al.kind === 'schedule' && !editing && (
        <div className="space-y-0.5">
          <div className="flex gap-2">
            <span className="text-slate-500 text-xs w-16 flex-shrink-0">Dates</span>
            <span className="text-slate-300 text-xs">{formatDate(al.startDate)} → {formatDate(al.endDate)}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-500 text-xs w-16 flex-shrink-0">Times</span>
            <span className="text-slate-300 text-xs">{formatTime(al.startTime)} – {formatTime(al.endTime)}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-slate-500 text-xs w-16 flex-shrink-0">Days</span>
            <span className="text-slate-300 text-xs">
              {al.weekdays === '0'
                ? 'Continuous'
                : al.weekdays.split('').map(d => WEEKDAY_LABELS[parseInt(d) - 1]).join(', ')}
            </span>
          </div>
        </div>
      )}

      {al.kind === 'schedule' && editing && (
        <ScheduleEditor
          initial={{ startDate: al.startDate, endDate: al.endDate, weekdays: al.weekdays, startTime: al.startTime, endTime: al.endTime }}
          onSave={s => {
            onUpdate({ kind: 'schedule', ...s });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {al.kind !== 'always' && al.kind !== 'schedule' && (
        <div className="text-xs text-slate-400 font-mono break-all">
          {'raw' in al ? al.raw : ''}
        </div>
      )}
    </div>
  );
}

// ─── Map / section properties panel ──────────────────────────────────────────

function MapSectionPanel({ section }: { section: MapSection }) {
  const updateMapActiveLines = useStore(s => s.updateMapActiveLines);
  const selectSection = useStore(s => s.selectSection);
  const [addingSchedule, setAddingSchedule] = useState(false);

  const activeLines = section.activeLines;

  const updateAt = (index: number, updated: ActiveLine) => {
    const next = [...activeLines];
    next[index] = updated;
    updateMapActiveLines(section.id, next);
  };

  const deleteAt = (index: number) => {
    updateMapActiveLines(section.id, activeLines.filter((_, i) => i !== index));
  };

  const addAlways = () => {
    updateMapActiveLines(section.id, [...activeLines, { kind: 'always' }]);
  };

  const addSchedule = (s: ScheduleEditorState) => {
    updateMapActiveLines(section.id, [
      ...activeLines,
      { kind: 'schedule', startDate: s.startDate, endDate: s.endDate, weekdays: s.weekdays, startTime: s.startTime, endTime: s.endTime },
    ]);
    setAddingSchedule(false);
  };

  return (
    <div className="w-56 flex-shrink-0 bg-slate-900 border-l border-slate-700 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-700 flex-shrink-0 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Map Layer</div>
          <div className="text-xs text-slate-500 truncate" title={section.name}>
            {section.name}{section.qualifier ? `:${section.qualifier}` : ''}
          </div>
        </div>
        <button
          onClick={() => selectSection(null)}
          className="text-slate-500 hover:text-slate-300 text-sm leading-none flex-shrink-0"
          title="Deselect"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {/* Meta */}
        {section.folder  && <Row label="Folder"   value={section.folder} />}
        {section.airport && <Row label="Airport"  value={section.airport} />}

        {/* ACTIVE lines */}
        <div className="mt-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1.5 flex items-center justify-between">
            <span>ACTIVE conditions</span>
            <span className="text-slate-600 normal-case">{activeLines.length === 0 ? 'none (hidden)' : ''}</span>
          </div>

          {activeLines.length === 0 && (
            <div className="text-xs text-slate-600 italic mb-2">No ACTIVE directives — layer may not be shown by EuroScope.</div>
          )}

          {activeLines.map((al, i) => (
            <ActiveLineRow
              key={i}
              al={al}
              index={i}
              onDelete={() => deleteAt(i)}
              onUpdate={updated => updateAt(i, updated)}
            />
          ))}

          {/* Add controls */}
          {!addingSchedule && (
            <div className="flex gap-1 mt-1">
              <button
                onClick={addAlways}
                className="flex-1 bg-green-900/40 hover:bg-green-800/50 text-green-400 hover:text-green-300 text-xs py-1 rounded"
              >
                + Always
              </button>
              <button
                onClick={() => setAddingSchedule(true)}
                className="flex-1 bg-blue-900/40 hover:bg-blue-800/50 text-blue-400 hover:text-blue-300 text-xs py-1 rounded"
              >
                + Schedule
              </button>
            </div>
          )}

          {addingSchedule && (
            <div className="mt-1">
              <div className="text-xs text-slate-400 mb-1">New schedule:</div>
              <ScheduleEditor
                initial={{ startDate: '', endDate: '', weekdays: '12345', startTime: '0000', endTime: '2359' }}
                onSave={addSchedule}
                onCancel={() => setAddingSchedule(false)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PropertiesPanel() {
  const parsedFile = useStore(s => s.parsedFile);
  const selectedMapId = useStore(s => s.selectedMapId);
  const selectedElementId = useStore(s => s.selectedElementId);
  const deleteElement = useStore(s => s.deleteElement);
  const selectElement = useStore(s => s.selectElement);

  if (!parsedFile || !selectedMapId) {
    return (
      <div className="w-56 flex-shrink-0 bg-slate-900 border-l border-slate-700 flex items-center justify-center text-slate-600 text-xs px-4 text-center">
        Click a feature on the map to inspect & edit its properties
      </div>
    );
  }

  const section = parsedFile.maps.find(m => m.id === selectedMapId);

  // Section selected, no element — show map/section panel with ACTIVE schedule editor
  if (!selectedElementId) {
    if (!section) {
      return (
        <div className="w-56 flex-shrink-0 bg-slate-900 border-l border-slate-700 flex items-center justify-center text-slate-600 text-xs">
          Section not found
        </div>
      );
    }
    return <MapSectionPanel section={section} />;
  }

  const item = section?.items.find(
    i => isGeoElement(i) && (i as GeoElement).id === selectedElementId
  ) as GeoElement | undefined;

  if (!section || !item) {
    return (
      <div className="w-56 flex-shrink-0 bg-slate-900 border-l border-slate-700 flex items-center justify-center text-slate-600 text-xs">
        Element not found
      </div>
    );
  }

  return (
    <div className="w-56 flex-shrink-0 bg-slate-900 border-l border-slate-700 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-700 flex-shrink-0 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
            Properties
          </div>
          <div className="text-xs text-slate-500 truncate" title={section.name}>
            {section.name}
          </div>
        </div>
        <button
          onClick={() => selectElement(null, null)}
          className="text-slate-500 hover:text-slate-300 text-sm leading-none flex-shrink-0"
          title="Deselect"
        >
          ✕
        </button>
      </div>

      {/* Props */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {item.kind === 'line'    && <LineProps    el={item} mapId={selectedMapId} />}
        {item.kind === 'polygon' && <PolygonProps el={item} mapId={selectedMapId} />}
        {item.kind === 'circle'  && <CircleProps  el={item} />}
        {item.kind === 'symbol'  && <SymbolProps  el={item} />}
        {item.kind === 'text'    && <TextProps    el={item} mapId={selectedMapId} />}
        {item.kind === 'path'    && <PathProps    el={item} mapId={selectedMapId} />}

        <div className="mt-3 pt-2 border-t border-slate-700/60">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Source</div>
          <div className="text-xs text-slate-400 font-mono">
            {section.name}{section.qualifier ? `:${section.qualifier}` : ''}
            {section.folder ? <span className="text-slate-600"> / {section.folder}</span> : null}
          </div>
          {item.sourceLine != null && (
            <div className="text-xs text-slate-500 font-mono mt-0.5">
              line <span className="text-amber-400">{item.sourceLine}</span>
              {item.kind === 'path' && item.lines.length > 1 && (
                <span className="text-slate-600">–{item.sourceLine + item.lines.length - 1}</span>
              )}
            </div>
          )}
          {item.sourceLine == null && (
            <div className="text-xs text-slate-600 italic">New element (not yet saved)</div>
          )}
        </div>

        <div className="mt-2 pt-1">
          <Row label="ID" value={item.id} />
        </div>
      </div>

      {/* Delete */}
      <div className="px-3 py-2 border-t border-slate-700 flex-shrink-0">
        <button
          onClick={() => deleteElement(selectedMapId, selectedElementId)}
          className="w-full bg-red-900/50 hover:bg-red-800/60 text-red-400 hover:text-red-300 text-xs py-1.5 rounded transition-colors"
        >
          Delete element
        </button>
        <div className="text-slate-600 text-xs mt-1 text-center">
          Drag yellow dots on map to edit vertices
        </div>
      </div>
    </div>
  );
}
