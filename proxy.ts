import { NextResponse, type NextRequest } from "next/server";

// Optional HTTP Basic auth for the whole UI. Webhooks stay open (they check
// their own secret token) so HeyReach can reach them through a tunnel.
export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    if (decoded.slice(decoded.indexOf(":") + 1) === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ReachGuard"' },
  });
}

export const config = {
  matcher: ["/((?!api/webhooks|_next/static|_next/image|favicon.ico).*)"],
};
