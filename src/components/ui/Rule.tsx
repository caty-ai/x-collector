type RuleProps = {
  className?: string;
};

export function Rule({ className }: RuleProps) {
  const classes = ["h-px w-full border-0 bg-hairline", className]
    .filter(Boolean)
    .join(" ");

  return <hr className={classes} />;
}
