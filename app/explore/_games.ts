export type Game = {
  slug: string;
  title: string;
  tagline: string;
  status: "live" | "soon";
  href?: string;
};

export const GAMES: Game[] = [
  {
    slug: "mafia",
    title: "Mafia",
    tagline: "Mafia, against the machines. Talk your way out, or get caught.",
    status: "live",
    href: "/games/mafia",
  },
];
