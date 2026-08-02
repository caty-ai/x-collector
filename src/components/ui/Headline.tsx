import type { ElementType, ReactNode } from "react";

type HeadlineLevel = "hero" | "lg" | "md" | "sm";

type HeadlineProps = {
  level: HeadlineLevel;
  as?: keyof JSX.IntrinsicElements;
  className?: string;
  children: ReactNode;
};

const levelClassName: Record<HeadlineLevel, string> = {
  hero: "text-wired-display-hero",
  lg: "text-wired-display-lg",
  md: "text-wired-display-md",
  sm: "text-wired-display-sm",
};

export function Headline({
  level,
  as,
  className,
  children,
}: HeadlineProps) {
  const Component = (as ?? "h2") as ElementType;
  const classes = [
    "font-wired-serif font-normal text-ink",
    levelClassName[level],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <Component className={classes}>{children}</Component>;
}
