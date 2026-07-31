import { redirect } from "next/navigation";

/** The scoring page became the Decision Policy section of the control plane. */
export default function AdminScoringRedirect() {
  redirect("/admin/policy");
}
