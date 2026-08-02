import { redirect } from "next/navigation";

export default function CandidatesPage() {
  redirect("/settings?tab=candidates");
}
