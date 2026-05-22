import { LRUCache } from 'lru-cache';

// L1 Cache: Extremely fast, but lives in Node.js RAM
const l1Cache = new LRUCache({
    max: 5000, // Store up to 5,000 URLs in memory
    ttl: 1000 * 60 * 1, // Time to live: 5 minutes
});

export default l1Cache;