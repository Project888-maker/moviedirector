// Example scenes on the landing page: FLUX stills animated with MiniMax Hailuo-02 on fal.
export type Clip = { id: string; title: string; genre: string; prompt: string };

export const CLIPS: Clip[] = [
  { id: "harbor", title: "The Departing Ferry", genre: "Live action", prompt: "Nora sprints along a misty harbor toward a ferry pulling away from the dock." },
  { id: "neon", title: "Rain City", genre: "Neo-noir", prompt: "A lone detective walks a rain-soaked neon street at night, steam rising." },
  { id: "desert", title: "Last Light", genre: "Western", prompt: "A rider gallops across towering dunes at sunset, dust trailing behind." },
  { id: "clouds", title: "The Cloud Shortcut", genre: "Animation", prompt: "Lina discovers the clouds are solid and walks across them above her town." },
  { id: "diner", title: "The Night Diner", genre: "Drama", prompt: "Rosa laughs in a red booth, telling the waiter about her strangest customer." },
  { id: "space", title: "First Sunrise", genre: "Sci-fi", prompt: "An astronaut drifts to the cupola window as the sun rises over Earth." },
];

export const video = (id: string) => `/media/${id}.mp4`;
export const poster = (id: string) => `/media/${id}.jpg`;
