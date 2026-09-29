import { NextResponse, type NextRequest } from 'next/server';
import { authMode, publicUrl, SESSION_COOKIE, verifySession } from './lib/auth';

/** Sends anyone without a valid session to /login. */
export function proxy(req: NextRequest) {
  const auth = authMode();
  if (auth.mode === 'disabled') return NextResponse.next();
  if (auth.mode === 'enabled' && verifySession(auth.secret, req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  const login = publicUrl(req, '/login');
  if (req.nextUrl.pathname !== '/') login.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!login|auth/|_next/static|_next/image|favicon.ico).*)'],
};
