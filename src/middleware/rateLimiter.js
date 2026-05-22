import redisClient from '../config/redis.js';

export const tokenBucketLimiter = async (req, res, next) => {

    const ip = req.ip || req.connection.remoteAddress;
    const key = `rate:token:${ip}`;

    const capacity = 5;       // Max burst of 5 requests at once
    const refillRate = 1;     // Refill 1 token per second
    const windowSec = 60;     // Clean up Redis memory after 60 seconds of inactivity

    try {
        const data = await redisClient.hGetAll(key);
        const now = Math.floor(Date.now() / 1000);

        let tokens = capacity;
        let lastRefill = now;

        if (Object.keys(data).length > 0) {
            tokens = parseFloat(data.tokens);
            lastRefill = parseInt(data.lastRefill);

            const timePassed = now - lastRefill;
            tokens = Math.min(capacity, tokens + (timePassed * refillRate));
        }

        if (tokens < 1) {
            return res.status(429).json({ error: 'Too Many Requests. Please wait.' });
        }

        await redisClient.hSet(key, [
            'tokens', (tokens - 1).toString(),
            'lastRefill', now.toString()
        ]);

        await redisClient.expire(key, windowSec);

        next();

    } catch (error) {
        console.error('Rate Limiter Error:', error);
        
        next();
    }
};