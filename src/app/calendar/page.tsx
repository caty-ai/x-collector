import { unstable_noStore as noStore } from "next/cache";

import ReaderShell from "@/components/app-shell/ReaderShell";
import NewsletterViewerPanel from "@/components/panels/NewsletterViewerPanel";
import { PRODUCT_NAME } from "@/lib/branding";
import { getMasthead } from "@/lib/masthead";

export default function CalendarPage() {
  noStore();
  const masthead = getMasthead();

  return (
    <ReaderShell
      title={masthead}
      description="BFF経由で日付指定のeditionを取得し、Markdownを安全に表示します（404は空日扱い）。"
      productName={PRODUCT_NAME}
    >
      <NewsletterViewerPanel masthead={masthead} />
    </ReaderShell>
  );
}
