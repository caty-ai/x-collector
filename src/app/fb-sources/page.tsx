import { redirect } from "next/navigation";

export default function FbSourcesPage() {
  redirect("/settings?tab=facebook");
}
