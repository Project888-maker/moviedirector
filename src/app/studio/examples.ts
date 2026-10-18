export type Example = {
  title: string;
  collection: string;
  // Cover image in /public/media (the same scenes shown on the landing page).
  cover: string;
  prompt: string;
  references?: { name: string; url: string }[];
};

export const EXAMPLES: Example[] = [
  {
    title: "The Departing Ferry",
    collection: "Live action",
    cover: "/media/harbor.jpg",
    prompt:
      "Photorealistic live-action cinema. Natural light and real materials, clear faces, grounded physical movement. Nora: adult woman, olive skin, long dark braid, burgundy bomber jacket, cream trousers; precise, competitive, generous. Milo: adult man, light skin, sandy-blond tight curls, small mustache, mustard sweater, dark jeans; distractible, athletic, optimistic. Keep the same faces, hair, outfits and body proportions throughout. Nora and Milo race along a misty harbor promenade at golden hour toward a small ferry pulling away from the dock. Milo carries a canvas bag. Nora points toward the gangway. A continuous adventurous short with occasional clear motivated cuts. Gulls, waves and wind, light music, no narration.",
    references: [
      { name: "Nora", url: "https://v3b.fal.media/files/b/0aaeedea/k8Aly9tl8qZgvRdTZQezK_f1938658ec19439c8653408462f24009.jpg" },
      { name: "Milo", url: "https://v3b.fal.media/files/b/0aaeedea/R6aF3FmidSXVjz9-Kcx8S_26daaf2627964775ab851b58f41dbfba.jpg" },
    ],
  },
  {
    title: "Rain City",
    collection: "Neo-noir",
    cover: "/media/neon.jpg",
    prompt:
      "Neo-noir live-action cinema at night. Rain-soaked city street lit by magenta and teal neon signs, steam rising from grates, reflections in deep puddles. Detective Kane: tall man in a long dark trench coat and fedora, stubble, tired eyes. Keep the same face and coat throughout. Kane follows a woman in a red raincoat through the crowd, loses her at an intersection, then finds a dropped photograph on the wet pavement. Slow, tense, moody camera with occasional close-ups. Rain, distant sirens, low synth score.",
  },
  {
    title: "Last Light",
    collection: "Western",
    cover: "/media/desert.jpg",
    prompt:
      "Epic western shot on 35mm film. Towering desert dunes at sunset under an enormous orange sky. Eli: weathered rider in a dusty duster coat and wide-brim hat on a black horse. Keep the same rider, horse and costume throughout. Eli gallops across the dunes, crests a ridge and spots a distant caravan of lanterns. Wide sweeping crane shots mixed with close-ups of his face. Wind, hoofbeats and a lonely guitar.",
  },
  {
    title: "The Cloud Shortcut",
    collection: "Animation",
    cover: "/media/clouds.jpg",
    prompt:
      "Warm 3D animated feature style. A pastel hillside town with canals and terracotta roofs under puffy clouds. Lina, a curious ten-year-old girl with curly red hair, denim overalls and a striped shirt, discovers that the low clouds are solid enough to walk on. She climbs onto one and uses it as a shortcut across town, waving to surprised neighbors below. Playful, bright, continuous camera. Birdsong and a light orchestral score.",
  },
  {
    title: "The Night Diner",
    collection: "Drama",
    cover: "/media/diner.jpg",
    prompt:
      "Photorealistic live-action cinema, warm practical lighting. A small 1970s roadside diner at night with chrome counters, red vinyl booths and rain on the windows. Rosa, a woman in her forties with long dark hair and an orange fleece, sits in a booth holding a burger and tells the waiter, Sam (an older man with a grey beard and white apron), about the strangest customer she ever met. Natural dialogue, close-ups and over-the-shoulder shots. Diner ambience, quiet jukebox.",
  },
  {
    title: "First Sunrise",
    collection: "Sci-fi",
    cover: "/media/space.jpg",
    prompt:
      "Photorealistic sci-fi cinema. Inside a space station cupola orbiting Earth. Commander Ada: astronaut in a white suit with a gold visor, calm and focused. Keep the same suit and station interior throughout. Ada floats to the round window as the sun rises over Earth's blue horizon, records a message for her daughter, then notices a strange light moving across the planet. Slow floating camera, lens flares, quiet awe. Soft hum of the station and a gentle ambient score.",
  },
];
