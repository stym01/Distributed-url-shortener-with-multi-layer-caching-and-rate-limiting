import { nanoid } from 'nanoid';
import pool from '../config/db.js';
import { generateQRCode } from '../utils/qrcode.js';


import redisClient from '../config/redis.js';
import l1Cache from '../config/lru.js';

export const createShortUrl = async (req, res) => {
    const { original_url, custom_alias, expires_at } = req.body;

    if (!original_url) {
        return res.status(400).json({ error: 'original_url is required' });
    }

    try {
        let short_code;

        // Handle Custom Alias
        if (custom_alias) {
            const aliasCheck = await pool.query('SELECT id FROM urls WHERE custom_alias = $1', [custom_alias]);
            if (aliasCheck.rows.length > 0) {
                return res.status(400).json({ error: 'Custom alias is already taken' });
            }
            short_code = custom_alias;
        } else {
            // Default: Generate a 7-character nanoid for the short link
            short_code = nanoid(7);
        }

        // Generate Primary Key ID (We will replace this with Snowflake in V2)
        const id = nanoid(15); 

        // Insert into Database
        const result = await pool.query(
            `INSERT INTO urls (id, original_url, short_code, custom_alias, expires_at)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [id, original_url, short_code, custom_alias || null, expires_at || null]
        );

        const savedUrl = result.rows[0];
        const fullShortUrl = `${process.env.BASE_URL}/${short_code}`;
        
        // Generate QR Code
        const qrCodeBase64 = await generateQRCode(fullShortUrl);

        res.status(201).json({
            message: 'URL shortened successfully',
            data: {
                ...savedUrl,
                short_url: fullShortUrl,
                qr_code: qrCodeBase64
            }
        });

    } catch (error) {
        console.error('Error creating short URL:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Helper function to wait/sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const redirectUrl = async (req, res) => {
    const { shortCode } = req.params;

    try {
        // ==========================================
        // LAYER 1: Check L1 (In-Memory LRU Cache)
        // Speed: ~0.01 milliseconds
        // ==========================================
        const l1Result = l1Cache.get(shortCode);
        if (l1Result) {
            console.log(`[L1 CACHE HIT] ${shortCode}`);
            return res.redirect(l1Result);
        }

        // ==========================================
        // LAYER 2: Check L2 (Redis)
        // Speed: ~1-5 milliseconds
        // ==========================================
        const l2Result = await redisClient.get(`url:${shortCode}`);
        if (l2Result) {
            console.log(`[L2 CACHE HIT] ${shortCode}`);
            // Repopulate L1 cache for the next request
            l1Cache.set(shortCode, l2Result);
            return res.redirect(l2Result);
        }

        // ==========================================
        // CACHE STAMPEDE PREVENTION (The Lock)
        // ==========================================
        const lockKey = `lock:${shortCode}`;
        // SETNX: Set If Not Exists. 
        // EX 5: Lock expires in 5 seconds automatically to prevent deadlocks
        const acquiredLock = await redisClient.set(lockKey, '1', { NX: true, EX: 5 });

        if (!acquiredLock) {
            // Another request is currently querying the DB.
            // Wait 50ms and try the whole process again.
            console.log(`[STAMPEDE PREVENTED] Waiting for DB query to finish...`);
            await sleep(50);
            return redirectUrl(req, res); // Recursive retry
        }

        // ==========================================
        // LAYER 3: Fallback to DB (PostgreSQL)
        // Speed: ~10-50 milliseconds
        // ==========================================
        console.log(`[DB QUERY] Fetching ${shortCode} from database`);
        const result = await pool.query('SELECT original_url, expires_at FROM urls WHERE short_code = $1', [shortCode]);

        if (result.rows.length === 0) {
            await redisClient.del(lockKey); // Release lock
            return res.status(404).json({ error: 'URL not found' });
        }

        const urlData = result.rows[0];

        if (urlData.expires_at && new Date() > new Date(urlData.expires_at)) {
            await redisClient.del(lockKey); // Release lock
            return res.status(410).json({ error: 'This URL has expired' });
        }

        const originalUrl = urlData.original_url;

        // Repopulate L2 (Redis) - Set to expire in 1 hour
        await redisClient.set(`url:${shortCode}`, originalUrl, { EX: 3600 });
        
        // Repopulate L1 (LRU)
        l1Cache.set(shortCode, originalUrl);

        // Release the lock now that caches are warm!
        await redisClient.del(lockKey);

        res.redirect(originalUrl);

    } catch (error) {
        console.error('Error redirecting:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};





//for without multilevel caching
// export const redirectUrl = async (req, res) => {
//     const { shortCode } = req.params;

//     try {
//         const result = await pool.query('SELECT original_url, expires_at FROM urls WHERE short_code = $1', [shortCode]);

//         if (result.rows.length === 0) {
//             return res.status(404).json({ error: 'URL not found' });
//         }

//         const urlData = result.rows[0];

//         // Check for expiry
//         if (urlData.expires_at && new Date() > new Date(urlData.expires_at)) {
//             return res.status(410).json({ error: 'This URL has expired' });
//         }

//         // Redirect to original URL
//         res.redirect(urlData.original_url);

//     } catch (error) {
//         console.error('Error redirecting:', error);
//         res.status(500).json({ error: 'Internal server error' });
//     }
// };