"use client";

import React, { useState, useRef, useEffect } from "react";
import { Save, X, Loader2 } from "lucide-react";

interface SaveModalProps {
  open: boolean;
  saving: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}

export default function SaveModal({ open, saving, onSave, onCancel }: SaveModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim() || `Sketch ${new Date().toLocaleDateString()}`;
    onSave(trimmed);
  };

  return (
    <>
      <div className="fixed inset-0 modal-backdrop z-50" onClick={onCancel} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="bg-surface-elevated border border-border-subtle rounded-2xl shadow-2xl p-6 w-full max-w-sm pointer-events-auto animate-scale-in">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Save className="w-5 h-5 text-accent" />
              Save Sketch
            </h3>
            <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-surface-overlay transition-colors">
              <X className="w-4 h-4 text-text-secondary" />
            </button>
          </div>
          <form onSubmit={handleSubmit}>
            <label className="block text-sm text-text-secondary mb-1.5">Sketch Name</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Math Ch.5, Physics Notes..."
              className="w-full px-3 py-2.5 rounded-xl bg-surface border border-border-subtle text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent-glow transition-colors"
              disabled={saving}
            />
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={onCancel}
                disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-text-secondary bg-surface hover:bg-surface-overlay border border-border-subtle transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-60 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
