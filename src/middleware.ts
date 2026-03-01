import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
    process.env.ACTIVATION_SECRET || 'fallback-secret-do-not-use-in-prod'
);

export async function middleware(request: NextRequest) {
    // Only protect the /admin routes (both UI and API)
    if (!request.nextUrl.pathname.startsWith('/admin') && !request.nextUrl.pathname.startsWith('/api/admin')) {
        return NextResponse.next();
    }

    // Allow the admin login API route, voice test route, and voice prompt route to pass through
    const publicApiRoutes = ['/api/admin/auth', '/api/admin/voice-test', '/api/admin/voice-prompt'];
    if (publicApiRoutes.includes(request.nextUrl.pathname)) {
        return NextResponse.next();
    }

    const token = request.cookies.get('admin_token')?.value;

    if (!token) {
        // If accessing the UI without a token, redirect to login
        if (request.nextUrl.pathname.startsWith('/admin')) {
            const url = new URL('/admin/login', request.url);
            // Prevent infinite redirect loops if we try to access /admin/login directly
            if (request.nextUrl.pathname === '/admin/login') {
                return NextResponse.next();
            }
            return NextResponse.redirect(url);
        }
        // API request without token
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Verify the admin token
        const { payload } = await jwtVerify(token, JWT_SECRET);
        if (payload.role !== 'admin') {
            throw new Error('Invalid role');
        }

        // User is an admin, proceed. If accessing the login page while already authenticated, redirect to /admin dashboard
        if (request.nextUrl.pathname === '/admin/login') {
            return NextResponse.redirect(new URL('/admin', request.url));
        }

        return NextResponse.next();
    } catch (error) {
        // Invalid token
        if (request.nextUrl.pathname.startsWith('/admin')) {
            const url = new URL('/admin/login', request.url);
            if (request.nextUrl.pathname === '/admin/login') {
                return NextResponse.next();
            }
            return NextResponse.redirect(url);
        }
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
}

export const config = {
    matcher: ['/admin/:path*', '/api/admin/:path*'],
};
