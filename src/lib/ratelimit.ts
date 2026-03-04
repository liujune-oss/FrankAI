import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

function makeRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

const redis = makeRedis();

// Chat: 10 requests / minute
const chatRatelimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '1 m'), prefix: 'rl:chat' })
  : null;

// Image generation: 5 requests / minute (more expensive)
const imageRatelimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '1 m'), prefix: 'rl:image' })
  : null;

export async function checkChatRateLimit(userId: string): Promise<{ limited: boolean }> {
  if (!chatRatelimit) return { limited: false };
  const { success } = await chatRatelimit.limit(userId);
  return { limited: !success };
}

export async function checkImageRateLimit(userId: string): Promise<{ limited: boolean }> {
  if (!imageRatelimit) return { limited: false };
  const { success } = await imageRatelimit.limit(userId);
  return { limited: !success };
}

// Keep backward-compat export (used by memory/sync — will be removed from that route)
export async function checkRateLimit(userId: string): Promise<{ limited: boolean }> {
  return checkChatRateLimit(userId);
}
