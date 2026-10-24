import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { publicJob } from "@/lib/jobs";
import { markupPercent } from "@/lib/pricing";
import Playground from "./Playground";

export const metadata: Metadata = { title: "Create · AI Movie Director" };

export default async function CreatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const jobs = user ? await db.job.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 12 }) : [];
  // Results sent here from My creations arrive as ?tool=<id>&<field>=<url>.
  const media = Object.fromEntries(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string" && e[0] !== "tool"));

  return (
    <main className="container">
      <Playground
        markup={markupPercent}
        signedIn={!!user}
        initialBalanceMc={user?.balanceMc ?? 0}
        initialJobs={jobs.map(publicJob)}
        initialToolId={typeof params.tool === "string" ? params.tool : undefined}
        initialMedia={media}
      />
    </main>
  );
}
