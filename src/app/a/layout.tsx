import React from "react";
import type { Metadata } from "next";
import { getMasthead, getTagline } from "@/lib/masthead";
import { ArticleBrandProvider } from "@/components/reader/ArticleBrandProvider";

export function generateMetadata(): Metadata {
  return { title: getMasthead(), description: getTagline() };
}

export default function ArticleLayout({ children }: { children: React.ReactNode }) {
  return <ArticleBrandProvider masthead={getMasthead()}>{children}</ArticleBrandProvider>;
}
