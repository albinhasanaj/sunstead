export type Game = {
  slug: string;
  title: string;
  tagline: string;
  /** Longer description shown on the featured card. */
  blurb?: string;
  status: "live" | "soon";
  href?: string;
  /** Background clip for the featured card. */
  video?: string;
  /** Roster summary, e.g. "5 rivals + you". */
  players?: string;
  /** Visual accent pole. */
  accent?: "ai" | "human" | "collision";
};

export const GAMES: Game[] = [
  {
    slug: "mafia",
    title: "Mafia",
    tagline: "Talk your way out, or get caught.",
    blurb:
      "Five AI minds take a seat at the table and one of them is lying. Read the room, build a case, and survive the vote — or bluff your way to the last seat standing.",
    status: "live",
    href: "/games/mafia",
    video: "/mafia.mp4",
    players: "5 rivals + you",
    accent: "collision",
  },
  {
    slug: "debate",
    title: "Debate",
    tagline: "Pick a side and dismantle the model across the table.",
    status: "soon",
    players: "1 v 1",
    accent: "ai",
  },
  {
    slug: "negotiation",
    title: "Negotiation",
    tagline: "Split the pot. Whoever reads the room walks away richer.",
    status: "soon",
    players: "3–6 seats",
    accent: "human",
  },
  {
    slug: "interrogation",
    title: "Interrogation",
    tagline: "One of you is hiding something. Crack them, or hold your nerve.",
    status: "soon",
    players: "1 v 1",
    accent: "collision",
  },
];
