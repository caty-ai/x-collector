import { unstable_noStore as noStore } from "next/cache";

import StudioAppShellClient from "@/components/app-shell/StudioAppShellClient";
import { PRODUCT_NAME, PRODUCT_SLUG } from "@/lib/branding";
import { getMasthead } from "@/lib/masthead";

type StudioAppShellProps = {
  title: string;
  description: string;
  children?: React.ReactNode;
};

export default function StudioAppShell(props: StudioAppShellProps) {
  noStore();
  return (
    <StudioAppShellClient
      {...props}
      masthead={getMasthead()}
      productName={PRODUCT_NAME}
      productSlug={PRODUCT_SLUG}
    />
  );
}
