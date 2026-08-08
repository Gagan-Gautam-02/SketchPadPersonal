"use client";

import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ref,
  push,
  set,
  remove,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onValue,
  type Unsubscribe,
} from "firebase/database";
import {
  collection,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getDb, getFirestoreDb } from "@/app/lib/firebase";
import SaveModal from "./SaveModal";
import {
  Palette,
  Minus,
  Plus,
  Trash2,
  Save,
  Image as ImageIcon,
  Loader2,
  Check,
  X,
  Pen,
  Eraser,
  Undo2,
  Redo2,
  LayoutGrid,
} from "lucide-react";

/* ─── Types ──────────────────────────────────────────────── */

interface NormalizedPoint {
  x: number; // 0.0 – 1.0
  y: number; // 0.0 – 1.0
}

interface StrokeData {
  points: NormalizedPoint[];
  color: string;
  width: number; // normalized width as fraction of canvas width
  eraser?: boolean;
}

type ToolType = "pen" | "eraser";

interface SketchpadProps {
  onOpenGallery: () => void;
  /** When set, the component draws this image onto the canvas and clears the prop */
  loadImageDataUrl: string | null;
  onImageLoaded: () => void;
}

/* ─── Constants ──────────────────────────────────────────── */

const RTDB_PATH = "live-strokes";
const THROTTLE_MS = 30;
const DEFAULT_COLOR = "#6c63ff";
const THICKNESS_OPTIONS = [2, 4, 6, 10, 16];
const DEFAULT_THICKNESS_IDX = 1;
const PAGE_HEIGHT_PX = 800;

type BgKey = "white" | "cream" | "grid" | "lined" | "dotted" | "dark";
const BG_OPTIONS: { key: BgKey; label: string; css: string; preview: string }[] = [
  { key: "white", label: "White", css: "canvas-bg-white", preview: "#fff" },
  { key: "cream", label: "Cream", css: "canvas-bg-cream", preview: "#fdf6e3" },
  { key: "grid", label: "Grid", css: "canvas-bg-grid", preview: "#eee" },
  { key: "lined", label: "Lined", css: "canvas-bg-lined", preview: "#e8f0fe" },
  { key: "dotted", label: "Dotted", css: "canvas-bg-dotted", preview: "#ddd" },
  { key: "dark", label: "Dark", css: "canvas-bg-dark", preview: "#1e1e2e" },
];

/* ─── Toast State ────────────────────────────────────────── */

type ToastKind = "success" | "error";

interface Toast {
  message: string;
  kind: ToastKind;
  id: number;
}

/* ─── Helpers ────────────────────────────────────────────── */

function toNormalized(
  px: number,
  py: number,
  cw: number,
  ch: number
): NormalizedPoint {
  return { x: px / cw, y: py / ch };
}

function fromNormalized(
  pt: NormalizedPoint,
  cw: number,
  ch: number
): { x: number; y: number } {
  return { x: pt.x * cw, y: pt.y * ch };
}

/* ─── Component ──────────────────────────────────────────── */

