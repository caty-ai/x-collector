import { formatUtcToJstDateTime } from "@/lib/date-formatter";

type PlaceholderRouteContentProps = {
  routePath: string;
  notes: string[];
};

export default function PlaceholderRouteContent({ routePath, notes }: PlaceholderRouteContentProps) {
  const generatedAt = formatUtcToJstDateTime(new Date());

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-sm font-medium">Route placeholder</p>
        <p className="mt-1 text-sm text-muted-foreground">{routePath}</p>
      </div>

      <div className="rounded-lg border border-dashed border-border bg-background p-4">
        <p className="text-sm font-medium">Next implementation notes</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">Generated at (UTC→JST): {generatedAt}</p>
    </div>
  );
}
