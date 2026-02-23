import { SignJWT, jwtVerify } from 'jose';

const getSecret = () => new TextEncoder().encode(process.env.ACTIVATION_SECRET || 'default-secret-change-me');

/**
 * Sign a JWT token with device fingerprint embedded
 */
export async function signToken(fingerprint: string): Promise<string> {
    return new SignJWT({ fp: fingerprint })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('3650d') // ~10 years
        .sign(getSecret());
}

/**
 * Verify JWT token and check device fingerprint
 * Returns true if valid, false otherwise
 */
export async function verifyToken(token: string | null, fingerprint: string | null): Promise<boolean> {
    if (!token || !fingerprint) return false;
    try {
        const { payload } = await jwtVerify(token, getSecret());
        return payload.fp === fingerprint;
    } catch {
        return false;
    }
}

/**
 * Check if activation code is valid
 */
export function isValidCode(code: string): boolean {
    const codes = (process.env.ACTIVATION_CODES || '').split(',').map(c => c.trim()).filter(Boolean);
    return codes.includes(code.trim());
}

/**
 * Extract auth info from request headers
 */
export function getAuthFromHeaders(req: Request) {
    const token = req.headers.get('x-activation-token');
    const fingerprint = req.headers.get('x-device-fingerprint');
    return { token, fingerprint };
}
