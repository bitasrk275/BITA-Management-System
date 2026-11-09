import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase login session on every request, so Server Components see a valid user.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  // No Supabase project configured yet (fresh checkout without .env.local): nothing to refresh.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return response;

  // Token-authenticated API endpoints do not use browser session cookies.
  const pathname = request.nextUrl.pathname;
  if (
    pathname.startsWith("/api/field") ||
    pathname.startsWith("/api/telegram") ||
    pathname.startsWith("/api/reminders")
  ) {
    return response;
  }

  // Only make a network call to Supabase Auth when an sb-* auth cookie exists.
  const allCookies = request.cookies.getAll();
  const hasAuthCookie = allCookies.some((c) => c.name.startsWith("sb-"));
  if (!hasAuthCookie) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return allCookies;
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
