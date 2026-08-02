import { redirect } from "next/navigation";

export default function IgSourcesPage() {
  redirect("/settings?tab=instagram");
}
