import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { MIRROR_MODEL_ID, MIRROR_RESOLUTION, formatUsd, markupPercent, priceTable, sessionPricePerSecondMc } from "@/lib/pricing";
import { GOALS, TOOLS, typicalPriceMc } from "@/lib/tools";
import { TOP_UP_AMOUNTS_USD } from "@/lib/stripe";
import HeroReel from "@/components/landing/HeroReel";
import LoopVideo from "@/components/landing/LoopVideo";
import DirectionDemo from "@/components/landing/DirectionDemo";
import { CLIPS, poster } from "@/components/landing/media";

const FEATURES = [
  {
    title: "Talk to your movie",
    body: "Type or speak what should happen next. Your direction appears on screen within seconds, while the film keeps rolling.",
    icon: "M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Zm7 9a7 7 0 0 1-14 0m7 7v4",
  },
  {
    title: "Same faces, every shot",
    body: "Upload up to 9 photos of people, places or props and name them. They keep their face, hair and outfit throughout.",
    icon: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21a8 8 0 0 1 16 0",
  },
  {
    title: "Cinema quality",
    body: "Up to 1440p at 24 frames per second, with natural sound, music and dialogue generated along with the picture.",
    icon: "M3 5h18v14H3zM7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4",
  },
  {
    title: "Plan beats ahead",
    body: "Write a script with timed beats, like “at 0:30 the storm hits”, and the scene follows it automatically.",
    icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  },
  {
    title: "Keep your movie",
    body: "Every take is recorded in your browser. Download it when you stop and share it anywhere.",
    icon: "M12 3v12m0 0-4-4m4 4 4-4M4 21h16",
  },
  {
    title: "Pay per second",
    body: "No subscription. Top up credit and only pay for the seconds you actually film. You see the cost live.",
    icon: "M12 6v12m3-9.5c0-1.4-1.3-2.5-3-2.5s-3 1.1-3 2.5 1.3 2 3 2.5 3 1.1 3 2.5-1.3 2.5-3 2.5-3-1.1-3-2.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  },
];

const FAQ = [
  {
    q: "Is it really live?",
    a: "Yes. The film is generated in real time and streamed to your browser at 24 frames per second. You can change the story at any moment and the next shot follows your direction.",
  },
  {
    q: "Do I need any skills or software?",
    a: "No. Everything runs in the browser. Pick an example or describe your own scene in plain words, press Connect, and start directing.",
  },
  {
    q: "How much does a movie cost?",
    a: "It depends on the tool. Quick clips and images cost a few cents, a cast scene is about 10 to 50 cents, and the live studio is billed per second (from about $4 a minute). You always see the price before you start, and failed generations are refunded.",
  },
  {
    q: "Can I use my own characters?",
    a: "Yes. Upload photos of people, pets, places or objects and give each a name. Mention the names in your scene and the AI keeps them consistent.",
  },
  {
    q: "Can I download what I make?",
    a: "Yes. Each take is recorded as you watch, and you can download it as a video file when the session ends.",
  },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export default async function Home() {
  const user = await getCurrentUser();
  const startHref = user ? "/studio" : "/signup";
  const prices = priceTable();
  const perMin = (r: string) => prices.find((p) => p.resolution === r)!.perMinuteUsd.toFixed(2);

  return (
    <main className="lp">
      {/* ------------------------------------------------------------------ Hero */}
      <section className="lp-hero">
        <HeroReel />
        <div className="lp-hero-inner">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow"><span className="lp-rec" /> Live AI filmmaking</span>
            <h1>
              Type a scene.<br />
              <em>Watch it become a movie.</em>
            </h1>
            <p>
              AI Movie Director turns your words and photos into a cinematic film that plays live, and lets
              you change what happens next while it’s rolling. Just type or say it.
            </p>
            <div className="lp-cta-row">
              <Link href={startHref} className="lp-btn primary">Start directing</Link>
              <Link href="/create" className="lp-btn ghost">Explore all tools</Link>
            </div>
            <ul className="lp-proof">
              <li>Up to 1440p</li>
              <li>24 fps with sound</li>
              <li>Characters stay consistent</li>
              <li>Pay per second</li>
            </ul>
          </div>
          <div className="lp-hero-demo">
            <DirectionDemo />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ How it works */}
      <section className="lp-section" id="how">
        <div className="lp-head">
          <span className="lp-kicker">How it works</span>
          <h2>From an idea to a moving picture in three steps</h2>
        </div>

        <div className="lp-steps">
          <article className="lp-step">
            <div className="lp-step-visual cast">
              {[["nora", "Nora"], ["milo", "Milo"]].map(([id, name]) => (
                <figure key={id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/media/${id}.jpg`} alt={`Reference photo for ${name}`} loading="lazy" />
                  <figcaption>{name}</figcaption>
                </figure>
              ))}
            </div>
            <span className="lp-step-num">1</span>
            <h3>Cast your characters</h3>
            <p>Upload photos of your people, places or props and name them. They look the same in every shot.</p>
          </article>

          <article className="lp-step">
            <div className="lp-step-visual scene" style={{ backgroundImage: `url(${poster("harbor")})` }}>
              <div className="lp-prompt-card">
                <span className="lp-chip">Cinema</span>
                <p>
                  Photorealistic, golden hour. <b>Nora</b> and <b>Milo</b> race along a misty harbor toward a
                  ferry that’s pulling away…
                </p>
              </div>
            </div>
            <span className="lp-step-num">2</span>
            <h3>Describe the scene</h3>
            <p>Write the story and style in plain words, or start from one of the ready-made examples.</p>
          </article>

          <article className="lp-step">
            <div className="lp-step-visual live">
              <LoopVideo id="harbor" />
              <span className="lp-live-badge"><span className="lp-rec" /> LIVE</span>
              <div className="lp-step-demo"><DirectionDemo compact /></div>
            </div>
            <span className="lp-step-num">3</span>
            <h3>Direct it live</h3>
            <p>Press Connect and the film starts. Type or speak what happens next and watch the story change.</p>
          </article>
        </div>
      </section>

      {/* ------------------------------------------------------------------ Tools */}
      <section className="lp-section" id="tools">
        <div className="lp-head">
          <span className="lp-kicker">Create</span>
          <h2>A tool for every idea and every budget</h2>
          <p className="lp-sub">
            From a few cents for a quick test to cinema-grade shots. Pick Budget, Standard or Premium and see the price
            before you generate.
          </p>
        </div>
        <div className="lp-tools">
          <Link href={user ? "/director" : "/signup"} className="lp-tool lp-tool-director">
            <span className="lp-feature-icon"><Icon d="M13 2 4 14h7l-1 8 9-12h-7z" /></span>
            <h3>AI Director</h3>
            <p>Just describe your idea. It picks the tools, asks for your photos, shows the price, makes it and checks the result.</p>
            <span className="lp-tool-from">Powered by Claude Opus 5.5 · usually 5–30¢ per message</span>
          </Link>
          <Link href={user ? "/mirror" : "/signup"} className="lp-tool">
            <span className="lp-feature-icon"><Icon d="M15 10l5-3v10l-5-3M3 6h12v12H3z" /></span>
            <h3>Live Mirror</h3>
            <p>Your webcam or any video, redrawn live as anime, Pixar 3D, claymation, comic book and more. Change the look by voice.</p>
            <span className="lp-tool-from">New · about {formatUsd(sessionPricePerSecondMc(MIRROR_MODEL_ID, MIRROR_RESOLUTION) * 60)} per minute</span>
          </Link>
          {GOALS.map((goal) => {
            const tools = TOOLS.filter((t) => t.goal === goal.id);
            const from = Math.min(...tools.map((t) => typicalPriceMc(t, markupPercent)));
            return (
              <Link key={goal.id} href={`/create?tool=${tools[0].id}`} className="lp-tool">
                <span className="lp-feature-icon"><Icon d={goal.icon} /></span>
                <h3>{goal.title}</h3>
                <p>{goal.description}</p>
                <span className="lp-tool-from">{tools.length} tools · from about {formatUsd(from)}</span>
              </Link>
            );
          })}
        </div>
        <p className="lp-topups"><Link href="/guide">Read the guide: make a 1-minute short film for about $5 →</Link></p>
      </section>

      {/* ------------------------------------------------------------------ Gallery */}
      <section className="lp-section lp-gallery-section">
        <div className="lp-head">
          <span className="lp-kicker">Any genre, any style</span>
          <h2>If you can describe it, you can direct it</h2>
          <p className="lp-sub">Live action, animation, noir, sci-fi or westerns. One sentence sets the look.</p>
        </div>
        <div className="lp-gallery">
          {CLIPS.map((clip) => (
            <figure key={clip.id} className="lp-tile">
              <LoopVideo id={clip.id} />
              <figcaption>
                <span className="lp-chip light">{clip.genre}</span>
                <b>{clip.title}</b>
                <span>“{clip.prompt}”</span>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="lp-note">Example scenes generated with AI.</p>
      </section>

      {/* ------------------------------------------------------------------ Features */}
      <section className="lp-section">
        <div className="lp-head">
          <span className="lp-kicker">Why it’s different</span>
          <h2>You’re the director, not a prompt typist</h2>
        </div>
        <div className="lp-features">
          {FEATURES.map((f) => (
            <div className="lp-feature" key={f.title}>
              <span className="lp-feature-icon"><Icon d={f.icon} /></span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ Pricing */}
      <section className="lp-section" id="pricing">
        <div className="lp-head">
          <span className="lp-kicker">Pricing</span>
          <h2>Pay only for what you film</h2>
          <p className="lp-sub">No subscription. Top up credit and spend it by the second.</p>
        </div>
        <div className="lp-prices">
          <div className="lp-price">
            <h3>Standard</h3>
            <span className="lp-res">480p</span>
            <p className="lp-amount">${perMin("480p")}<small>/min</small></p>
            <p>Great for sketching ideas and trying out stories.</p>
          </div>
          <div className="lp-price featured">
            <span className="lp-badge">Most popular</span>
            <h3>HD</h3>
            <span className="lp-res">768p</span>
            <p className="lp-amount">${perMin("768p")}<small>/min</small></p>
            <p>Sharp, cinematic picture for sharing your movies.</p>
          </div>
          <div className="lp-price">
            <h3>Full HD &amp; 2K</h3>
            <span className="lp-res">1080p · 1440p</span>
            <p className="lp-amount">${perMin("1440p")}<small>/min</small></p>
            <p>Maximum detail for big screens, at the same price as HD.</p>
          </div>
        </div>
        <p className="lp-topups">
          Top up {TOP_UP_AMOUNTS_USD.map((a) => `$${a}`).join(" · ")}. Credit never expires.
        </p>
      </section>

      {/* ------------------------------------------------------------------ FAQ */}
      <section className="lp-section lp-faq-section">
        <div className="lp-head">
          <span className="lp-kicker">FAQ</span>
          <h2>Questions, answered</h2>
        </div>
        <div className="lp-faq">
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ Final CTA */}
      <section className="lp-final">
        <LoopVideo id="neon" className="lp-final-video" />
        <div className="lp-final-inner">
          <h2>Your first scene is one sentence away.</h2>
          <Link href={startHref} className="lp-btn primary">Start directing</Link>
        </div>
      </section>

      <footer className="lp-footer">
        <span>© {new Date().getFullYear()} AI Movie Director</span>
        <span>
          <a href="#how">How it works</a> · <a href="#pricing">Pricing</a> · <Link href="/login">Log in</Link>
        </span>
      </footer>
    </main>
  );
}
