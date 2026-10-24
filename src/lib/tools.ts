// The Create playground's tool catalog. Each tool is one fal model behind a friendly form.
//
// Shared by the browser (forms and price estimates) and the server (validation, the real price,
// and the fal request), so it must not import anything server-only. Costs use fal's regular
// prices, not temporary promos, so a promo ending never turns a job into a loss.

import { MC_PER_USD } from "./pricing";

export type Tier = "budget" | "standard" | "premium";
export type GoalId = "clip" | "animate" | "cast" | "edit" | "sound" | "voice" | "image";
export type OutputType = "video" | "image" | "audio";
export type MediaKind = "image" | "video" | "audio";
export type Values = Record<string, string | number | boolean | string[]>;
/** Measured lengths of uploaded media, in seconds, by field key. */
export type Durations = Record<string, number>;

type Option = { value: string; label: string };

export type Field =
  | { key: string; type: "text"; label: string; placeholder?: string; required?: boolean; help?: string; maxLength?: number; rows?: number }
  | { key: string; type: "select"; label: string; options: Option[]; default: string; help?: string }
  | { key: string; type: "slider"; label: string; min: number; max: number; step: number; default: number; unit: string; help?: string }
  | { key: string; type: "toggle"; label: string; default: boolean; help?: string }
  | {
      key: string;
      type: "media";
      kind: MediaKind;
      label: string;
      required?: boolean;
      /** How many files the field takes. */
      max?: number;
      help?: string;
      /** Set when the media's length sets the price; the server measures it and enforces the range. */
      seconds?: { min: number; max: number };
    };

export type Tool = {
  id: string;
  goal: GoalId;
  tier: Tier;
  name: string;
  model: string;
  endpoint: string;
  output: OutputType;
  summary: string;
  bestFor: string;
  time: string;
  tips: string[];
  fields: Field[];
  /** fal's price in USD for these inputs. */
  cost: (v: Values, d: Durations) => number;
  /** The request body sent to fal. */
  input: (v: Values, d: Durations) => Record<string, unknown>;
};

export type Goal = { id: GoalId; title: string; description: string; icon: string };

export const GOALS: Goal[] = [
  {
    id: "clip",
    title: "Quick clip",
    description: "Type an idea, get a short video.",
    icon: "M4 6h16v12H4zM10 9.5v5l4-2.5z",
  },
  {
    id: "animate",
    title: "Animate a photo",
    description: "Bring a still image to life.",
    icon: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01",
  },
  {
    id: "cast",
    title: "Cast your characters",
    description: "Put your people, pets or products into any scene.",
    icon: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21a8 8 0 0 1 16 0",
  },
  {
    id: "edit",
    title: "Swap & restyle",
    description: "Change the look of a video or swap who's in it.",
    icon: "M4 7h11l-3-3M20 17H9l3 3M4 7v4M20 17v-4",
  },
  {
    id: "sound",
    title: "Finish your movie",
    description: "Add music and sound, make clips longer, join them into one film.",
    icon: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  },
  {
    id: "voice",
    title: "Voice & talking photo",
    description: "Turn text into speech and make a face say it.",
    icon: "M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Zm7 9a7 7 0 0 1-14 0m7 7v4",
  },
  {
    id: "image",
    title: "Images & storyboards",
    description: "Create characters, locations and first frames.",
    icon: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z",
  },
];

export const TIERS: Record<Tier, { label: string; description: string }> = {
  budget: { label: "Budget", description: "Cheapest. Great for testing ideas and social clips." },
  standard: { label: "Standard", description: "The sweet spot of quality and price." },
  premium: { label: "Premium", description: "The best quality available. For final shots." },
};

/** The smallest amount a job costs a user (1 cent). */
export const MIN_JOB_MC = 1000;

export function userPriceMc(falUsd: number, markupPercent: number): number {
  return Math.max(MIN_JOB_MC, Math.ceil(falUsd * MC_PER_USD * (1 + markupPercent / 100)));
}

// ------------------------------------------------------------------ shared fields

const ASPECTS: Record<string, string> = {
  "16:9": "16:9 landscape",
  "9:16": "9:16 vertical (Reels, TikTok)",
  "1:1": "1:1 square",
  "4:3": "4:3 classic",
  "3:4": "3:4 portrait",
  "21:9": "21:9 cinema wide",
  "3:2": "3:2 photo",
  "2:3": "2:3 poster",
};

const aspect = (values: string[], def = "16:9"): Field => ({
  key: "aspect_ratio",
  type: "select",
  label: "Shape",
  options: values.map((value) => ({ value, label: ASPECTS[value] ?? value })),
  default: def,
});

const resolution = (prices: Record<string, number>, def: string, labels: Record<string, string> = {}): Field => ({
  key: "resolution",
  type: "select",
  label: "Quality",
  options: Object.keys(prices).map((value) => ({ value, label: labels[value] ?? value })),
  default: def,
});

const duration = (min: number, max: number, def: number): Field => ({
  key: "duration",
  type: "slider",
  label: "Length",
  min,
  max,
  step: 1,
  default: def,
  unit: "s",
});

