import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { MIRROR_MODEL_ID, MIRROR_RESOLUTION, sessionMinStartMc, sessionPricePerSecondMc } from "@/lib/pricing";
import LiveTabs from "@/components/LiveTabs";
import Mirror from "./Mirror";

export const metadata: Metadata = { title: "Live Mirror · AI Movie Director" };

export default async function MirrorPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <main className="container">
      <LiveTabs active="mirror" />
      <Mirror
        perSecondMc={sessionPricePerSecondMc(MIRROR_MODEL_ID, MIRROR_RESOLUTION)}
        minStartMc={sessionMinStartMc(MIRROR_MODEL_ID, MIRROR_RESOLUTION)}
        initialBalanceMc={user.balanceMc}
      />
    </main>
  );
}
