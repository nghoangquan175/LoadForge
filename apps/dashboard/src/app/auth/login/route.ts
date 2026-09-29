import { NextResponse } from 'next/server';
import {
  authMode,
  checkCredentials,
  createSession,
  publicUrl,
  safeNext,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
} from '@/lib/auth';

export async function POST(req: Request) {
  const form = await req.formData();
  const next = safeNext(form.get('next'));
  const auth = authMode();

  const back = (error: string) => {
    const url = publicUrl(req, '/login');
    url.searchParams.set('error', error);
    if (next !== '/') url.searchParams.set('next', next);
    return NextResponse.redirect(url, 303);
  };

  if (auth.mode === 'disabled') return NextResponse.redirect(publicUrl(req, next), 303);
  if (auth.mode === 'misconfigured') return back('config');

  const user = String(form.get('user') ?? '');
  const password = String(form.get('password') ?? '');
  if (!checkCredentials(auth, user, password)) return back('denied');

  const res = NextResponse.redirect(publicUrl(req, next), 303);
  res.cookies.set(SESSION_COOKIE, createSession(auth.secret, auth.user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: publicUrl(req, '/').protocol === 'https:',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  });
  return res;
}
