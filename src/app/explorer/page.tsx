import StudioAppShell from "@/components/app-shell/StudioAppShell";
import ExplorerFeedPanel from "@/components/panels/ExplorerFeedPanel";

export default function ExplorerPage() {
  return (
    <StudioAppShell
      title="Explorer"
      description="BFF feed connectivity check with typed contract parsing (Issue #12 scope)."
    >
      <ExplorerFeedPanel />
    </StudioAppShell>
  );
}
