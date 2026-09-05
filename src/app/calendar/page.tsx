import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";

import ReaderShell from "@/components/app-shell/ReaderShell";
import NewsletterViewerPanel from "@/components/panels/NewsletterViewerPanel";
import { isNewspaperPublic } from "@/lib/auth/public-newspaper";
import { PRODUCT_NAME } from "@/lib/branding";
import { getMasthead, getPoweredBy, getSourceRepoLink, getTagline } from "@/lib/masthead";
import { buildEditionMetadata, resolveSiteUrl } from "@/lib/reader/edition-meta";
import { resolveEditionDate } from "@/lib/reader/edition-nav";

type CalendarPageProps = { searchParams?: { date?: string | string[] } };

export async function generateMetadata({ searchParams }: CalendarPageProps): Promise<Metadata> {
  return buildEditionMetadata({
    masthead: getMasthead(),
    tagline: getTagline(),
    date: resolveEditionDate(searchParams?.date),
    siteUrl: resolveSiteUrl(),
  });
}

export default function CalendarPage({ searchParams }: CalendarPageProps) {
  noStore();
  const masthead = getMasthead();
  const editionDate = resolveEditionDate(searchParams?.date);

  return (
    <ReaderShell
      title={masthead}
      description={getTagline()}
      productName={PRODUCT_NAME}
      editionDate={editionDate}
      accessLabel={isNewspaperPublic() ? "公開閲覧" : "共有閲覧モード"}
      poweredBy={getPoweredBy()}
      sourceRepo={getSourceRepoLink()}
    >
      <NewsletterViewerPanel masthead={masthead} />
    </ReaderShell>
  );
}
