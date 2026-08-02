import { Eyebrow } from "@/components/ui/Eyebrow";
import { Headline } from "@/components/ui/Headline";
import { Rule } from "@/components/ui/Rule";

type ReaderShellProps = {
  title: string;
  description: string;
  productName: string;
  children?: React.ReactNode;
};

export default function ReaderShell({ title, description, productName, children }: ReaderShellProps) {
  const dateLabel = new Intl.DateTimeFormat("ja-JP-u-ca-japanese", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col">
        <header className="bg-paper">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
            <div className="flex flex-wrap items-center gap-5">
              <Eyebrow>{productName}</Eyebrow>
              <span className="border border-ink px-3 py-1 font-sans text-wired-eyebrow font-bold uppercase text-ink">
                共有閲覧モード
              </span>
            </div>
            <span className="font-sans text-wired-meta text-ink/60">{dateLabel}</span>
          </div>

          <div className="px-5 py-8 text-center md:py-12">
            <Headline level="hero" as="h1" className="break-words text-center">
              {title}
            </Headline>
            <p className="mx-auto mt-3 max-w-3xl font-sans text-wired-eyebrow font-bold uppercase text-ink">
              {description}
            </p>

            <div className="mx-auto mt-6 max-w-4xl">
              <Rule />
              <div className="flex flex-wrap items-center justify-center gap-4 px-2 py-3 font-sans text-wired-eyebrow font-bold uppercase text-ink">
                <span className="border border-ink bg-paper px-3 py-2 text-ink/60">
                  前日
                </span>
                <a href="#reader-calendar" className="border-b border-ink pb-1">
                  カレンダー
                </a>
                <span className="border border-ink bg-paper px-3 py-2 text-ink/60">
                  翌日
                </span>
              </div>
              <Rule className="bg-ink" />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 lg:px-8">{children}</main>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-5 py-5 font-sans text-wired-meta text-ink/60">
          <span>{title} / 共有閲覧モード</span>
          <span className="border border-ink px-3 py-1 font-sans text-wired-eyebrow font-bold uppercase text-ink">
            {title}
          </span>
        </footer>
      </div>
    </div>
  );
}
