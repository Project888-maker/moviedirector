export type Example = {
  title: string;
  collection: string;
  // CSS background for the example's cover tile.
  cover: string;
  emoji: string;
  prompt: string;
  references?: { name: string; url: string }[];
};

export const EXAMPLES: Example[] = [
  {
    title: "The Departing Ferry",
    collection: "Cinema",
    cover: "linear-gradient(135deg, #7dd3fc, #2563eb)",
    emoji: "⛴️",
    prompt:
      "Photorealistic live-action cinema. Natural light and real materials, clear faces, grounded physical movement. Nora: adult woman, olive skin, long dark braid, burgundy bomber jacket, cream trousers; precise, competitive, generous. Milo: adult man, light skin, sandy-blond tight curls, small mustache, mustard sweater, dark jeans; distractible, athletic, optimistic. Keep the same faces, hair, outfits and body proportions throughout. Show each person separately and make their interaction readable. Nora and Milo jog along an open harbor promenade toward a small departing ferry. Milo carries a closed canvas bag. Nora points toward the gangway. A continuous adventurous short with occasional clear motivated cuts. Natural environmental sound, light music, no narration.",
    references: [
      { name: "Nora", url: "https://v3b.fal.media/files/b/0aad61a3/c9LOOpJnQOyGHiFyqe2nL_epSrZDee.png" },
      { name: "Milo", url: "https://v3b.fal.media/files/b/0aad61a5/DlurMst_q9n1wsmoqwBYs_W2gpRpM6.png" },
    ],
  },
  {
    title: "Following the Swell",
    collection: "Cinema",
    cover: "linear-gradient(135deg, #99f6e4, #0f766e)",
    emoji: "🏄",
    prompt:
      "Photorealistic live-action cinema. Natural light, realistic faces and materials, grounded movement. Maya is an adult woman with tan skin, wet shoulder-length dark hair and a plain rust-red wetsuit. Her surfboard is pale blue with one white stripe. One continuous adventure. Keep the same character, outfit and visual style. Follow the action with a moving camera; occasional motivated cuts are welcome. A real-looking Atlantic coastline, cool morning sun, clear green waves, a rocky headland and an open sandy cove. Waves, wind and gulls, no music.",
  },
  {
    title: "The Umbrella Train",
    collection: "Animation",
    cover: "linear-gradient(135deg, #fecaca, #b91c1c)",
    emoji: "☂️",
    prompt:
      "Stylized 2D animated film with bold flat colors and clean outlines. Three friends wait on a rainy city platform: Ada, a tall woman in a green coat; Jun, a small boy in a yellow raincoat; and Pip, an old man in a brown waistcoat holding a red umbrella. A train made of umbrellas floats into the station. They board it and drift over the rooftops. Gentle, whimsical, continuous. Rain, soft piano.",
  },
  {
    title: "The Cloud Shortcut",
    collection: "Animation",
    cover: "linear-gradient(135deg, #fde68a, #f472b6)",
    emoji: "☁️",
    prompt:
      "Warm 3D animated feature style. A pastel hillside town with canals and terracotta roofs under puffy clouds. Lina, a curious ten-year-old girl with curly red hair, denim overalls and a striped shirt, discovers that the low clouds are solid enough to walk on. She climbs onto one and uses it as a shortcut across town, waving to surprised neighbors below. Playful, bright, continuous camera. Birdsong and a light orchestral score.",
  },
  {
    title: "The Night Diner",
    collection: "Cinema",
    cover: "linear-gradient(135deg, #fdba74, #7c2d12)",
    emoji: "🍔",
    prompt:
      "Photorealistic live-action cinema, warm practical lighting. A small roadside diner at night with chrome counters and red vinyl booths. Rosa, a woman in her forties with tan skin, long dark hair and an orange fleece, sits in a booth holding a burger and tells the waiter, Sam (an older man with a grey beard and white apron), about the strangest customer she ever met. Natural dialogue, close-ups and over-the-shoulder shots. Diner ambience, quiet jukebox.",
  },
  {
    title: "The Clockmaker's Workshop",
    collection: "Animation",
    cover: "linear-gradient(135deg, #d6d3d1, #57534e)",
    emoji: "🕰️",
    prompt:
      "Stop-motion animation style with handmade textures. A cluttered clockmaker's workshop full of brass gears and desk lamps. Elias, an elderly clockmaker with round glasses and a blue apron, finishes a tiny mechanical bird. It winds itself up, flutters around the room, and leads him to a hidden door behind a shelf. Cozy, curious, continuous. Ticking clocks, soft strings.",
  },
];
