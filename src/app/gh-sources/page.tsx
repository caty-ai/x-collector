import { redirect } from "next/navigation";

export default function GhSourcesPage() {
  redirect("/settings?tab=github");
}
