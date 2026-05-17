import { useState, useMemo, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { isGeoElement } from '../utils/parser';
import { colorDefToHex } from '../utils/coordinates';
import type { GeoElement, MapSection } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function elementLabel(el: GeoElement): string {
  if (el.elementName) return el.elementName;
  switch (el.kind) {
    case 'line':
      return `Line (${el.p1.lat.toFixed(4)}, ${el.p2.lat.toFixed(4)})`;
    case 'polygon':
      return `${el.coordType} (${el.coords.length} pts)`;
    case 'circle':
      return `Circle r=${el.radius.toFixed(2)} NM`;
    case 'symbol':
      return el.label ? `${el.symbolType}: ${el.label}` : el.symbolType;
    case 'text':
      return el.text;
    case 'path':
      return `Path (${el.lines.length + 1} pts)`;
  }
}

function elementIcon(el: GeoElement): string {
  switch (el.kind) {
    case 'line':    return '—';
    case 'path':    return '╌';
    case 'polygon': return '⬡';
    case 'circle':  return '◯';
    case 'symbol':  return '⊕';
    case 'text':    return 'T';
  }
}

// ─── Group checkbox (tristate: all on / mixed / all off) ─────────────────────

function GroupCheckbox({ sections }: { sections: MapSection[] }) {
  const setMapsVisibility = useStore(s => s.setMapsVisibility);
  const ref = useRef<HTMLInputElement>(null);
  const allOn = sections.length > 0 && sections.every(s => s.visible);
  const mixed = !allOn && sections.some(s => s.visible);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={allOn}
      onChange={e => { e.stopPropagation(); setMapsVisibility(sections.map(s => s.id), !allOn); }}
      onClick={e => e.stopPropagation()}
      className="w-3.5 h-3.5 accent-blue-400 flex-shrink-0 cursor-pointer"
    />
  );
}

// ─── Section row ──────────────────────────────────────────────────────────────

interface SectionRowProps {
  section: MapSection;
  /** Whether the section is from a multi-instance name group (show airport hint) */
  showAirport?: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  colorMap: Map<string, string>;
}

