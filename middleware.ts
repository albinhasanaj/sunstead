import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on every request except Next internals and static assets. The SSE game
     * route is intentionally NOT excluded — it needs the refreshed auth cookie so
     * the server can identify the player.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm|mov|woff2?)$).*)",
  ],
};
