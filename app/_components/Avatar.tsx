import type { Profile } from "./AuthProvider";

const SIZES = {
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-base",
  lg: "h-20 w-20 text-3xl",
} as const;

export function Avatar({
  profile,
  size = "md",
  className = "",
}: {
  profile: Pick<Profile, "color" | "emoji" | "displayName" | "photo">;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (profile.photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profile.photo}
        alt={profile.displayName}
        className={`shrink-0 rounded-full object-cover ring-1 ring-white/30 ${SIZES[size]} ${className}`}
      />
    );
  }

  const glyph = profile.emoji || profile.displayName.charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-display leading-none text-black/90 ring-1 ring-white/30 ${SIZES[size]} ${className}`}
      style={{ backgroundColor: profile.color || "#FF6B4A" }}
      aria-hidden
    >
      {glyph}
    </span>
  );
}
