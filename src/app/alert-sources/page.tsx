import { redirect } from "next/navigation";

export default function AlertSourcesPage() {
  redirect("/settings?tab=alerts");
}
