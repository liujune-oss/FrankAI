import { SignJWT, jwtVerify } from 'jose';

const getSecret = () => new TextEncoder().encode(process.env.ACTIVATION_SECRET || 'default-secret-change-me');

/**
 * Sign a JWT token with device fingerprint and user_id embedded
 */
export async function signToken(fingerprint: string, userId: string): Promise<string> {
    return new SignJWT({ fp: fingerprint, uid: userId })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('3650d') // ~10 years
        .sign(getSecret());
}

/**
 * Verify JWT token and check device fingerprint
 * Returns payload if valid, false otherwise
 */
export async function verifyToken(token: string | null, fingerprint: string | null): Promise<any | false> {
    if (!token || !fingerprint) return false;
    try {
        const { payload } = await jwtVerify(token, getSecret());
        if (payload.fp === fingerprint) {
            return payload; // Returns { fp, uid, exp, iat }
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Extract auth info from request headers
 */
export function getAuthFromHeaders(req: Request) {
    const token = req.headers.get('x-activation-token');
    const fingerprint = req.headers.get('x-device-fingerprint');
    return { token, fingerprint };
}
