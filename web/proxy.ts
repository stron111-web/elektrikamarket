import { NextResponse } from 'next/server';
// Deny HTML, RSC and legacy action POSTs before layouts or staff sessions run.
export function proxy() {
  return new NextResponse('Not found', { status: 404, headers: {
    'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
  } });
}
export const config = { matcher: '/admin/keys/:path*' };
