import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import type { SessionData } from '@/lib/auth/session';

const PROTECTED_ROUTES = [
  '/api/feed',
  '/api/media',
  '/api/albums',
  '/api/upload',
  '/api/auth/invite',
  '/feed',
  '/albums',
];

const SESSION_OPTIONS = {
  password: process.env.SESSION_SECRET as string,
  cookieName: 'nestpic_session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
  },
};

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some((route) => pathname.startsWith(route));
}

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
  );
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (isProtectedRoute(pathname)) {
    const session = await getIronSession<SessionData>(request.cookies, SESSION_OPTIONS);

    if (!session.sessionId || !session.userId) {
      // API routes return 401; page routes redirect to /signin
      if (pathname.startsWith('/api/')) {
        const response = NextResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
          { status: 401 }
        );
        return addSecurityHeaders(response);
      }
      const signinUrl = new URL('/signin', request.url);
      signinUrl.searchParams.set('from', pathname);
      const response = NextResponse.redirect(signinUrl);
      return addSecurityHeaders(response);
    }
  }

  const response = NextResponse.next();
  return addSecurityHeaders(response);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|signin|register).*)',
  ],
};