function SectionRow({ section, showAirport, isExpanded, onToggleExpand, colorMap }: SectionRowProps) {
  const toggleMapVisibility = useStore(s => s.toggleMapVisibility);
  const selectElement = useStore(s => s.selectElement);
  const selectSection = useStore(s => s.selectSection);
  const selectedElementId = useStore(s => s.selectedElementId);
  const selectedMapId = useStore(s => s.selectedMapId);
  const activeDrawGroupId = useStore(s => s.activeDrawGroupId);
  const setActiveDrawGroup = useStore(s => s.setActiveDrawGroup);

  const isActive = section.id === activeDrawGroupId;

  const geoCount = section.items.filter(isGeoElement).length;
  const allElements = useMemo(
    () => section.items.filter(isGeoElement) as GeoElement[],
    [section.items]
  );

  const handleActivate = () => {
    setActiveDrawGroup(isActive ? null : section.id);
    if (!isExpanded) onToggleExpand();
  };

  return (
    <div className={`mb-0.5 rounded ${isActive ? 'ring-1 ring-amber-500/60 bg-amber-500/5' : ''}`}>
      {/* Section header row */}
      <div className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-slate-700/50 group">
        <input
          type="checkbox"
          checked={section.visible}
          onChange={e => { e.stopPropagation(); toggleMapVisibility(section.id); }}
          onClick={e => e.stopPropagation()}
          className="w-3.5 h-3.5 accent-blue-400 flex-shrink-0"
        />
        {/* Expand/collapse arrow — separate click target */}
        <span
          className="text-slate-400 text-xs w-3 flex-shrink-0 select-none hover:text-slate-200"
          onClick={e => { e.stopPropagation(); onToggleExpand(); }}
        >
          {isExpanded ? '▾' : '▸'}
        </span>
        {/* Row body — clicking activates this group for drawing */}
        <span
          className={`flex-1 truncate text-xs select-none ${
            isActive
              ? 'text-amber-300 font-medium'
              : section.visible
              ? 'text-slate-200'
              : 'text-slate-500'
          }`}
          onClick={() => { handleActivate(); selectSection(section.id); }}
          title={isActive ? 'Active drawing group — click again to deselect' : 'Click to set as active drawing target'}
        >
          {showAirport ? (section.airport ?? section.name) : section.name}
          {section.qualifier && <span className={`ml-1 text-[10px] ${isActive ? 'text-amber-500' : 'text-slate-400'}`}>:{section.qualifier}</span>}
        </span>
        {isActive && (
          <span className="text-amber-400 text-[10px] flex-shrink-0" title="Active drawing target">✏</span>
        )}
        <span className="text-slate-600 text-xs ml-1 flex-shrink-0">{geoCount}</span>
      </div>

      {/* Expanded element list — flat, names come from elementName or geometric fallback */}
      {isExpanded && (
        <div className="ml-6 border-l border-slate-700 pl-1 mb-1">
          {geoCount === 0 && (
            <div className="text-slate-600 text-xs px-2 py-1 italic">No geometry</div>
          )}
          {allElements.map(el => (
            <ElementRow
              key={el.id}
              el={el}
              sectionId={section.id}
              color={colorMap.get(el.id) ?? '#888'}
              isSelected={el.id === selectedElementId && section.id === selectedMapId}
              onSelect={selectElement}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Single element row ───────────────────────────────────────────────────────

/** Return a representative [lat, lon] to pan to for any geo element type. */
function elementCenter(el: GeoElement): [number, number] | null {
  if (el.kind === 'line') return [(el.p1.lat + el.p2.lat) / 2, (el.p1.lon + el.p2.lon) / 2];
  if (el.kind === 'path') {
    const all = [el.lines[0].p1, ...el.lines.map(l => l.p2)];
    const mid = all[Math.floor(all.length / 2)];
    return [mid.lat, mid.lon];
  }
  if (el.kind === 'polygon') {
    const lat = el.coords.reduce((s, c) => s + c.lat, 0) / el.coords.length;
    const lon = el.coords.reduce((s, c) => s + c.lon, 0) / el.coords.length;
    return [lat, lon];
  }
  if (el.kind === 'circle') return [el.center.lat, el.center.lon];
  if (el.kind === 'symbol') return [el.coord.lat, el.coord.lon];
  if (el.kind === 'text') return [el.coord.lat, el.coord.lon];
  return null;
}

function ElementRow({ el, sectionId, color, isSelected, onSelect }: {
  el: GeoElement;
  sectionId: string;
  color: string;
  isSelected: boolean;
  onSelect: (mapId: string, elId: string) => void;
}) {
  const requestPanTo = useStore(s => s.requestPanTo);
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer text-xs
        ${isSelected ? 'bg-blue-600/30 text-blue-300' : 'hover:bg-slate-700/50 text-slate-300'}`}
      onClick={() => {
        onSelect(sectionId, el.id);
        const center = elementCenter(el);
        if (center) requestPanTo(center);
      }}
    >
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="text-slate-500 flex-shrink-0">{elementIcon(el)}</span>
      <span className="truncate">{elementLabel(el)}</span>
    </div>
  );
}

// ─── Name group (same MAP name appearing in multiple sections) ────────────────

interface NameGroupProps {
  name: string;
  qualifier?: string;
  sections: MapSection[];
  expandedSections: Set<string>;
  onToggleSection: (id: string) => void;
  colorMaps: Map<string, Map<string, string>>;
}

function NameGroup({ name, qualifier, sections, expandedSections, onToggleSection, colorMaps }: NameGroupProps) {
  const [open, setOpen] = useState(true);
  const totalGeo = sections.reduce((n, s) => n + s.items.filter(isGeoElement).length, 0);

  if (sections.length === 1) {
    // Single section — render directly without extra nesting
    const s = sections[0];
    return (
      <SectionRow
        section={s}
        isExpanded={expandedSections.has(s.id)}
        onToggleExpand={() => onToggleSection(s.id)}
        colorMap={colorMaps.get(s.id) ?? new Map()}
      />
    );
  }

  return (
    <div className="mb-0.5">
      <div className="flex items-center gap-1 px-2 py-0.5 hover:bg-slate-700/40 rounded">
        <GroupCheckbox sections={sections} />
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1 flex-1 min-w-0 text-xs text-slate-300"
        >
          <span className="text-slate-400 w-3 flex-shrink-0">{open ? '▾' : '▸'}</span>
          <span className="flex-1 truncate font-medium">
            {name}
            {qualifier && <span className="ml-1 text-slate-500">:{qualifier}</span>}
          </span>
          <span className="text-slate-600 text-xs flex-shrink-0">{sections.length} · {totalGeo}</span>
        </button>
      </div>
      {open && (
        <div className="ml-3 border-l border-slate-700/60 pl-1">
          {sections.map(s => (
            <SectionRow
              key={s.id}
              section={s}
              showAirport
              isExpanded={expandedSections.has(s.id)}
              onToggleExpand={() => onToggleSection(s.id)}
              colorMap={colorMaps.get(s.id) ?? new Map()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Folder group (within an airport) ────────────────────────────────────────

interface FolderGroupProps {
  name: string;
  sections: MapSection[];
  expandedSections: Set<string>;
  onToggleSection: (id: string) => void;
  colorMaps: Map<string, Map<string, string>>;
}

function FolderGroup({ name, sections, expandedSections, onToggleSection, colorMaps }: FolderGroupProps) {
  const [open, setOpen] = useState(true);

  const nameGroups = useMemo(() => {
    const map = new Map<string, MapSection[]>();
    for (const s of sections) {
      const key = `${s.name}${s.qualifier ? ':' + s.qualifier : ''}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [sections]);

  return (
    <div className="mb-0.5">
      <div className="flex items-center gap-1 px-2 py-0.5 hover:bg-slate-700/30 rounded">
        <GroupCheckbox sections={sections} />
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1 flex-1 min-w-0 text-[10px] text-slate-500 uppercase tracking-widest hover:text-slate-300"
        >
          <span className="w-3 flex-shrink-0">{open ? '▾' : '▸'}</span>
          <span className="truncate">{name}</span>
          <span className="ml-auto text-slate-700">{nameGroups.size}</span>
        </button>
      </div>
      {open && [...nameGroups.entries()].map(([key, secs]) => (
        <NameGroup
          key={key}
          name={secs[0].name}
          qualifier={secs[0].qualifier}
          sections={secs}
          expandedSections={expandedSections}
          onToggleSection={onToggleSection}
          colorMaps={colorMaps}
        />
      ))}
    </div>
  );
}

// ─── Airport group ────────────────────────────────────────────────────────────

interface AirportGroupProps {
  icao: string;
  sections: MapSection[];
  expandedSections: Set<string>;
  onToggleSection: (id: string) => void;
  colorMaps: Map<string, Map<string, string>>;
}

function AirportGroup({ icao, sections, expandedSections, onToggleSection, colorMaps }: AirportGroupProps) {
  const [open, setOpen] = useState(true);

  const folderGroups = useMemo(() => {
    const map = new Map<string, MapSection[]>();
    for (const s of sections) {
      const folder = s.folder ?? 'General';
      if (!map.has(folder)) map.set(folder, []);
      map.get(folder)!.push(s);
    }
    return map;
  }, [sections]);

  const totalGeo = sections.reduce((n, s) => n + s.items.filter(isGeoElement).length, 0);

  return (
    <div className="mb-1">
      <div className="flex items-center gap-1.5 px-2 py-1 hover:bg-slate-700/40 rounded">
        <GroupCheckbox sections={sections} />
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 flex-1 min-w-0"
        >
          <span className="text-slate-500 text-xs w-3">{open ? '▾' : '▸'}</span>
          <span className="font-mono font-bold text-sky-400 text-xs tracking-wide">{icao}</span>
          <span className="ml-auto text-slate-600 text-[10px]">{totalGeo}</span>
        </button>
      </div>
      {open && (
        <div className="ml-2 border-l border-slate-700/50 pl-1">
          {[...folderGroups.entries()].map(([folder, secs]) => (
            <FolderGroup
              key={folder}
              name={folder}
              sections={secs}
              expandedSections={expandedSections}
              onToggleSection={onToggleSection}
              colorMaps={colorMaps}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Airspace group (sections with no AIRPORT: field) ────────────────────────

interface AirspaceGroupProps {
  sections: MapSection[];
  expandedSections: Set<string>;
  onToggleSection: (id: string) => void;
  colorMaps: Map<string, Map<string, string>>;
}

function AirspaceGroup({ sections, expandedSections, onToggleSection, colorMaps }: AirspaceGroupProps) {
  const [open, setOpen] = useState(true);

  // Group by name (qualifier included in key)
  const nameGroups = useMemo(() => {
    const map = new Map<string, MapSection[]>();
    for (const s of sections) {
      const key = `${s.name}${s.qualifier ? ':' + s.qualifier : ''}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [sections]);

  const totalGeo = sections.reduce((n, s) => n + s.items.filter(isGeoElement).length, 0);

  return (
    <div className="mb-1 border-b border-slate-700/50 pb-1">
      <div className="flex items-center gap-1.5 px-2 py-1 hover:bg-slate-700/40 rounded">
        <GroupCheckbox sections={sections} />
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 flex-1 min-w-0"
        >
          <span className="text-slate-500 text-xs w-3">{open ? '▾' : '▸'}</span>
          <span className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">Airspaces</span>
          <span className="ml-auto text-slate-600 text-[10px]">{totalGeo}</span>
        </button>
      </div>
      {open && (
        <div className="ml-2 border-l border-slate-700/50 pl-1">
          {[...nameGroups.entries()].map(([key, secs]) => (
            <NameGroup
              key={key}
              name={secs[0].name}
              qualifier={secs[0].qualifier}
              sections={secs}
              expandedSections={expandedSections}
              onToggleSection={onToggleSection}
              colorMaps={colorMaps}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Sidebar ─────────────────────────────────────────────────────────────

/** First ICAO in the AIRPORT: field, e.g. "EPWA,EPWW" → "EPWA" */
function primaryAirport(section: MapSection): string | null {
  if (!section.airport) return null;
  return section.airport.split(',')[0].trim() || null;
}

export function Sidebar() {
  const parsedFile = useStore(s => s.parsedFile);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const colorMaps = useMemo(() => {
    if (!parsedFile) return new Map<string, Map<string, string>>();
    const result = new Map<string, Map<string, string>>();
    for (const section of parsedFile.maps) {
      const map = new Map<string, string>();
      let current = '#8888aa';
      for (const item of section.items) {
        if (item.kind === 'color') {
          const def = parsedFile.colorDefs.find(c => c.name === item.value);
          current = def ? colorDefToHex(def.r, def.g, def.b) : '#8888aa';
        } else if (isGeoElement(item)) {
          map.set((item as GeoElement).id, current);
        }
      }
      result.set(section.id, map);
    }
    return result;
  }, [parsedFile]);

  // Split into airspaces (no AIRPORT:) and per-ICAO airport groups
  const { airspaces, airports } = useMemo(() => {
    const airspaces: MapSection[] = [];
    const airports = new Map<string, MapSection[]>();
    if (!parsedFile) return { airspaces, airports };
    const q = search.toLowerCase();
    for (const section of parsedFile.maps) {
      if (q &&
        !section.name.toLowerCase().includes(q) &&
        !(section.airport ?? '').toLowerCase().includes(q) &&
        !section.items.some(i =>
          i.kind === 'comment' && i.text.toLowerCase().includes(q)
        )
      ) continue;
      const icao = primaryAirport(section);
      if (!icao) {
        airspaces.push(section);
      } else {
        if (!airports.has(icao)) airports.set(icao, []);
        airports.get(icao)!.push(section);
      }
    }
    return { airspaces, airports };
  }, [parsedFile, search]);

  if (!parsedFile) {
    return (
      <div className="w-64 flex-shrink-0 bg-slate-900 border-r border-slate-700 flex items-center justify-center text-slate-600 text-xs">
        No file loaded
      </div>
    );
  }

  const totalSections = parsedFile.maps.length;
  const totalElements = parsedFile.maps.reduce(
    (acc, s) => acc + s.items.filter(isGeoElement).length,
    0
  );

  return (
    <div className="w-64 flex-shrink-0 bg-slate-900 border-r border-slate-700 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-700 flex-shrink-0">
        <div className="text-xs font-semibold text-slate-300 mb-1">LAYERS</div>
        <div className="text-xs text-slate-500">
          {totalSections} maps · {totalElements} elements
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter by name, ICAO, or comment…"
          className="mt-1.5 w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-blue-500"
        />
      </div>

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto py-1">
        {airspaces.length > 0 && (
          <AirspaceGroup
            sections={airspaces}
            expandedSections={expandedSections}
            onToggleSection={toggleSection}
            colorMaps={colorMaps}
          />
        )}
        {[...airports.entries()].map(([icao, secs]) => (
          <AirportGroup
            key={icao}
            icao={icao}
            sections={secs}
            expandedSections={expandedSections}
            onToggleSection={toggleSection}
            colorMaps={colorMaps}
          />
        ))}
      </div>
    </div>
  );
}

