import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useMap, useMapEvents } from "react-leaflet";
import type L from "leaflet";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error  vite ?url suffix resolved at build time
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerSrc;

// ---------------------------------------------------------------------------

interface ScreenBox { x: number; y: number; w: number; h: number; }
interface Props { onClose: () => void; }

// ---------------------------------------------------------------------------
// PDFOverlayFeature
// Must be rendered inside <MapContainer>.
// The PDF is geo-anchored immediately on load and ALWAYS follows map pan/zoom.
// "Lock PDF" only disables the drag/scale/rotate handles and enables click-through.
// ---------------------------------------------------------------------------

export function PDFOverlayFeature({ onClose }: Props) {
  const map = useMap();

  const [pdfUrl, setPdfUrl]           = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState(1);
  const [box, setBox]                 = useState<ScreenBox>({ x: 60, y: 60, w: 400, h: 520 });
  const [rotation, setRotation]       = useState(0);
  const [rotInput, setRotInput]       = useState("0");
  const [opacity, setOpacity]         = useState(0.5);
  const [locked, setLocked]           = useState(false);
  const [loading, setLoading]         = useState(false);

  // Page picker
  const [showPagePicker, setShowPagePicker] = useState(false);
  const [pageCount, setPageCount]           = useState(0);
  const [selectedPage, setSelectedPage]     = useState(1);
  const [pageInput, setPageInput]           = useState("1");
  const [thumbnails, setThumbnails]         = useState<(string | null)[]>([]);
  const [isZooming, setIsZooming]           = useState(false);
  const pendingPdfRef  = useRef<PDFDocumentProxy | null>(null);
  const thumbCancelRef = useRef(false);

  // Always-current refs (avoids stale closures in window event listeners)
  const boxRef    = useRef(box);
  const rotRef    = useRef(rotation);
  const lockedRef = useRef(locked);
  const arRef     = useRef(aspectRatio);
  useEffect(() => { boxRef.current    = box;         }, [box]);
  useEffect(() => { rotRef.current    = rotation;    }, [rotation]);
  useEffect(() => { lockedRef.current = locked;      }, [locked]);
  useEffect(() => { arRef.current     = aspectRatio; }, [aspectRatio]);
  useEffect(() => { setRotInput(String(Math.round(rotation))); }, [rotation]);

  // Geographic anchor — set on load, updated after every drag/scale.
  // reposition() uses this without checking locked, so the PDF always follows the map.
  const anchorRef  = useRef<ReturnType<typeof map.containerPointToLatLng> | null>(null);
  const refZoomRef = useRef(map.getZoom());
  const refSizeRef = useRef<{ w: number; h: number }>({ w: 400, h: 520 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const didAutoOpen  = useRef(false);

  useEffect(() => {
    if (!didAutoOpen.current) {
      didAutoOpen.current = true;
      fileInputRef.current?.click();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Render a specific page from an already-loaded PDF document
  // ---------------------------------------------------------------------------

  const renderPage = useCallback(async (pdfDoc: PDFDocumentProxy, pageNum: number) => {
    setLoading(true);
    setShowPagePicker(false);
    try {
      const page      = await pdfDoc.getPage(pageNum);
      const naturalVp  = page.getViewport({ scale: 1 });
      const dpr        = window.devicePixelRatio || 1;
      // Render at enough resolution to stay crisp after scaling.
      // Target max-dimension of ~2200px * DPR, clamped between scale 3 and 6.
      const renderScale = Math.min(6, Math.max(3, (dpr * 2200) / Math.max(naturalVp.width, naturalVp.height)));
      const vp         = page.getViewport({ scale: renderScale });

      const canvas = document.createElement("canvas");
      canvas.width  = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({
        canvas: canvas as HTMLCanvasElement,
        canvasContext: ctx as CanvasRenderingContext2D,
        viewport: vp,
      }).promise;

      const url = canvas.toDataURL("image/png");
      const ar  = vp.width / vp.height;
      const ms  = map.getSize();
      const w   = Math.min(560, ms.x * 0.55);
      const h   = w / ar;
      const cx  = (ms.x - w) / 2;
      const cy  = (ms.y - h) / 2;
      const newBox: ScreenBox = { x: cx, y: cy, w, h };

      // Sync refs immediately (useEffect is one render behind)
      boxRef.current    = newBox;
      arRef.current     = ar;
      lockedRef.current = false;

      setPdfUrl(url);
      setAspectRatio(ar);
      setBox(newBox);
      setRotation(0);
      setRotInput("0");
      setLocked(false);

      // Geo-anchor to the current map center so the PDF follows pan/zoom right away
      anchorRef.current  = map.containerPointToLatLng([cx + w / 2, cy + h / 2]);
      refZoomRef.current = map.getZoom();
      refSizeRef.current = { w, h };
      pendingPdfRef.current = null;
    } catch (err) {
      console.error("PDF render failed:", err);
    } finally {
      setLoading(false);
    }
  }, [map]);

  // ---------------------------------------------------------------------------
  // Load PDF file — shows page picker for multi-page PDFs
  // ---------------------------------------------------------------------------

  const loadPDF = useCallback(async (file: File) => {
    setLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await getDocument({ data: arrayBuffer }).promise;

      if (pdfDoc.numPages === 1) {
        await renderPage(pdfDoc, 1); // renderPage manages setLoading(false)
      } else {
        const numPages = pdfDoc.numPages;
        pendingPdfRef.current = pdfDoc;
        setPageCount(numPages);
        setSelectedPage(1);
        setPageInput("1");
        setThumbnails(new Array(numPages).fill(null));
        setShowPagePicker(true);
        setLoading(false);
        thumbCancelRef.current = false;
        // Render thumbnails progressively in the background
        (async () => {
          const firstPage = await pdfDoc.getPage(1);
          const nVp = firstPage.getViewport({ scale: 1 });
          const thumbScale = Math.min(0.4, 150 / nVp.width);
          for (let i = 1; i <= numPages; i++) {
            if (thumbCancelRef.current) break;
            try {
              const p   = await pdfDoc.getPage(i);
              const tvp = p.getViewport({ scale: thumbScale });
              const c   = document.createElement("canvas");
              c.width   = Math.round(tvp.width);
              c.height  = Math.round(tvp.height);
              const tctx = c.getContext("2d")!;
              await p.render({ canvas: c as HTMLCanvasElement, canvasContext: tctx as CanvasRenderingContext2D, viewport: tvp }).promise;
              const url = c.toDataURL("image/jpeg", 0.7);
              if (!thumbCancelRef.current) {
                setThumbnails(prev => { const next = [...prev]; next[i - 1] = url; return next; });
              }
            } catch { /* skip failed page */ }
          }
        })();
      }
    } catch (err) {
      console.error("PDF load failed:", err);
      setLoading(false);
    }
  }, [renderPage]);

  // ---------------------------------------------------------------------------
  // Reposition on every map move/zoom — always active, anchor set on load
  // ---------------------------------------------------------------------------

  const reposition = useCallback(() => {
    if (!anchorRef.current) return;
    const zd = map.getZoom() - refZoomRef.current;
    const s  = Math.pow(2, zd);
    const w  = refSizeRef.current.w * s;
    const h  = refSizeRef.current.h * s;
    const pt = map.latLngToContainerPoint(anchorRef.current as L.LatLng);
    setBox({ x: pt.x - w / 2, y: pt.y - h / 2, w, h });
  }, [map]);

  useMapEvents({ move: reposition, moveend: reposition, zoomend: reposition });

  // Smooth zoom animation — pre-positions the overlay at the start of Leaflet's
  // 250ms CSS zoom transition so the PDF moves in sync with the map tiles.
  useEffect(() => {
    const onZoomAnim = (e: L.ZoomAnimEvent) => {
      if (!anchorRef.current) return;
      const zd             = e.zoom - refZoomRef.current;
      const s              = Math.pow(2, zd);
      const w              = refSizeRef.current.w * s;
      const h              = refSizeRef.current.h * s;
      const targetCenterPx = map.project(e.center, e.zoom);
      const anchorAbsPx    = map.project(anchorRef.current as L.LatLng, e.zoom);
      const pt             = anchorAbsPx.subtract(targetCenterPx).add(map.getSize().divideBy(2));
      setIsZooming(true);
      setBox({ x: pt.x - w / 2, y: pt.y - h / 2, w, h });
    };
    const onZoomEnd = () => setIsZooming(false);
    map.on("zoomanim", onZoomAnim as L.LeafletEventHandlerFn);
    map.on("zoomend",  onZoomEnd);
    return () => {
      map.off("zoomanim", onZoomAnim as L.LeafletEventHandlerFn);
      map.off("zoomend",  onZoomEnd);
    };
  }, [map]);

  // ---------------------------------------------------------------------------
  // Lock / Unlock — only controls handle interactivity, not geo-anchor
  // ---------------------------------------------------------------------------

  const handleLock = useCallback(() => {
    setLocked(l => !l);
  }, []);

  // ---------------------------------------------------------------------------
  // Helper: disable Leaflet map dragging for the duration of a handle operation.
  // React synthetic stopPropagation does NOT reach Leaflet (native DOM listeners).
  // Disabling dragging before any mousemove prevents the map from panning.
  // ---------------------------------------------------------------------------

  const withDragDisabled = useCallback((setup: (restore: () => void) => void) => {
    const was = map.dragging.enabled();
    map.dragging.disable();
    setup(() => { if (was) map.dragging.enable(); });
  }, [map]);

  // ---------------------------------------------------------------------------
  // Drag the PDF image
  // ---------------------------------------------------------------------------

  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    if (lockedRef.current) return;
    e.stopPropagation();
    withDragDisabled(restore => {
      const startMx = e.clientX, startMy = e.clientY;
      const startX  = boxRef.current.x,  startY  = boxRef.current.y;
      const onMove = (ev: MouseEvent) => {
        setBox(b => ({ ...b, x: startX + ev.clientX - startMx, y: startY + ev.clientY - startMy }));
      };
      const onUp = () => {
        restore();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        // Read latest box via setState to avoid stale closure; update geo-anchor
        setBox(b => {
          anchorRef.current  = map.containerPointToLatLng([b.x + b.w / 2, b.y + b.h / 2]);
          refZoomRef.current = map.getZoom();
          refSizeRef.current = { w: b.w, h: b.h };
          return b;
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }, [map, withDragDisabled]);

  // ---------------------------------------------------------------------------
  // Scale handle (SE corner)
  // ---------------------------------------------------------------------------

  const handleScaleMouseDown = useCallback((e: React.MouseEvent) => {
    if (lockedRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    withDragDisabled(restore => {
      const startMx = e.clientX;
      const startW  = boxRef.current.w;
      const startH  = boxRef.current.h;
      const centerX = boxRef.current.x + startW / 2;
      const centerY = boxRef.current.y + startH / 2;
      const ar      = arRef.current;
      const onMove = (ev: MouseEvent) => {
        // Scale from center: dragging SE corner by delta expands both sides by delta
        const newW = Math.max(80, startW + 2 * (ev.clientX - startMx));
        const newH = newW / ar;
        setBox({ x: centerX - newW / 2, y: centerY - newH / 2, w: newW, h: newH });
      };
      const onUp = () => {
        restore();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setBox(b => {
          refSizeRef.current = { w: b.w, h: b.h };
          refZoomRef.current = map.getZoom();
          anchorRef.current  = map.containerPointToLatLng([b.x + b.w / 2, b.y + b.h / 2]);
          return b;
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }, [map, withDragDisabled]);

  // ---------------------------------------------------------------------------
  // Rotate handle (top-center)
  // ---------------------------------------------------------------------------

  const handleRotateMouseDown = useCallback((e: React.MouseEvent) => {
    if (lockedRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    withDragDisabled(restore => {
      const rect   = map.getContainer().getBoundingClientRect();
      const b      = boxRef.current;
      const cx     = rect.left + b.x + b.w / 2;
      const cy     = rect.top  + b.y + b.h / 2;
      const startA = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
      const startR = rotRef.current;
      const onMove = (ev: MouseEvent) => {
        const a = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI);
        setRotation(((startR + a - startA) % 360 + 360) % 360);
      };
      const onUp = () => {
        restore();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }, [map, withDragDisabled]);

  // ---------------------------------------------------------------------------
  // Misc helpers
  // ---------------------------------------------------------------------------

  const nudgeRotation = useCallback((delta: number) => {
    setRotation(r => ((r + delta) % 360 + 360) % 360);
  }, []);

  const applyRotInput = useCallback(() => {
    const val = parseFloat(rotInput);
    if (!isNaN(val)) setRotation(((val % 360) + 360) % 360);
  }, [rotInput]);

  const handleRemove = useCallback(() => {
    thumbCancelRef.current = true;
    setPdfUrl(null);
    setShowPagePicker(false);
    setThumbnails([]);
    pendingPdfRef.current = null;
    anchorRef.current = null;
    setLocked(false);
    onClose();
  }, [onClose]);

  // Prevent map drag when clicking the controls panel
  const handleControlsMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    withDragDisabled(restore => {
      const onUp = () => { restore(); window.removeEventListener("mouseup", onUp); };
      window.addEventListener("mouseup", onUp);
    });
  }, [withDragDisabled]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const container = map.getContainer();

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".pdf"
      className="hidden"
      onChange={e => {
        const f = e.target.files?.[0];
        if (f) loadPDF(f);
        e.target.value = "";
      }}
    />
  );

  // Loading spinner
  if (loading) {
    return createPortal(
      <>
        {fileInput}
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1001, pointerEvents: "none" }}>
          <div className="bg-slate-800 border border-slate-600 rounded-xl px-8 py-4 text-slate-300 text-sm shadow-2xl">
            <div className="flex items-center gap-3">
              <svg className="animate-spin w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
              Rendering PDF...
            </div>
          </div>
        </div>
      </>,
      container,
    );
  }

  // Page picker modal (multi-page PDFs) — visual thumbnail grid
  if (showPagePicker) {
    const cancelPicker = () => {
      thumbCancelRef.current = true;
      setShowPagePicker(false);
      setThumbnails([]);
      pendingPdfRef.current = null;
      onClose();
    };
    return createPortal(
      <>
        {fileInput}
        <div
          style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1001, background: "rgba(0,0,0,0.6)" }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div
            className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl text-slate-200 select-none flex flex-col"
            style={{ width: 680, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 64px)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-700 shrink-0">
              <div>
                <div className="text-sm font-semibold text-slate-100">Select Page to Import</div>
                <div className="text-xs text-slate-400 mt-0.5">{pageCount} pages — click a thumbnail to select</div>
              </div>
              <button onClick={cancelPicker} className="text-slate-500 hover:text-slate-200 text-xl leading-none transition-colors ml-4">&#10005;</button>
            </div>

            {/* Thumbnail grid */}
            <div className="overflow-y-auto p-4 flex-1 min-h-0" style={{ scrollbarWidth: "thin", scrollbarColor: "#475569 transparent" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {thumbnails.map((thumb, i) => (
                  <button
                    key={i}
                    onClick={() => { setSelectedPage(i + 1); setPageInput(String(i + 1)); }}
                    className={`rounded-lg overflow-hidden border-2 transition-all text-left bg-slate-900 ${
                      selectedPage === i + 1
                        ? "border-blue-500 ring-2 ring-blue-500/30"
                        : "border-slate-700 hover:border-slate-500"
                    }`}
                  >
                    {thumb ? (
                      <img src={thumb} alt={`Page ${i + 1}`} draggable={false} style={{ width: "100%", height: "auto", display: "block" }} />
                    ) : (
                      <div style={{ aspectRatio: "210/297" }} className="flex items-center justify-center text-slate-600">
                        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                        </svg>
                      </div>
                    )}
                    <div className={`text-center text-[11px] py-1 tabular-nums ${
                      selectedPage === i + 1 ? "text-blue-400 font-semibold" : "text-slate-500"
                    }`}>{i + 1}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700 shrink-0">
              <span className="text-xs text-slate-400">Page <span className="text-slate-200 font-semibold">{selectedPage}</span> of {pageCount} selected</span>
              <div className="flex gap-2">
                <button onClick={cancelPicker} className="py-1.5 px-4 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors">Cancel</button>
                <button
                  onClick={() => { if (pendingPdfRef.current) renderPage(pendingPdfRef.current, selectedPage); }}
                  className="py-1.5 px-4 text-xs bg-blue-600 hover:bg-blue-500 rounded font-semibold transition-colors"
                >Import page {selectedPage}</button>
              </div>
            </div>
          </div>
        </div>
      </>,
      container,
    );
  }

  // No PDF loaded yet
  if (!pdfUrl) {
    return createPortal(fileInput, container);
  }

  const { x, y, w, h } = box;

  return createPortal(
    <>
      {fileInput}

      {/* PDF image */}
      <div
        style={{
          position: "absolute",
          left: x, top: y, width: w, height: h,
          transform: `rotate(${rotation}deg)`,
          transformOrigin: "center center",
          pointerEvents: locked ? "none" : "auto",
          zIndex: 300,
          cursor: locked ? "default" : "move",
          userSelect: "none",
          // Animate position/size during Leaflet zoom to match its 250ms CSS transition
          transition: isZooming
            ? "left 0.25s cubic-bezier(0,0,0.25,1), top 0.25s cubic-bezier(0,0,0.25,1), width 0.25s cubic-bezier(0,0,0.25,1), height 0.25s cubic-bezier(0,0,0.25,1)"
            : "none",
        }}
        onMouseDown={handleDragMouseDown}
      >
        <img
          src={pdfUrl}
          alt="PDF overlay"
          draggable={false}
          style={{ width: "100%", height: "100%", opacity, display: "block", pointerEvents: "none" }}
        />

        {!locked && (
          <>
            {/* Selection border */}
            <div style={{ position: "absolute", inset: 0, border: "2px dashed rgba(59,130,246,0.75)", borderRadius: 2, pointerEvents: "none" }} />

            {/* Rotate handle — top-center */}
            <div
              title="Drag to rotate"
              onMouseDown={handleRotateMouseDown}
              style={{
                position: "absolute", top: -32, left: "50%",
                transform: "translateX(-50%)",
                width: 20, height: 20,
                background: "#22c55e", border: "2px solid #14532d",
                borderRadius: "50%", cursor: "grab", zIndex: 2,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg viewBox="0 0 16 16" width="11" height="11" fill="white">
                <path d="M8 2.5a5.5 5.5 0 1 0 4.546 2.399l1.331-.769A7 7 0 1 1 8 1v1.5z"/>
                <path d="M8 1l2.5 2.5L8 6V1z"/>
              </svg>
            </div>

            {/* Connector line */}
            <div style={{ position: "absolute", top: -18, left: "50%", marginLeft: -1, width: 2, height: 18, background: "rgba(34,197,94,0.45)", pointerEvents: "none" }} />

            {/* Scale handle — SE corner */}
            <div
              title="Drag to scale (maintains aspect ratio)"
              onMouseDown={handleScaleMouseDown}
              style={{
                position: "absolute", bottom: -7, right: -7,
                width: 14, height: 14,
                background: "#3b82f6", border: "2px solid #1e3a8a",
                borderRadius: 3, cursor: "se-resize", zIndex: 2,
              }}
            />
          </>
        )}
      </div>

      {/* Controls panel */}
      <div
        style={{
          position: "absolute", bottom: 28, left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000, pointerEvents: "auto", whiteSpace: "nowrap",
        }}
        className="bg-slate-800/95 backdrop-blur border border-slate-600 rounded-xl shadow-2xl flex items-center gap-2.5 px-4 py-2 text-sm text-slate-200 select-none"
        onMouseDown={handleControlsMouseDown}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded transition-colors"
          title="Load a different PDF"
        >&#128196; Replace</button>

        <div className="w-px h-5 bg-slate-600" />

        <div className="flex items-center gap-1">
          <span className="text-[11px] text-slate-400 mr-0.5">Rotation</span>
          <button onClick={() => nudgeRotation(-1)} disabled={locked}
            className="w-6 h-6 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-base leading-none transition-colors" title="-1 degree">-</button>
          <input
            type="number" min={0} max={359} step={1}
            value={rotInput}
            onChange={e => setRotInput(e.target.value)}
            onBlur={applyRotInput}
            onKeyDown={e => e.key === "Enter" && applyRotInput()}
            disabled={locked}
            className="w-14 bg-slate-700 border border-slate-600 rounded text-center text-xs px-1 py-1 disabled:opacity-40 outline-none focus:border-blue-500 transition-colors"
          />
          <span className="text-[11px] text-slate-400">deg</span>
          <button onClick={() => nudgeRotation(1)} disabled={locked}
            className="w-6 h-6 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-base leading-none transition-colors" title="+1 degree">+</button>
        </div>

        <div className="w-px h-5 bg-slate-600" />

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">Opacity</span>
          <input
            type="range" min={0.05} max={1} step={0.05}
            value={opacity}
            onChange={e => setOpacity(+e.target.value)}
            className="w-28 accent-blue-400 cursor-pointer"
          />
          <span className="text-[11px] text-slate-300 w-8 text-right tabular-nums">{Math.round(opacity * 100)}%</span>
        </div>

        <div className="w-px h-5 bg-slate-600" />

        <button
          onClick={handleLock}
          className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${locked ? "bg-green-700 hover:bg-green-600 text-white" : "bg-blue-600 hover:bg-blue-500 text-white"}`}
          title={locked ? "Unlock to reposition/resize/rotate" : "Lock PDF - clicks pass through to map"}
        >{locked ? "Locked" : "Lock PDF"}</button>

        <button
          onClick={handleRemove}
          className="text-slate-500 hover:text-slate-200 text-xl leading-none ml-1 transition-colors"
          title="Remove PDF overlay"
        >x</button>
      </div>
    </>,
    container,
  );
}