const prompt = (placeholder: string, label = "Describe the shot", required = true): Field => ({
  key: "prompt",
  type: "text",
  label,
  placeholder,
  required,
  rows: 4,
  maxLength: 2500,
});

const str = (v: Values, key: string) => String(v[key] ?? "");
const num = (v: Values, key: string) => Number(v[key] ?? 0);
const list = (v: Values, key: string) => (Array.isArray(v[key]) ? (v[key] as string[]) : []);
const first = (v: Values, key: string) => list(v, key)[0];

/** Turns the playground's "@1, @2" photo mentions into the wording each model expects. */
function refMentions(text: string, token: (n: number) => string) {
  return text.replace(/@(\d{1,2})\b/g, (_, n) => token(Number(n)));
}

/** Drops empty optional values so fal uses its own defaults. */
function clean(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}

// ------------------------------------------------------------------ prices (USD per second, regular rates)

const GROK = { "480p": 0.02, "720p": 0.03, "1080p": 0.14 };
const H3_TURBO = { "480P": 0.025, "768P": 0.04, "1080P": 0.08 };
const KLING = { "720p": 0.157, "1080p": 0.235 };
const VIDU = { "540p": 0.0315, "720p": 0.0665, "1080p": 0.084 };
const HEYGEN = { "480p": 0.02, "768p": 0.02, "1080p": 0.06 };
const H3_REF = { "480P": 0.05, "768P": 0.08, "1080P": 0.16 };
const RECAST = { "768P": 0.3, "1080P": 0.45 };
const LIPSYNC = { "480P": 0.05, "768P": 0.08, "1080P": 0.16 };
const EXTEND = { "480P": 0.025, "768P": 0.04, "1080P": 0.08 };
const BERNINI_SIZE: Record<string, { label: string; multiplier: number }> = {
  "576": { label: "Draft (576px)", multiplier: 0.5 },
  "848": { label: "Standard (848px)", multiplier: 1 },
  "1280": { label: "HD (1280px)", multiplier: 2 },
};
const BERNINI_LENGTH: Record<string, string> = { "49": "3 seconds", "81": "5 seconds", "121": "7.5 seconds" };
const BERNINI_FPS = 16;
const IMAGE_PRICE = 0.012;

const rate = (prices: Record<string, number>, v: Values) => prices[str(v, "resolution")] ?? Math.max(...Object.values(prices));

export const VOICES = [
  "Jonah", "Nadine", "Tabitha", "Soren", "Elowen", "Vincent", "Jocelyn", "Marielle", "Corinne", "Lucian", "Kieran", "Hugh",
  "Noelle", "Bram", "Ewan", "Iona", "Cecily", "Simon", "Weston", "Felicity", "Gareth", "Rory", "Meredith", "Sabrina",
];

const VOICE_LANGUAGES: Record<string, string> = {
  "": "Detect automatically", en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese",
  nl: "Dutch", pl: "Polish", ru: "Russian", uk: "Ukrainian", tr: "Turkish", ar: "Arabic", hi: "Hindi", ja: "Japanese",
  ko: "Korean", zh: "Chinese",
};

// ------------------------------------------------------------------ the catalog

