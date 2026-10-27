import Link from "next/link";

/** Switches between the two live modes. */
export default function LiveTabs({ active }: { active: "movie" | "mirror" }) {
  return (
    <div className="live-tabs" role="tablist" aria-label="Live mode">
      <Link href="/studio" className={active === "movie" ? "on" : ""} role="tab" aria-selected={active === "movie"}>
        <b>Live movie</b>
        <span>Direct a film from words and photos</span>
      </Link>
      <Link href="/mirror" className={active === "mirror" ? "on" : ""} role="tab" aria-selected={active === "mirror"}>
        <b>Live Mirror <em>New</em></b>
        <span>Restyle your webcam or a video in real time</span>
      </Link>
    </div>
  );
}
