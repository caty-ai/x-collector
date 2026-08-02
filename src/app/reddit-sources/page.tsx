import { redirect } from "next/navigation";

export default function RedditSourcesPage() {
  redirect("/settings?tab=reddit");
}