export const TOOLS: Tool[] = [
  // ---------------------------------------------------------------- Quick clip
  {
    id: "grok-text",
    goal: "clip",
    tier: "budget",
    name: "Sketch",
    model: "Grok Imagine 1.5 Lite",
    endpoint: "xai/grok-imagine-video/v1.5/lite/text-to-video",
    output: "video",
    summary: "Fast, cheap clips for testing ideas, memes and social posts.",
    bestFor: "Trying ten ideas for the price of one",
    time: "about 1 minute",
    tips: [
      "Describe one moment: who, where, what happens, and the camera.",
      "480p is the cheapest way to test a prompt. Re-make the winner at 720p.",
      "Use vertical 9:16 for TikTok, Reels and Shorts.",
    ],
    fields: [
      prompt("A golden retriever in sunglasses surfs a big wave at sunset, slow-motion, shot from the water"),
      duration(1, 15, 6),
      resolution(GROK, "480p", { "480p": "480p · cheapest", "720p": "720p · sharp", "1080p": "1080p · full HD" }),
      aspect(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"]),
    ],
    cost: (v) => rate(GROK, v) * num(v, "duration"),
    input: (v) => ({ prompt: str(v, "prompt"), duration: num(v, "duration"), resolution: str(v, "resolution"), aspect_ratio: str(v, "aspect_ratio") }),
  },
  {
    id: "h3-turbo-text",
    goal: "clip",
    tier: "standard",
    name: "Cinematic",
    model: "MiniMax H3 Max Turbo",
    endpoint: "minimax/h3-max-turbo/text-to-video",
    output: "video",
    summary: "Film-like motion and lighting with sound, at a fair price.",
    bestFor: "Good-looking shots for a short film",
    time: "1 to 3 minutes",
    tips: [
      "Write it like a film shot: style, subject, action, camera, light, sound.",
      "Example: “35mm film, rainy Tokyo alley at night, a courier runs past neon signs, handheld camera, puddle reflections, distant thunder.”",
      "The model adds detail to short prompts automatically.",
    ],
    fields: [
      prompt("35mm film. A lighthouse keeper climbs the spiral stairs during a storm, lantern swinging, waves crashing outside, slow push-in"),
      duration(1, 15, 5),
      resolution(H3_TURBO, "768P", { "480P": "480p · draft", "768P": "768p · HD", "1080P": "1080p · full HD" }),
      aspect(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]),
    ],
    cost: (v) => rate(H3_TURBO, v) * num(v, "duration"),
    input: (v) => ({
      prompt: str(v, "prompt"),
      duration: num(v, "duration"),
      resolution: str(v, "resolution"),
      aspect_ratio: str(v, "aspect_ratio"),
      prompt_expansion_mode: "balanced",
    }),
  },
  {
    id: "kling-text",
    goal: "clip",
    tier: "premium",
    name: "Showcase",
    model: "Kling 4",
    endpoint: "kling/v4/text-to-video",
    output: "video",
    summary: "Top-tier realism and complex motion, up to 30 seconds in one go.",
    bestFor: "Hero shots, ads and trailers",
    time: "3 to 8 minutes",
    tips: [
      "Use it for the shots that matter most; test the idea in Sketch first.",
      "It handles crowds, sports, dance and fast action better than cheaper tools.",
      "720p costs about a third less than 1080p.",
    ],
    fields: [
      prompt("A marathon runner crosses the finish line in heavy rain, crowd cheering, slow-motion close-up, then the camera rises over the city"),
      duration(3, 30, 5),
      resolution(KLING, "720p", { "720p": "720p · HD", "1080p": "1080p · full HD" }),
      aspect(["16:9", "9:16", "1:1", "21:9"]),
    ],
    cost: (v) => rate(KLING, v) * num(v, "duration"),
    input: (v) => ({ prompt: str(v, "prompt"), duration: num(v, "duration"), resolution: str(v, "resolution"), aspect_ratio: str(v, "aspect_ratio") }),
  },

  // ---------------------------------------------------------------- Animate a photo
  {
    id: "grok-image",
    goal: "animate",
    tier: "budget",
    name: "Quick motion",
    model: "Grok Imagine 1.5 Lite",
    endpoint: "xai/grok-imagine-video/v1.5/lite/image-to-video",
    output: "video",
    summary: "Make any photo move for a few cents.",
    bestFor: "Living photos, memes and quick tests",
    time: "about 1 minute",
    tips: [
      "Say what should move: “she turns and smiles”, “the waves roll in”, “camera slowly zooms out”.",
      "The video keeps the photo's shape, so crop it first if you want vertical.",
    ],
    fields: [
      { key: "image_url", type: "media", kind: "image", label: "Photo", required: true },
      prompt("She turns towards the camera and laughs as the wind blows her hair", "What should happen?"),
      duration(1, 15, 6),
      resolution(GROK, "480p", { "480p": "480p · cheapest", "720p": "720p · sharp", "1080p": "1080p · full HD" }),
    ],
    cost: (v) => rate(GROK, v) * num(v, "duration") + 0.01,
    input: (v) => ({ image_url: first(v, "image_url"), prompt: str(v, "prompt"), duration: num(v, "duration"), resolution: str(v, "resolution") }),
  },
  {
    id: "vidu-image",
    goal: "animate",
    tier: "standard",
    name: "Natural motion",
    model: "Vidu Q4",
    endpoint: "fal-ai/vidu/q4/image-to-video",
    output: "video",
    summary: "Smooth, realistic movement that stays true to your photo.",
    bestFor: "Portraits, products and travel photos",
    time: "1 to 3 minutes",
    tips: [
      "Great for faces: it keeps the person looking like themselves.",
      "540p is a cheap preview; 1080p is sharp enough for YouTube.",
    ],
    fields: [
      { key: "image_url", type: "media", kind: "image", label: "Photo", required: true },
      prompt("The camera slowly circles the bottle as droplets run down the glass", "What should happen?", false),
      duration(3, 16, 5),
      resolution(VIDU, "720p", { "540p": "540p · preview", "720p": "720p · HD", "1080p": "1080p · full HD" }),
    ],
    cost: (v) => rate(VIDU, v) * num(v, "duration"),
    input: (v) => clean({ image_url: first(v, "image_url"), prompt: str(v, "prompt"), duration: num(v, "duration"), resolution: str(v, "resolution") }),
  },
  {
    id: "h3-turbo-frames",
    goal: "animate",
    tier: "standard",
    name: "First & last frame",
    model: "MiniMax H3 Max Turbo",
    endpoint: "minimax/h3-max-turbo/image-to-video",
    output: "video",
    summary: "Give a start image and, optionally, an end image. The AI films the journey between them.",
    bestFor: "Transformations and joining shots together",
    time: "1 to 3 minutes",
    tips: [
      "Use the last frame of one clip as the first frame of the next to build longer scenes.",
      "Start and end images should share the same shape and similar framing.",
    ],
    fields: [
      { key: "image_url", type: "media", kind: "image", label: "First frame", required: true },
      { key: "end_image_url", type: "media", kind: "image", label: "Last frame (optional)" },
      prompt("The caterpillar wraps itself in silk and emerges as a bright blue butterfly", "What happens in between?"),
      duration(1, 15, 5),
      resolution(H3_TURBO, "768P", { "480P": "480p · draft", "768P": "768p · HD", "1080P": "1080p · full HD" }),
    ],
    cost: (v) => rate(H3_TURBO, v) * num(v, "duration"),
    input: (v) =>
      clean({
        image_url: first(v, "image_url"),
        end_image_url: first(v, "end_image_url"),
        prompt: str(v, "prompt"),
        duration: num(v, "duration"),
        resolution: str(v, "resolution"),
        prompt_expansion_mode: "balanced",
      }),
  },
  {
    id: "kling-image",
    goal: "animate",
    tier: "premium",
    name: "Studio motion",
    model: "Kling 4",
    endpoint: "kling/v4/image-to-video",
    output: "video",
    summary: "The most realistic animation, with an optional end frame, up to 30 seconds.",
    bestFor: "Final shots, ads and music videos",
    time: "3 to 8 minutes",
    tips: [
      "Ideal for action and body movement: dancing, fighting, sports.",
      "Add an end frame to control exactly where the shot finishes.",
    ],
    fields: [
      { key: "start_image_url", type: "media", kind: "image", label: "Photo", required: true },
      { key: "end_image_url", type: "media", kind: "image", label: "End frame (optional)" },
      prompt("The dancer spins and leaps across the stage as the spotlight follows her", "What should happen?", false),
      duration(3, 30, 5),
      resolution(KLING, "720p", { "720p": "720p · HD", "1080p": "1080p · full HD" }),
    ],
    cost: (v) => rate(KLING, v) * num(v, "duration"),
    input: (v) =>
      clean({
        start_image_url: first(v, "start_image_url"),
        end_image_url: first(v, "end_image_url"),
        prompt: str(v, "prompt"),
        duration: num(v, "duration"),
        resolution: str(v, "resolution"),
      }),
  },

  // ---------------------------------------------------------------- Cast your characters
  {
    id: "heygen-cast",
    goal: "cast",
    tier: "budget",
    name: "Cast lite",
    model: "HeyGen Video",
    endpoint: "heygen/heygen-video/reference-to-video",
    output: "video",
    summary: "Put the people or things from your photos into a new scene, cheaply.",
    bestFor: "UGC-style clips, product demos and shorts",
    time: "1 to 3 minutes",
    tips: [
      "Upload clear, well-lit photos. Refer to them in the prompt as @1, @2…",
      "Example: “@1 unboxes @2 at a kitchen table and smiles at the camera.”",
      "Only use photos of people who agreed to it.",
    ],
    fields: [
      { key: "reference_image_urls", type: "media", kind: "image", label: "Photos of your cast", required: true, max: 4, help: "Up to 4 photos: people, pets, products or places." },
      prompt("@1 walks into a cozy coffee shop, orders a latte and sits by the window as it starts to rain"),
      duration(5, 15, 5),
      resolution(HEYGEN, "768p", { "480p": "480p", "768p": "768p · HD", "1080p": "1080p · full HD" }),
      aspect(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]),
    ],
    cost: (v) => rate(HEYGEN, v) * num(v, "duration"),
    input: (v) => ({
      prompt: refMentions(str(v, "prompt"), (n) => `reference image ${n}`),
      reference_image_urls: list(v, "reference_image_urls"),
      duration: num(v, "duration"),
      resolution: str(v, "resolution"),
      aspect_ratio: str(v, "aspect_ratio"),
    }),
  },
  {
    id: "vidu-cast",
    goal: "cast",
    tier: "standard",
    name: "Cast & talk",
    model: "Vidu Q4",
    endpoint: "fal-ai/vidu/q4/reference-to-video",
    output: "video",
    summary: "Up to 7 characters, props or places in one shot, with optional dialogue and sound.",
    bestFor: "Story scenes with several characters",
    time: "1 to 4 minutes",
    tips: [
      "Refer to photos as @1, @2… in the order you uploaded them.",
      "Turn on sound to get dialogue and effects. Put spoken lines in quotes.",
      "Example: “@1 and @2 argue at @3. @1 says: ‘We're late again.’”",
    ],
    fields: [
      { key: "reference_image_urls", type: "media", kind: "image", label: "Photos of your cast", required: true, max: 7, help: "Up to 7 photos: characters, outfits, props or locations." },
      prompt("@1 and @2 share an umbrella while running across a rainy street in Paris, laughing"),
      { key: "audio", type: "toggle", label: "Generate sound and dialogue", default: true },
      duration(3, 16, 5),
      resolution(VIDU, "720p", { "540p": "540p · preview", "720p": "720p · HD", "1080p": "1080p · full HD" }),
      aspect(["16:9", "9:16", "1:1", "4:3", "3:4"]),
    ],
    cost: (v) => rate(VIDU, v) * num(v, "duration"),
    input: (v) => ({
      prompt: refMentions(str(v, "prompt"), (n) => `[@reference_image_${n}]`),
      reference_image_urls: list(v, "reference_image_urls"),
      audio: Boolean(v.audio),
      duration: num(v, "duration"),
      resolution: str(v, "resolution"),
      aspect_ratio: str(v, "aspect_ratio"),
    }),
  },
  {
    id: "h3-cast",
    goal: "cast",
    tier: "premium",
    name: "Cast pro",
    model: "MiniMax H3 Max",
    endpoint: "minimax/h3-max/reference-to-video",
    output: "video",
    summary: "The most faithful faces and outfits, cinematic camera work and sound.",
    bestFor: "Film scenes where your actors must look exactly right",
    time: "2 to 5 minutes",
    tips: [
      "Use a sharp, front-facing photo per character. Refer to them as @1, @2…",
      "Describe the look too (“35mm film, warm evening light”) for a consistent style across shots.",
      "Reuse the same photos and style words in every shot of your movie.",
    ],
    fields: [
      { key: "reference_image_urls", type: "media", kind: "image", label: "Photos of your cast", required: true, max: 4, help: "Up to 4 photos. Faces, outfits, props or places." },
      prompt("Photorealistic, golden hour. @1 and @2 race along a misty harbor toward a ferry that's pulling away"),
      duration(1, 15, 5),
      resolution(H3_REF, "768P", { "480P": "480p · draft", "768P": "768p · HD", "1080P": "1080p · full HD" }),
      aspect(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]),
    ],
    cost: (v) => rate(H3_REF, v) * num(v, "duration"),
    input: (v) => ({
      prompt: refMentions(str(v, "prompt"), (n) => `Image ${n}`),
      reference_image_urls: list(v, "reference_image_urls"),
      duration: num(v, "duration"),
      resolution: str(v, "resolution"),
      aspect_ratio: str(v, "aspect_ratio"),
      prompt_expansion_mode: "balanced",
    }),
  },

  // ---------------------------------------------------------------- Swap & restyle
  {
    id: "lucy-restyle",
    goal: "edit",
    tier: "budget",
    name: "Restyle",
    model: "Decart Lucy Restyle",
    endpoint: "decart/lucy-restyle",
    output: "video",
    summary: "Turn your video into anime, claymation, a painting or any style, keeping the motion.",
    bestFor: "Style transfers of longer videos for a few cents",
    time: "1 to 3 minutes",
    tips: [
      "Name the style clearly: “Studio Ghibli anime”, “LEGO stop-motion”, “oil painting”.",
      "Works on clips up to 2 minutes. You pay for the length of your video.",
    ],
    fields: [
      { key: "video_url", type: "media", kind: "video", label: "Your video", required: true, seconds: { min: 1, max: 120 }, help: "Up to 2 minutes. MP4 works best." },
      prompt("Hand-painted Studio Ghibli anime style, soft watercolor skies", "New style"),
    ],
    cost: (_v, d) => 0.01 * d.video_url,
    input: (v) => ({ video_url: first(v, "video_url"), prompt: str(v, "prompt"), resolution: "720p" }),
  },
  {
    id: "flux-edit-video",
    goal: "edit",
    tier: "standard",
    name: "Edit with words",
    model: "FLUX.3 Edit Video",
    endpoint: "blackforestlabs/flux-3/edit-video",
    output: "video",
    summary: "Change one thing in your video with an instruction. Everything else stays the same.",
    bestFor: "Changing weather, outfits, objects or the time of day",
    time: "1 to 3 minutes",
    tips: [
      "Give one clear instruction: “make it snow”, “change her jacket to red leather”, “turn day into night”.",
      "Videos must be under 15 seconds and 50 MB (MP4).",
    ],
    fields: [
      { key: "video_url", type: "media", kind: "video", label: "Your video", required: true, seconds: { min: 1, max: 15 }, help: "MP4 under 15 seconds and 50 MB." },
      prompt("Make it snow heavily and give the scene a cold winter palette", "What should change?"),
    ],
    cost: (_v, d) => 0.03 * d.video_url,
    input: (v) => ({ video_url: first(v, "video_url"), prompt: str(v, "prompt") }),
  },
  {
    id: "bernini-swap",
    goal: "edit",
    tier: "standard",
    name: "Swap with a photo",
    model: "Bernini-R Reference Edit",
    endpoint: "fal-ai/bernini-r/reference-edit-video",
    output: "video",
    summary: "Replace a person, outfit or object in your video with the one in your photo.",
    bestFor: "Object swaps, outfit swaps and character replacement",
    time: "2 to 5 minutes",
    tips: [
      "Say what to replace with what: “replace the man with the person in @1”.",
      "The result is a 3 to 7.5 second clip taken from the start of your video.",
      "Only swap in people who agreed to it.",
    ],
    fields: [
      { key: "video_url", type: "media", kind: "video", label: "Your video", required: true, help: "The first few seconds are used." },
      { key: "reference_image_urls", type: "media", kind: "image", label: "Photo of what to swap in", required: true, max: 3 },
      prompt("Replace the man in the video with the person in @1, keeping the same movement", "What should be swapped?"),
      { key: "num_frames", type: "select", label: "Length", options: Object.entries(BERNINI_LENGTH).map(([value, label]) => ({ value, label })), default: "81" },
      { key: "max_image_size", type: "select", label: "Quality", options: Object.entries(BERNINI_SIZE).map(([value, o]) => ({ value, label: o.label })), default: "848" },
    ],
    cost: (v) => 0.08 * (BERNINI_SIZE[str(v, "max_image_size")]?.multiplier ?? 2) * (num(v, "num_frames") / BERNINI_FPS),
    input: (v) => ({
      video_url: first(v, "video_url"),
      reference_image_urls: list(v, "reference_image_urls"),
      prompt: refMentions(str(v, "prompt"), (n) => `reference image ${n}`),
      num_frames: num(v, "num_frames"),
      frames_per_second: BERNINI_FPS,
      max_image_size: num(v, "max_image_size"),
    }),
  },
  {
    id: "h3-recast",
    goal: "edit",
    tier: "premium",
    name: "Recast actors",
    model: "MiniMax H3 Max Recast",
    endpoint: "minimax/h3-max/recast",
    output: "video",
    summary: "Replace the people in your video with new actors from photos, across every shot.",
    bestFor: "Hollywood-style face and body swaps in real footage",
    time: "3 to 8 minutes",
    tips: [
      "Upload one photo per new person. They replace the main people from left to right.",
      "Your video must be 5 to 30 seconds, with no single shot longer than 15 seconds.",
      "Only recast people who agreed to it.",
    ],
    fields: [
      { key: "video_url", type: "media", kind: "video", label: "Your video", required: true, seconds: { min: 5, max: 30 }, help: "5 to 30 seconds." },
      { key: "reference_image_urls", type: "media", kind: "image", label: "New actors", required: true, max: 3, help: "One photo per person, in left-to-right order." },
      prompt("Keep the original lighting and camera movement", "Notes (optional)", false),
      resolution(RECAST, "768P", { "768P": "768p · HD", "1080P": "1080p · full HD" }),
    ],
    cost: (v, d) => rate(RECAST, v) * d.video_url,
    input: (v) =>
      clean({
        video_url: first(v, "video_url"),
        reference_image_urls: list(v, "reference_image_urls"),
        prompt: str(v, "prompt"),
        resolution: str(v, "resolution"),
      }),
  },

  // ---------------------------------------------------------------- Sound & extend
  {
    id: "sonilo-music",
    goal: "sound",
    tier: "budget",
    name: "Soundtrack",
    model: "Sonilo Music",
    endpoint: "sonilo/v1.1/video-to-video-music",
    output: "video",
    summary: "Scores your video with original music that follows the action.",
    bestFor: "Adding a soundtrack to any clip",
    time: "about 1 minute",
    tips: [
      "Describe the mood and genre: “tense orchestral build-up”, “lo-fi hip hop”, “epic trailer drums”.",
      "Keep dialogue on to mix the music under any speech.",
    ],
    fields: [
      { key: "video_url", type: "media", kind: "video", label: "Your video", required: true, seconds: { min: 1, max: 180 }, help: "Up to 3 minutes." },
      prompt("Warm, hopeful piano with soft strings", "Music style (optional)", false),
      { key: "keep_speech_vocal", type: "toggle", label: "Keep dialogue from the original video", default: true },
    ],
    cost: (_v, d) => 0.009 * d.video_url,
    input: (v) =>
      clean({
        video_url: first(v, "video_url"),
        prompt: str(v, "prompt"),
        keep_speech_vocal: Boolean(v.keep_speech_vocal),
        num_samples: 1,
      }),
  },
  {
    id: "mirelo-sfx",
    goal: "sound",
    tier: "budget",
    name: "Sound effects",
    model: "Mirelo SFX 2",
    endpoint: "mirelo-ai/sfx2.0/video-to-video",
    output: "video",
    summary: "Adds realistic sound effects that match what's on screen: steps, doors, rain, engines.",
    bestFor: "Making silent clips feel real",
    time: "about 1 minute",
    tips: [
      "Leave the description empty and it listens to the picture, or guide it: “heavy rain and distant thunder”.",
      "Run it after Soundtrack to get music and effects together.",
    ],
    fields: [
      { key: "video_url", type: "media", kind: "video", label: "Your video", required: true, seconds: { min: 1, max: 120 }, help: "Up to 2 minutes." },
      prompt("Footsteps on gravel, wind, a car passing", "Sounds to add (optional)", false),
      { key: "preserve_speech", type: "toggle", label: "Keep dialogue from the original video", default: true },
    ],
    cost: (_v, d) => 0.015 * d.video_url,
    input: (v, d) =>
      clean({
        video_url: first(v, "video_url"),
        text_prompt: str(v, "prompt"),
        preserve_speech: Boolean(v.preserve_speech),
        num_samples: 1,
        // Rounded down: fal rejects a duration longer than the video.
        duration: Math.max(1, Math.floor(d.video_url * 10) / 10),
      }),
  },
  {
    id: "h3-extend",
    goal: "sound",
    tier: "standard",
    name: "Extend a clip",
    model: "MiniMax H3 Max Turbo",
    endpoint: "minimax/h3-max-turbo/extend-video",
    output: "video",
    summary: "Continues your video with new footage that follows on seamlessly.",
    bestFor: "Turning a 5-second shot into a longer scene",
    time: "1 to 3 minutes",
    tips: [
      "Say what happens next: “she opens the door and steps into the light”.",
      "You only pay for the new seconds. Repeat to keep extending.",
    ],
    fields: [
      { key: "video_url", type: "media", kind: "video", label: "Your video", required: true, seconds: { min: 1.7, max: 60 }, help: "2 to 60 seconds, up to 50 MB." },
      prompt("The camera follows her through the door into a sunlit garden", "What happens next?"),
      { ...duration(1, 15, 5), label: "Seconds to add" },
      resolution(EXTEND, "768P", { "480P": "480p · draft", "768P": "768p · HD", "1080P": "1080p · full HD" }),
    ],
    cost: (v) => rate(EXTEND, v) * num(v, "duration"),
    input: (v) => ({ video_url: first(v, "video_url"), prompt: str(v, "prompt"), duration: num(v, "duration"), resolution: str(v, "resolution") }),
  },

  {
    id: "join-clips",
    goal: "sound",
    tier: "budget",
    name: "Join clips",
    model: "FFmpeg",
    endpoint: "fal-ai/ffmpeg-api/merge-videos",
    output: "video",
    summary: "Joins your shots, in order, into one movie file.",
    bestFor: "Putting your finished shots together",
    time: "under a minute",
    tips: [
      "Add your clips in story order. Use “Add to movie” under any result to collect them here.",
      "Clips with the same shape (for example all 16:9) join best.",
      "Add music to the joined movie last, so it flows across every shot.",
    ],
    fields: [
      { key: "video_urls", type: "media", kind: "video", label: "Clips, in order", required: true, max: 12 },
    ],
    cost: () => 0,
    input: (v) => ({ video_urls: list(v, "video_urls") }),
  },

  // ---------------------------------------------------------------- Voice & talking photo
  {
    id: "heygen-voice",
    goal: "voice",
    tier: "budget",
    name: "Voiceover",
    model: "HeyGen Voice Turbo",
    endpoint: "heygen/heygen-voice/turbo",
    output: "audio",
    summary: "Natural speech from text in 24 voices and many languages. Costs about a cent.",
    bestFor: "Narration, dialogue lines and voices for talking photos",
    time: "a few seconds",
    tips: [
      "Write it the way it should be spoken. Punctuation controls pauses.",
      "Then use Talking photo to make a face say it.",
    ],
    fields: [
      { key: "text", type: "text", label: "What should be said?", placeholder: "In a world where every story can be filmed in seconds, one director dared to dream bigger.", required: true, rows: 5, maxLength: 5000 },
      { key: "voice", type: "select", label: "Voice", options: VOICES.map((value) => ({ value, label: value })), default: "Jonah" },
      { key: "language", type: "select", label: "Language", options: Object.entries(VOICE_LANGUAGES).map(([value, label]) => ({ value, label })), default: "" },
    ],
    cost: (v) => (str(v, "text").length / 1000) * 0.004,
    input: (v) => clean({ text: str(v, "text"), voice: str(v, "voice"), language: str(v, "language") }),
  },
  {
    id: "h3-lipsync",
    goal: "voice",
    tier: "standard",
    name: "Talking photo",
    model: "MiniMax H3 Max Lip-sync",
    endpoint: "minimax/h3-max/lip-sync/image-to-video",
    output: "video",
    summary: "Makes the person in a photo speak or sing your audio, with natural lips and expressions.",
    bestFor: "Presenters, dialogue scenes and music videos",
    time: "1 to 4 minutes",
    tips: [
      "Use a clear photo of one face looking roughly at the camera.",
      "The video is as long as your audio (5 to 60 seconds). Make the audio with Voiceover.",
      "Only animate people who agreed to it.",
    ],
    fields: [
      { key: "image_url", type: "media", kind: "image", label: "Photo of the speaker", required: true },
      { key: "audio_url", type: "media", kind: "audio", label: "Speech or song", required: true, seconds: { min: 5, max: 60 }, help: "5 to 60 seconds. MP3, WAV or M4A." },
      resolution(LIPSYNC, "768P", { "480P": "480p · draft", "768P": "768p · HD", "1080P": "1080p · full HD" }),
    ],
    cost: (v, d) => rate(LIPSYNC, v) * d.audio_url * (d.audio_url > 15 ? 1.2 : 1),
    input: (v) => ({ image_url: first(v, "image_url"), audio_url: first(v, "audio_url"), resolution: str(v, "resolution") }),
  },

  // ---------------------------------------------------------------- Images & storyboards
  {
    id: "klein-image",
    goal: "image",
    tier: "budget",
    name: "Create images",
    model: "FLUX.3 Klein",
    endpoint: "blackforestlabs/flux-3/klein/text-to-image",
    output: "image",
    summary: "Characters, locations and first frames for about a cent each.",
    bestFor: "Designing your cast and storyboarding every shot",
    time: "a few seconds",
    tips: [
      "Make a character once, then use the image in Cast your characters or Animate a photo.",
      "For a character sheet try: “front view, full body, plain grey background”.",
    ],
    fields: [
      prompt("Cinematic portrait of a weathered sea captain with a white beard and yellow raincoat, stormy harbor behind him", "Describe the image"),
      {
        key: "image_size",
        type: "select",
        label: "Shape",
        options: [
          { value: "landscape_16_9", label: "16:9 landscape" },
          { value: "portrait_16_9", label: "9:16 vertical" },
          { value: "square_hd", label: "1:1 square" },
          { value: "landscape_4_3", label: "4:3 landscape" },
          { value: "portrait_4_3", label: "3:4 portrait" },
        ],
        default: "landscape_16_9",
      },
      { key: "num_images", type: "slider", label: "Number of images", min: 1, max: 4, step: 1, default: 2, unit: "" },
    ],
    cost: (v) => IMAGE_PRICE * num(v, "num_images"),
    input: (v) => ({ prompt: str(v, "prompt"), image_size: str(v, "image_size"), num_images: num(v, "num_images"), output_format: "jpeg" }),
  },
  {
    id: "klein-edit",
    goal: "image",
    tier: "budget",
    name: "Edit & combine images",
    model: "FLUX.3 Klein Edit",
    endpoint: "blackforestlabs/flux-3/klein/edit-image",
    output: "image",
    summary: "Change outfits, backgrounds or poses, or combine several photos into one scene.",
    bestFor: "Keeping a character consistent across different shots",
    time: "a few seconds",
    tips: [
      "Refer to photos as @1, @2: “put the person in @1 in the outfit from @2, standing in a desert”.",
      "Great for making first frames for Animate a photo.",
    ],
    fields: [
      { key: "image_urls", type: "media", kind: "image", label: "Your images", required: true, max: 4 },
      prompt("Put the person from @1 on a rainy Tokyo street at night, same face and clothes, cinematic lighting", "What should change?"),
      { key: "num_images", type: "slider", label: "Number of images", min: 1, max: 4, step: 1, default: 1, unit: "" },
    ],
    cost: (v) => IMAGE_PRICE * num(v, "num_images"),
    input: (v) => ({
      prompt: refMentions(str(v, "prompt"), (n) => `image ${n}`),
      image_urls: list(v, "image_urls"),
      num_images: num(v, "num_images"),
      output_format: "jpeg",
    }),
  },
];

