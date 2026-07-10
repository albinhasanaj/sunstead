export type Game = {
  slug: string;
  title: string;
  tagline: string;
  /** Longer description shown on the featured card. */
  blurb?: string;
  status: "live" | "soon";
  href?: string;
  /**
   * Image OR video shown as the thumbnail on the explore page and as the
   * right-side capsule image in the game detail hero. Falls back to `video`.
   */
  thumbnail?: string;
  /** Background clip for the featured card. */
  video?: string;
  /** Roster summary, e.g. "5 rivals + you". */
  players?: string;
  /** Visual accent pole. */
  accent?: "ai" | "human" | "collision";
  // ── detail page ──────────────────────────────────────────────────
  /** Media shown in the detail-page gallery (videos or images). */
  gallery?: string[];
  /** Short feature bullets on the detail page. */
  highlights?: string[];
  /** "How it plays" — the round, step by step. */
  howItPlays?: { title: string; body: string }[];
  /** At-a-glance spec chips (label → value). */
  specs?: { label: string; value: string }[];
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
    thumbnail: "/mafia.png",
    video: "/mafia.mp4",
    players: "5 rivals + you",
    accent: "collision",
    gallery: ["/mafia-trailer.mp4", "/mafia.png", "/mafia-2.mp4"],
    highlights: [
      "Voice-first — speak your moves out loud and the table talks right back.",
      "Five distinct AI minds, each on its own model with its own personality.",
      "Hidden roles: Mafia, Detective, Doctor, and Villager.",
      "Long-term memory — the AIs remember what you said and use it against you.",
      "A cinematic 3D table with night, discussion, and vote-reveal beats.",
    ],
    howItPlays: [
      {
        title: "Night falls",
        body: "The Mafia quietly pick a target while the Detective investigates and the Doctor shields — all in secret.",
      },
      {
        title: "The table talks",
        body: "By day, argue, accuse, and defend out loud. Read the room and build your case before the clock runs down.",
      },
      {
        title: "The vote",
        body: "The town votes someone out, revealed slip by slip. Guess wrong and the Mafia tighten the noose.",
      },
      {
        title: "Last seat standing",
        body: "Town wins by voting out every Mafia; the Mafia win the moment they reach parity.",
      },
    ],
    specs: [
      { label: "Players", value: "5 AI + you" },
      { label: "Format", value: "Voice-first social deduction" },
      { label: "A round", value: "Night → Discussion → Vote" },
      { label: "Length", value: "~10–20 min" },
    ],
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
