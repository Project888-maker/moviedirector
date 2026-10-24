import type { Metadata } from "next";
import Link from "next/link";
import { formatUsd, markupPercent } from "@/lib/pricing";
import { GOALS, TIERS, TOOLS, defaultValues, findTool, typicalPriceMc, userPriceMc, type Durations, type Values } from "@/lib/tools";

export const metadata: Metadata = { title: "Guide · AI Movie Director" };

type Step = { label: string; toolId: string; count: number; values?: Values; seconds?: Durations };
type Recipe = { title: string; who: string; steps: Step[] };

const RECIPES: Recipe[] = [
  {
    title: "Test an idea",
    who: "A quick social clip, or finding out if an idea works.",
    steps: [
      { label: "5 rough versions of the shot (6 s, 480p)", toolId: "grok-text", count: 5, values: { duration: 6, resolution: "480p" } },
      { label: "Music on the best one", toolId: "sonilo-music", count: 1, seconds: { video_url: 6 } },
    ],
  },
  {
    title: "A 1-minute short film",
    who: "Your own story with recurring characters, dialogue and music.",
    steps: [
      { label: "4 images: characters and locations", toolId: "klein-image", count: 1, values: { num_images: 4 } },
      { label: "12 shots with your cast (5 s, 768p)", toolId: "heygen-cast", count: 12, values: { duration: 5, resolution: "768p" } },
      { label: "Voiceover for the dialogue", toolId: "heygen-voice", count: 2, values: { text: "x".repeat(400) } },
      { label: "2 talking close-ups (10 s, 480p)", toolId: "h3-lipsync", count: 2, values: { resolution: "480P" }, seconds: { audio_url: 10 } },
      { label: "Join the shots into one film", toolId: "join-clips", count: 1 },
      { label: "Soundtrack for the whole film", toolId: "sonilo-music", count: 1, seconds: { video_url: 60 } },
      { label: "Sound effects for the whole film", toolId: "mirelo-sfx", count: 1, seconds: { video_url: 60 } },
    ],
  },
  {
    title: "A premium trailer",
    who: "30 seconds of the best quality available, for an ad or a pitch.",
    steps: [
      { label: "6 shots with your cast (5 s, 1080p)", toolId: "h3-cast", count: 6, values: { duration: 5, resolution: "1080P" } },
      { label: "1 hero action shot (5 s, 1080p)", toolId: "kling-text", count: 1, values: { duration: 5, resolution: "1080p" } },
      { label: "Join the shots", toolId: "join-clips", count: 1 },
      { label: "Trailer music", toolId: "sonilo-music", count: 1, seconds: { video_url: 35 } },
    ],
  },
];

function stepPrice(step: Step) {
  const tool = findTool(step.toolId)!;
  const values = { ...defaultValues(tool), ...step.values };
  return userPriceMc(tool.cost(values, step.seconds ?? {}), markupPercent) * step.count;
}

const WORKFLOW = [
  {
    title: "Plan your shots",
    body: "Write the story in a few sentences, then split it into shots of 3 to 8 seconds. One shot is one camera angle with one action. A 1-minute film is about 10 to 15 shots.",
  },
  {
    title: "Create your cast",
    body: "Make each character and location once with Images & storyboards (or use real photos of people who agreed to it). These images are what keeps faces and outfits the same in every shot.",
    link: { href: "/create?tool=klein-image", label: "Create images" },
  },
  {
    title: "Film each shot",
    body: "Use Cast your characters with the same photos for every shot, and repeat the same style words (for example “35mm film, warm evening light”). Or design a first frame and use Animate a photo.",
    link: { href: "/create?tool=heygen-cast", label: "Cast your characters" },
  },
  {
    title: "Give them a voice",
    body: "Write each line in Voiceover and pick a voice, then press “Make a photo say it” to turn it into a talking close-up.",
    link: { href: "/create?tool=heygen-voice", label: "Make a voiceover" },
  },
  {
    title: "Fix and polish",
    body: "Too short? Extend it. Wrong detail? Edit with words. Want anime or claymation? Restyle. Draft cheap first, and re-make only the best shots in higher quality.",
    link: { href: "/create?tool=h3-extend", label: "Extend a clip" },
  },
  {
    title: "Join, then add sound",
    body: "Press “Add to movie” under each finished shot to collect them in Join clips, in story order. Then add a soundtrack and sound effects to the joined film so the audio flows across every cut.",
    link: { href: "/create?tool=join-clips", label: "Join clips" },
  },
];

