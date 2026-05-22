import { LRUCache } from 'lru-cache';


const l1Cache = new LRUCache({
    max: 5000, // up to 5,000 URLs 
    ttl: 1000 * 60 * 5, // 5 minutes
});

export default l1Cache;