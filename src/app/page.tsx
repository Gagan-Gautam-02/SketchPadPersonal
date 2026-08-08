"use client";

import { useState, useCallback } from "react";
import Sketchpad from "@/components/Sketchpad";
import SketchGallery from "@/components/SketchGallery";

export default function Page() {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [loadImageUrl, setLoadImageUrl] = useState<string | null>(null);

  const handleOpenGallery = useCallback(() => setGalleryOpen(true), []);
  const handleCloseGallery = useCallback(() => setGalleryOpen(false), []);

  const handleSelectSketch = useCallback((dataUrl: string) => {
    setLoadImageUrl(dataUrl);
  }, []);

  const handleImageLoaded = useCallback(() => {
    setLoadImageUrl(null);
  }, []);

  return (
    <main id="app-root">
      <Sketchpad
        onOpenGallery={handleOpenGallery}
        loadImageDataUrl={loadImageUrl}
        onImageLoaded={handleImageLoaded}
      />
      <SketchGallery
        open={galleryOpen}
        onClose={handleCloseGallery}
        onSelectSketch={handleSelectSketch}
      />
    </main>
  );
}