export function findTool(id: string) {
  return TOOLS.find((tool) => tool.id === id);
}

export function defaultValues(tool: Tool): Values {
  const values: Values = {};
  for (const field of tool.fields) {
    if (field.type === "text") values[field.key] = "";
    else if (field.type === "media") values[field.key] = [];
    else values[field.key] = field.default;
  }
  return values;
}

/** Fields whose uploaded media sets the price. */
export function measuredFields(tool: Tool) {
  return tool.fields.filter((f): f is Extract<Field, { type: "media" }> => f.type === "media" && !!f.seconds);
}

/** Checks and normalizes raw form values. Returns the cleaned values or a message for the user. */
export function validateValues(tool: Tool, raw: unknown): { values: Values } | { error: string } {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const values: Values = {};
  for (const field of tool.fields) {
    const value = input[field.key];
    switch (field.type) {
      case "text": {
        const text = typeof value === "string" ? value.trim() : "";
        if (field.required && !text) return { error: `${field.label} is required.` };
        if (text.length > (field.maxLength ?? 2500)) return { error: `${field.label} is too long.` };
        values[field.key] = text;
        break;
      }
      case "select":
        values[field.key] = field.options.some((o) => o.value === value) ? String(value) : field.default;
        break;
      case "slider": {
        const n = Number(value);
        const clamped = Number.isFinite(n) ? Math.min(field.max, Math.max(field.min, n)) : field.default;
        values[field.key] = Math.round(clamped / field.step) * field.step;
        break;
      }
      case "toggle":
        values[field.key] = typeof value === "boolean" ? value : field.default;
        break;
      case "media": {
        const urls = (Array.isArray(value) ? value : []).filter((u): u is string => typeof u === "string" && /^https:\/\/\S+$/.test(u));
        if (field.required && urls.length === 0) return { error: `Add ${field.label.toLowerCase()}.` };
        if (urls.length > (field.max ?? 1)) return { error: `${field.label}: up to ${field.max ?? 1} file(s).` };
        values[field.key] = urls;
        break;
      }
    }
  }
  return { values };
}

/** Pulls the result file URLs out of a fal response. */
export function extractOutputs(type: OutputType, data: unknown): string[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const urlsOf = (value: unknown): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap(urlsOf);
    if (typeof value === "object" && typeof (value as { url?: unknown }).url === "string") return [(value as { url: string }).url];
    return [];
  };
  if (type === "image") return urlsOf(d.images);
  if (type === "audio") return urlsOf(d.audio);
  const video = urlsOf(d.video);
  return video.length ? video.slice(0, 1) : urlsOf(d.videos).slice(0, 1);
}

/** What a tool costs a user with its default settings (and 5 s of uploaded media), for "about $x" labels. */
export function typicalPriceMc(tool: Tool, markupPercent: number) {
  const values = defaultValues(tool);
  const durations: Durations = {};
  for (const field of measuredFields(tool)) durations[field.key] = Math.max(5, field.seconds!.min);
  return userPriceMc(tool.cost(values, durations), markupPercent);
}
