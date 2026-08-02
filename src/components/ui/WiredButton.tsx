import type { ButtonHTMLAttributes, ReactNode } from "react";

type WiredButtonVariant = "primary" | "outline";
type WiredButtonSize = "md" | "compact";

type WiredButtonProps = {
  variant?: WiredButtonVariant;
  size?: WiredButtonSize;
  children: ReactNode;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

const variantClassName: Record<WiredButtonVariant, string> = {
  primary: "border border-ink bg-ink text-paper",
  outline: "border border-ink bg-paper text-ink",
};

const sizeClassName: Record<WiredButtonSize, string> = {
  md: "min-h-11 px-5 py-3",
  compact: "min-h-9 px-3 py-1.5",
};

export function WiredButton({
  variant = "primary",
  size = "md",
  children,
  className,
  type = "button",
  ...props
}: WiredButtonProps) {
  const classes = [
    `inline-flex ${sizeClassName[size]} items-center justify-center rounded-none font-sans text-wired-button-md font-bold uppercase`,
    variantClassName[variant],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
