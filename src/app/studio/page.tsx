import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { MODEL_ID, RESOLUTIONS, minStartBalanceMc, pricePerSecondMc } from "@/lib/pricing";
import LiveTabs from "@/components/LiveTabs";
import Studio from "./Studio";

export default async function StudioPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const prices = Object.fromEntries(
    RESOLUTIONS.map((r) => [r, { perSecondMc: pricePerSecondMc(r), minStartMc: minStartBalanceMc(r) }]),
  );
  return (
    <main className="container">
      <LiveTabs active="movie" />
      <Studio modelId={MODEL_ID} initialBalanceMc={user.balanceMc} prices={prices} />
    </main>
  );
}
