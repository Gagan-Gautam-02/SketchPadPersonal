"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  deleteDoc,
  doc,
  type QueryDocumentSnapshot,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { getFirestoreDb } from "@/app/lib/firebase";
import {
  X,
  Trash2,
  Loader2,
  ImageIcon,
  ChevronDown,
  Clock,
} from "lucide-react";

/* ─── Types ──────────────────────────────────────────────── */

interface SketchDoc {
  id: string;
  imageDataUrl: string;
  createdAt: Timestamp | null;
}

interface SketchGalleryProps {
  open: boolean;
  onClose: () => void;
  onSelectSketch: (dataUrl: string) => void;
}

const PAGE_SIZE = 20;

/* ─── Time-ago helper ────────────────────────────────────── */

function timeAgo(ts: Timestamp | null): string {
  if (!ts) return "Just now";
  const now = Date.now();
  const then = ts.toMillis();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/* ─── Component ──────────────────────────────────────────── */

export default function SketchGallery({
  open,
  onClose,
  onSelectSketch,
}: SketchGalleryProps) {
  const [sketches, setSketches] = useState<SketchDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);

  /* ── Fetch sketches ────────────────────────────────────── */
  const fetchSketches = useCallback(
    async (after?: QueryDocumentSnapshot<DocumentData>) => {
      setLoading(true);
      try {
        const sketchesCol = collection(getFirestoreDb(), "sketches");
        const q = after
          ? query(
              sketchesCol,
              orderBy("createdAt", "desc"),
              startAfter(after),
              limit(PAGE_SIZE)
            )
          : query(
              sketchesCol,
              orderBy("createdAt", "desc"),
              limit(PAGE_SIZE)
            );
        const snapshot = await getDocs(q);

        const docs: SketchDoc[] = snapshot.docs.map((d) => ({
          id: d.id,
          imageDataUrl: d.data().imageDataUrl as string,
          createdAt: (d.data().createdAt as Timestamp) || null,
        }));

        if (after) {
          setSketches((prev) => [...prev, ...docs]);
        } else {
          setSketches(docs);
        }

        const lastVisible = snapshot.docs[snapshot.docs.length - 1] ?? null;
        setLastDoc(lastVisible);
        setHasMore(snapshot.docs.length === PAGE_SIZE);
      } catch (err: unknown) {
        console.error("Failed to fetch sketches:", err);
      } finally {
        setLoading(false);
        setInitialLoad(false);
      }
    },
    []
  );

  /* ── Load on open ──────────────────────────────────────── */
  useEffect(() => {
    if (open) {
      setInitialLoad(true);
      setSketches([]);
      setLastDoc(null);
      setHasMore(false);
      fetchSketches();
    }
  }, [open, fetchSketches]);

  /* ── Load more ─────────────────────────────────────────── */
  const handleLoadMore = useCallback(() => {
    if (lastDoc) fetchSketches(lastDoc);
  }, [lastDoc, fetchSketches]);

  /* ── Delete ────────────────────────────────────────────── */
  const handleDelete = useCallback(
    async (sketchId: string) => {
      setDeletingId(sketchId);
      try {
        await deleteDoc(doc(getFirestoreDb(), "sketches", sketchId));
        setSketches((prev) => prev.filter((s) => s.id !== sketchId));
      } catch (err: unknown) {
        console.error("Failed to delete sketch:", err);
      } finally {
        setDeletingId(null);
      }
    },
    []
  );

  /* ── Don't render when closed ──────────────────────────── */
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        id="sketch-gallery"
        className="fixed top-0 right-0 h-full w-full max-w-md bg-surface-elevated border-l border-border-subtle z-50 flex flex-col animate-slide-in shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-text-primary">
              My Sketches
            </h2>
          </div>
          <button
            id="close-gallery-button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-overlay transition-colors"
            title="Close gallery"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          {initialLoad && loading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <Loader2 className="w-8 h-8 text-accent animate-spin" />
              <span className="text-sm text-text-muted">Loading sketches…</span>
            </div>
          ) : sketches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <ImageIcon className="w-12 h-12 text-text-muted" />
              <p className="text-sm text-text-muted text-center">
                No saved sketches yet.
                <br />
                Draw something and hit Save!
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {sketches.map((sketch) => (
                  <div
                    key={sketch.id}
                    className="group relative bg-surface rounded-xl border border-border-subtle overflow-hidden hover:border-accent/50 transition-colors animate-fade-in"
                  >
                    {/* Thumbnail */}
                    <button
                      id={`sketch-thumb-${sketch.id}`}
                      onClick={() => {
                        onSelectSketch(sketch.imageDataUrl);
                        onClose();
                      }}
                      className="w-full aspect-[4/3] bg-surface-overlay flex items-center justify-center cursor-pointer"
                      title="Load onto canvas"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={sketch.imageDataUrl}
                        alt="Saved sketch"
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                    </button>

                    {/* Info / Actions */}
                    <div className="flex items-center justify-between px-2.5 py-2">
                      <span className="flex items-center gap-1 text-xs text-text-muted truncate">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        {timeAgo(sketch.createdAt)}
                      </span>
                      <button
                        id={`delete-sketch-${sketch.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(sketch.id);
                        }}
                        disabled={deletingId === sketch.id}
                        className="p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                        title="Delete sketch"
                      >
                        {deletingId === sketch.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Load More */}
              {hasMore && (
                <div className="flex justify-center mt-4">
                  <button
                    id="load-more-button"
                    onClick={handleLoadMore}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                    Load more
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
