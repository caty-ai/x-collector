"use client";

import React, { useEffect, useRef, useState } from "react";

export function ArticleThumbnail({ src }: { src: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // React 18 does not replay image errors that happen before hydration.
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return null;

  return (
    <div className="mt-5 aspect-[1200/630] w-full overflow-hidden border border-hairline bg-paper">
      <img ref={imgRef} src={src} alt="" decoding="async" referrerPolicy="no-referrer"
        className="h-full w-full object-cover" onError={() => setFailed(true)} />
    </div>
  );
}