export default function Sketchpad({
  onOpenGallery,
  loadImageDataUrl,
  onImageLoaded,
}: SketchpadProps) {
  /* ── Refs (no re-renders during drawing) ───────────────── */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDrawing = useRef(false);
  const currentStrokeId = useRef<string | null>(null);
  const currentPoints = useRef<NormalizedPoint[]>([]);
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logicalSize = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  /**
   * strokes stores ALL completed or in-progress strokes that have been
   * received from RTDB (including our own echoed back). We redraw from
   * this map whenever the canvas resizes.
   */
  const strokesMap = useRef<Map<string, StrokeData>>(new Map());

  /**
   * Keep a reference to the base image (loaded from gallery) so we can
   * redraw it on resize too.
   */
  const baseImageRef = useRef<HTMLImageElement | null>(null);

  /** Track keys of strokes created locally (for undo) */
  const localStrokeKeys = useRef<string[]>([]);
  const redoStack = useRef<{ key: string; data: StrokeData }[]>([]);

  /* ── UI State ──────────────────────────────────────────── */
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [thicknessIdx, setThicknessIdx] = useState(DEFAULT_THICKNESS_IDX);
  const [tool, setTool] = useState<ToolType>("pen");
  const [bgKey, setBgKey] = useState<BgKey>("grid");
  const [pages, setPages] = useState(1);
  const [saving, setSaving] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showBgPicker, setShowBgPicker] = useState(false);

  const thickness = THICKNESS_OPTIONS[thicknessIdx];

  /* ── Toast helper ──────────────────────────────────────── */
  const addToast = useCallback((message: string, kind: ToastKind) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { message, kind, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  /* ── Canvas setup & ResizeObserver ─────────────────────── */
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    logicalSize.current = { w, h };

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctxRef.current = ctx;

    redrawAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Redraw helper (from normalized data) ──────────────── */
  const redrawAll = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { w, h } = logicalSize.current;
    ctx.clearRect(0, 0, w, h);

    // Draw base image if present
    if (baseImageRef.current) {
      ctx.drawImage(baseImageRef.current, 0, 0, w, h);
    }

    // Draw all strokes
    strokesMap.current.forEach((stroke) => {
      if (stroke.points.length < 2) return;
      ctx.globalCompositeOperation = stroke.eraser ? "destination-out" : "source-over";
      ctx.beginPath();
      ctx.strokeStyle = stroke.eraser ? "rgba(0,0,0,1)" : stroke.color;
      ctx.lineWidth = stroke.width * w;

      const first = fromNormalized(stroke.points[0], w, h);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < stroke.points.length; i++) {
        const pt = fromNormalized(stroke.points[i], w, h);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    });
    ctx.globalCompositeOperation = "source-over";
  }, []);

  /* ── ResizeObserver ────────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setupCanvas();

    const observer = new ResizeObserver(() => {
      setupCanvas();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [setupCanvas]);

  /* ── RTDB Listeners ────────────────────────────────────── */
  useEffect(() => {
    const strokesRef = ref(getDb(), RTDB_PATH);
    const unsubs: Unsubscribe[] = [];

    // Listen for new / updated strokes
    const unsubAdd = onChildAdded(strokesRef, (snapshot) => {
      const data = snapshot.val() as StrokeData | null;
      const key = snapshot.key;
      if (!data || !key) return;
      strokesMap.current.set(key, data);
      redrawAll();
    });
    unsubs.push(unsubAdd);

    // Listen for stroke updates (points being added while drawing)
    const unsubChange = onChildChanged(strokesRef, (snapshot) => {
      const data = snapshot.val() as StrokeData | null;
      const key = snapshot.key;
      if (!data || !key) return;
      strokesMap.current.set(key, data);
      redrawAll();
    });
    unsubs.push(unsubChange);

    // Listen for stroke removal (clear canvas from another device)
    const unsubRemove = onChildRemoved(strokesRef, (snapshot) => {
      const key = snapshot.key;
      if (key) strokesMap.current.delete(key);
      redrawAll();
    });
    unsubs.push(unsubRemove);

    // Listen for the entire node being set to null (remove() on root)
    const unsubValue = onValue(strokesRef, (snapshot) => {
      if (!snapshot.exists()) {
        strokesMap.current.clear();
        redrawAll();
      }
    });
    unsubs.push(unsubValue);

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [redrawAll]);

  /* ── Load image from gallery ───────────────────────────── */
  useEffect(() => {
    if (!loadImageDataUrl) return;
    const img = new window.Image();
    img.onload = () => {
      baseImageRef.current = img;

      // Also sync the base image to RTDB so other devices see it
      const baseRef = ref(getDb(), "base-image");
      set(baseRef, loadImageDataUrl).catch(() => {
        /* best-effort */
      });

      redrawAll();
      onImageLoaded();
    };
    img.onerror = () => {
      addToast("Failed to load saved sketch", "error");
      onImageLoaded();
    };
    img.src = loadImageDataUrl;
  }, [loadImageDataUrl, onImageLoaded, redrawAll, addToast]);

  /* ── Listen for base-image changes from other devices ──── */
  useEffect(() => {
    const baseRef = ref(getDb(), "base-image");
    const unsub = onValue(baseRef, (snapshot) => {
      const dataUrl = snapshot.val() as string | null;
      if (!dataUrl) {
        baseImageRef.current = null;
        redrawAll();
        return;
      }
      // Don't reload if it's the same image we already have
      if (baseImageRef.current?.src === dataUrl) return;
      const img = new window.Image();
      img.onload = () => {
        baseImageRef.current = img;
        redrawAll();
      };
      img.src = dataUrl;
    });
    return () => unsub();
  }, [redrawAll]);

  /* ── Pointer Handlers ──────────────────────────────────── */

  const getCanvasPoint = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>): NormalizedPoint | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const { w, h } = logicalSize.current;
      return toNormalized(px, py, w, h);
    },
    []
  );

  const flushPointsToRTDB = useCallback(() => {
    if (!currentStrokeId.current) return;
    const pts = currentPoints.current;
    if (pts.length === 0) return;

    const isEraser = tool === "eraser";
    const { w } = logicalSize.current;
    const normalizedWidth = (isEraser ? thickness * 3 : thickness) / w;

    const strokeData: StrokeData = {
      points: [...pts],
      color: isEraser ? "#000000" : color,
      width: normalizedWidth,
      ...(isEraser ? { eraser: true } : {}),
    };

    const strokeRef = ref(getDb(), `${RTDB_PATH}/${currentStrokeId.current}`);
    set(strokeRef, strokeData).catch(() => {
      /* best-effort */
    });
  }, [color, thickness, tool]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      // Only handle primary button (left click / touch)
      if (e.button !== 0) return;
      e.preventDefault();

      isDrawing.current = true;

      // Create a new RTDB key for this stroke
      const strokesRef = ref(getDb(), RTDB_PATH);
      const newRef = push(strokesRef);
      currentStrokeId.current = newRef.key;
      currentPoints.current = [];

      const pt = getCanvasPoint(e);
      if (pt) {
        currentPoints.current.push(pt);
      }
    },
    [getCanvasPoint]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!isDrawing.current) return;
      e.preventDefault();

      const pt = getCanvasPoint(e);
      if (!pt) return;

      currentPoints.current.push(pt);

      // Draw locally for immediate feedback
      const ctx = ctxRef.current;
      const isEraser = tool === "eraser";
      if (ctx && currentPoints.current.length >= 2) {
        const { w, h } = logicalSize.current;
        const pts = currentPoints.current;
        const prev = fromNormalized(pts[pts.length - 2], w, h);
        const curr = fromNormalized(pts[pts.length - 1], w, h);

        ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
        ctx.beginPath();
        ctx.strokeStyle = isEraser ? "rgba(0,0,0,1)" : color;
        ctx.lineWidth = isEraser ? thickness * 3 : thickness;
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }

      // Throttled push to RTDB
      if (!throttleTimer.current) {
        throttleTimer.current = setTimeout(() => {
          flushPointsToRTDB();
          throttleTimer.current = null;
        }, THROTTLE_MS);
      }
    },
    [getCanvasPoint, color, thickness, flushPointsToRTDB, tool]
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!isDrawing.current) return;
      e.preventDefault();
      isDrawing.current = false;

      // Flush any remaining points
      if (throttleTimer.current) {
        clearTimeout(throttleTimer.current);
        throttleTimer.current = null;
      }
      flushPointsToRTDB();
      if (currentStrokeId.current) {
        localStrokeKeys.current.push(currentStrokeId.current);
        if (localStrokeKeys.current.length > 50) localStrokeKeys.current.shift();
        redoStack.current = []; // new stroke clears redo
      }
      currentStrokeId.current = null;
      currentPoints.current = [];
    },
    [flushPointsToRTDB]
  );

  const handlePointerLeave = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      // Treat pointer leaving the canvas the same as pointer up
      if (isDrawing.current) {
        handlePointerUp(e);
      }
    },
    [handlePointerUp]
  );

  /* ── Undo / Redo ──────────────────────────────────────── */
  const handleUndo = useCallback(async () => {
    const key = localStrokeKeys.current.pop();
    if (!key) return;
    const data = strokesMap.current.get(key);
    if (data) redoStack.current.push({ key, data });
    try { await remove(ref(getDb(), `${RTDB_PATH}/${key}`)); } catch { /* best-effort */ }
  }, []);

  const handleRedo = useCallback(async () => {
    const item = redoStack.current.pop();
    if (!item) return;
    localStrokeKeys.current.push(item.key);
    try { await set(ref(getDb(), `${RTDB_PATH}/${item.key}`), item.data); } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo]);

  /* ── Clear Canvas ──────────────────────────────────────── */
  const handleClear = useCallback(async () => {
    // Clear local state
    strokesMap.current.clear();
    baseImageRef.current = null;

    // Clear the canvas
    const ctx = ctxRef.current;
    if (ctx) {
      const { w, h } = logicalSize.current;
      ctx.clearRect(0, 0, w, h);
    }

    // Remove RTDB live-strokes node and base-image
    try {
      await remove(ref(getDb(), RTDB_PATH));
      await remove(ref(getDb(), "base-image"));
    } catch {
      addToast("Failed to sync clear across devices", "error");
    }
  }, [addToast]);

  /* ── Save to Firestore ─────────────────────────────────── */
  const handleSaveClick = useCallback(() => setShowSaveModal(true), []);

  const handleSaveWithName = useCallback(async (name: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      let dataUrl: string;
      const webpUrl = canvas.toDataURL("image/webp", 0.7);
      dataUrl = webpUrl.startsWith("data:image/webp") ? webpUrl : canvas.toDataURL("image/jpeg", 0.7);
      const approxBytes = dataUrl.length * 0.75;
      if (approxBytes > 900_000) {
        const lowQ = canvas.toDataURL("image/jpeg", 0.4);
        if (lowQ.length * 0.75 > 900_000) {
          addToast("Canvas too large to save", "error");
          setSaving(false);
          return;
        }
        dataUrl = lowQ;
      }
      await addDoc(collection(getFirestoreDb(), "sketches"), {
        name,
        imageDataUrl: dataUrl,
        createdAt: serverTimestamp(),
      });
      addToast(`"${name}" saved!`, "success");
      setShowSaveModal(false);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }, [addToast]);

  /* ── Thickness Controls ────────────────────────────────── */
  const decreaseThickness = useCallback(() => {
    setThicknessIdx((i) => Math.max(0, i - 1));
  }, []);

  const increaseThickness = useCallback(() => {
    setThicknessIdx((i) => Math.min(THICKNESS_OPTIONS.length - 1, i + 1));
  }, []);

  /* ── Preset Colors ─────────────────────────────────────── */
  const presetColors = [
    "#6c63ff", "#ef4444", "#f59e0b", "#10b981",
    "#3b82f6", "#ec4899", "#8b5cf6", "#f97316",
    "#06b6d4", "#ffffff", "#94a3b8", "#000000",
  ];

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-dvh w-dvw overflow-hidden bg-surface">
      {/* ─── Top Control Bar ─────────────────────────────── */}
      <header
        id="control-bar"
        className="flex items-center gap-2 px-3 py-2 bg-surface-elevated border-b border-border-subtle z-20 flex-shrink-0 flex-wrap"
      >
        {/* App Title */}
        <div className="flex items-center gap-1.5 mr-1">
          <Pen className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-text-primary hidden sm:inline">
            SketchSync
          </span>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-border-subtle hidden sm:block" />

        {/* Tool Selector: Pen / Eraser */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface">
          <button
            id="tool-pen"
            onClick={() => setTool("pen")}
            className={`p-1.5 rounded-md transition-colors ${tool === "pen" ? "bg-accent text-white" : "text-text-secondary hover:bg-surface-overlay"}`}
            title="Pen"
          >
            <Pen className="w-4 h-4" />
          </button>
          <button
            id="tool-eraser"
            onClick={() => setTool("eraser")}
            className={`p-1.5 rounded-md transition-colors ${tool === "eraser" ? "bg-accent text-white" : "text-text-secondary hover:bg-surface-overlay"}`}
            title="Eraser"
          >
            <Eraser className="w-4 h-4" />
          </button>
        </div>

        {/* Color Picker */}
        <div className="relative">
          <button
            id="color-picker-toggle"
            onClick={() => setShowColorPicker((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface hover:bg-surface-overlay transition-colors"
            title="Pick color"
          >
            <Palette className="w-4 h-4 text-text-secondary" />
            <div
              className="w-5 h-5 rounded-full border-2 border-border-subtle"
              style={{ backgroundColor: color }}
            />
          </button>

          {showColorPicker && (
            <div
              id="color-picker-dropdown"
              className="absolute top-full left-0 mt-2 p-3 bg-surface-elevated border border-border-subtle rounded-xl shadow-xl z-50 animate-fade-in"
            >
              <div className="grid grid-cols-4 gap-2 mb-3">
                {presetColors.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setColor(c);
                      setTool("pen");
                      setShowColorPicker(false);
                    }}
                    className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${
                      color === c
                        ? "border-accent ring-2 ring-accent-glow"
                        : "border-border-subtle"
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                Custom
                <input
                  type="color"
                  value={color}
                  onChange={(e) => {
                    setColor(e.target.value);
                    setTool("pen");
                  }}
                  className="w-8 h-6 cursor-pointer rounded border-none bg-transparent"
                />
              </label>
            </div>
          )}
        </div>

        {/* Stroke Thickness */}
        <div className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-surface">
          <button
            id="thickness-decrease"
            onClick={decreaseThickness}
            disabled={thicknessIdx === 0}
            className="p-1 rounded-md hover:bg-surface-overlay disabled:opacity-30 transition-colors"
            title="Thinner stroke"
          >
            <Minus className="w-3.5 h-3.5 text-text-secondary" />
          </button>
          <div className="flex items-center justify-center w-8">
            <div
              className="rounded-full bg-text-primary transition-all"
              style={{
                width: `${Math.max(4, thickness)}px`,
                height: `${Math.max(4, thickness)}px`,
              }}
            />
          </div>
          <button
            id="thickness-increase"
            onClick={increaseThickness}
            disabled={thicknessIdx === THICKNESS_OPTIONS.length - 1}
            className="p-1 rounded-md hover:bg-surface-overlay disabled:opacity-30 transition-colors"
            title="Thicker stroke"
          >
            <Plus className="w-3.5 h-3.5 text-text-secondary" />
          </button>
        </div>

        {/* Background Selector */}
        <div className="relative">
          <button
            id="bg-picker-toggle"
            onClick={() => setShowBgPicker((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface hover:bg-surface-overlay transition-colors text-xs font-medium text-text-secondary"
            title="Choose canvas background pattern"
          >
            <LayoutGrid className="w-4 h-4 text-text-secondary" />
            <span className="hidden md:inline">{BG_OPTIONS.find((b) => b.key === bgKey)?.label}</span>
          </button>

          {showBgPicker && (
            <div
              id="bg-picker-dropdown"
              className="absolute top-full left-0 mt-2 p-2 bg-surface-elevated border border-border-subtle rounded-xl shadow-xl z-50 animate-fade-in flex flex-col gap-1 min-w-[140px]"
            >
              <div className="text-[11px] font-semibold text-text-muted px-2 py-1">
                Background Pattern
              </div>
              {BG_OPTIONS.map((bg) => (
                <button
                  key={bg.key}
                  onClick={() => {
                    setBgKey(bg.key);
                    setShowBgPicker(false);
                  }}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    bgKey === bg.key
                      ? "bg-accent/15 text-accent font-medium"
                      : "text-text-secondary hover:bg-surface-overlay"
                  }`}
                >
                  <span
                    className="w-3.5 h-3.5 rounded border border-border-subtle flex-shrink-0"
                    style={{ backgroundColor: bg.preview }}
                  />
                  {bg.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1 min-w-0" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5">
          <button id="undo-button" onClick={handleUndo} className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-overlay transition-colors" title="Undo (Ctrl+Z)">
            <Undo2 className="w-4 h-4" />
          </button>
          <button id="redo-button" onClick={handleRedo} className="p-1.5 rounded-lg text-text-secondary hover:bg-surface-overlay transition-colors" title="Redo (Ctrl+Y)">
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        {/* Clear */}
        <button
          id="clear-canvas-button"
          onClick={handleClear}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-danger hover:bg-danger/10 transition-colors"
          title="Clear canvas"
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden sm:inline">Clear</span>
        </button>

        {/* Save */}
        <button
          id="save-button"
          onClick={handleSaveClick}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-60 transition-colors"
          title="Save sketch"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">{saving ? "Saving…" : "Save"}</span>
        </button>

        {/* Gallery */}
        <button
          id="gallery-button"
          onClick={onOpenGallery}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-surface hover:bg-surface-overlay border border-border-subtle transition-colors"
          title="My Sketches"
        >
          <ImageIcon className="w-4 h-4 text-text-secondary" />
          <span className="hidden sm:inline">Gallery</span>
        </button>
      </header>

      {/* ─── Canvas Container (scrollable) ────────────────── */}
      <div ref={containerRef} className={`flex-1 relative overflow-y-auto overflow-x-hidden custom-scrollbar ${BG_OPTIONS.find(b => b.key === bgKey)!.css}`}>
        <div style={{ minHeight: `${pages * PAGE_HEIGHT_PX}px`, position: "relative" }}>
          <canvas
            ref={canvasRef}
            id="sketch-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            className={tool === "eraser" ? "cursor-eraser" : "cursor-pen"}
          />
        </div>
        {/* Add Page button at bottom */}
        <button
          id="add-page-button"
          onClick={() => setPages(p => p + 1)}
          className="sticky bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium bg-surface-elevated/90 text-text-secondary hover:text-accent border border-border-subtle shadow-lg backdrop-blur-sm transition-colors z-10"
        >
          <Plus className="w-3.5 h-3.5" /> Add Page
        </button>
      </div>

      {/* ─── Toasts ──────────────────────────────────────── */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg animate-toast-in pointer-events-auto ${
              toast.kind === "success"
                ? "bg-success/90 text-white"
                : "bg-danger/90 text-white"
            }`}
          >
            {toast.kind === "success" ? (
              <Check className="w-4 h-4" />
            ) : (
              <X className="w-4 h-4" />
            )}
            {toast.message}
          </div>
        ))}
      </div>

      {/* ─── Close Color Picker on Outside Click ─────────── */}
      {showColorPicker && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowColorPicker(false)}
        />
      )}
      {showBgPicker && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowBgPicker(false)}
        />
      )}

      {/* ─── Save Modal ──────────────────────────────────── */}
      <SaveModal
        open={showSaveModal}
        saving={saving}
        onSave={handleSaveWithName}
        onCancel={() => setShowSaveModal(false)}
      />
    </div>
  );
}
