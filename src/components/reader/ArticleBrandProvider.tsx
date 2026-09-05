"use client";

import React, { createContext } from "react";

export const ArticleBrandContext = createContext("");

// The server layout supplies env-driven branding to the client error boundary.
export function ArticleBrandProvider({ masthead, children }: { masthead: string; children: React.ReactNode }) {
  return <ArticleBrandContext.Provider value={masthead}>{children}</ArticleBrandContext.Provider>;
}