export default function GuidePage() {
  return (
    <main className="container guide">
      <header className="guide-hero">
        <span className="lp-kicker">Guide</span>
        <h1>How to make your own AI movie</h1>
        <p className="muted">
          Every tool in Create does one job. Chain them together and you have a film studio: cast, camera, voices,
          editing and music. Here is how, and what it costs.
        </p>
        <div className="row">
          <Link href="/create" className="btn primary">Open Create</Link>
          <Link href="/studio" className="btn">Try the live studio</Link>
        </div>
      </header>

      <section>
        <h2>Pick a budget</h2>
        <div className="recipes">
          {RECIPES.map((recipe) => {
            const total = recipe.steps.reduce((sum, step) => sum + stepPrice(step), 0);
            return (
              <article key={recipe.title} className="panel recipe">
                <h3>{recipe.title}</h3>
                <p className="muted">{recipe.who}</p>
                <ul>
                  {recipe.steps.map((step) => (
                    <li key={step.label}>
                      <Link href={`/create?tool=${step.toolId}`}>{step.label}</Link>
                      <span>{formatUsd(stepPrice(step))}</span>
                    </li>
                  ))}
                </ul>
                <p className="recipe-total">About <b>{formatUsd(total)}</b> in total</p>
              </article>
            );
          })}
        </div>
        <p className="hint">Prices are from today’s rates. You always see the exact price before you press Generate, and failed generations are refunded.</p>
      </section>

      <section>
        <h2>Step by step</h2>
        <ol className="workflow">
          {WORKFLOW.map((step) => (
            <li key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              {step.link && <Link href={step.link.href}>{step.link.label} →</Link>}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2>Writing prompts that work</h2>
        <div className="panel prompt-guide">
          <p>Describe a shot the way a director would, in this order:</p>
          <p className="formula">
            <span>Style</span> + <span>Who</span> + <span>Action</span> + <span>Where</span> + <span>Camera</span> + <span>Light</span> + <span>Sound</span>
          </p>
          <div className="prompt-compare">
            <div>
              <b className="bad">Vague</b>
              <p>“A man in a city.”</p>
            </div>
            <div>
              <b className="good">Directed</b>
              <p>
                “35mm film. A tired detective in a grey trench coat lights a cigarette under a flickering streetlight
                in a rainy alley, slow push-in, cold blue light with a warm neon sign, rain and distant traffic.”
              </p>
            </div>
          </div>
          <ul>
            <li>One action per shot. Several actions in 5 seconds look rushed.</li>
            <li>Keep the style words identical in every shot of one movie.</li>
            <li>With photos, refer to them as @1, @2 in the order you uploaded them.</li>
            <li>Put spoken lines in quotes: She says: “We’re late.”</li>
          </ul>
        </div>
      </section>

      <section>
        <h2>Every tool at a glance</h2>
        {GOALS.map((goal) => (
          <div key={goal.id} className="tool-table">
            <h3>{goal.title}</h3>
            <div className="tool-rows">
              {TOOLS.filter((tool) => tool.goal === goal.id).map((tool) => (
                <Link key={tool.id} href={`/create?tool=${tool.id}`} className="tool-row">
                  <span className={`tier-pill ${tool.tier}`}>{TIERS[tool.tier].label}</span>
                  <b>{tool.name}</b>
                  <span className="muted">{tool.bestFor}</span>
                  <span className="tool-row-price">about {formatUsd(typicalPriceMc(tool, markupPercent))}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="panel guide-rules">
        <h2>Fair use</h2>
        <p>
          Only upload photos and videos of people who agreed to it. The AI’s safety filters may block public figures
          and explicit content; a blocked request is refunded. Download anything you want to keep.
        </p>
      </section>
    </main>
  );
}
