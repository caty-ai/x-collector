import { redirect } from "next/navigation";

export default function QiitaSourcesPage() {
  redirect("/settings?tab=qiita");
}
