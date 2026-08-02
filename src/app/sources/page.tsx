import { redirect } from "next/navigation";

type SourcesPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function toSearchString(searchParams: SourcesPageProps["searchParams"]): string {
  if (!searchParams) return "";

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry));
      continue;
    }

    params.set(key, value);
  }

  if (!params.has("tab")) {
    params.set("tab", "twitter");
  }

  return params.toString();
}

export default function SourcesPage({ searchParams }: SourcesPageProps) {
  const query = toSearchString(searchParams);
  redirect(query ? `/settings?${query}` : "/settings");
}
