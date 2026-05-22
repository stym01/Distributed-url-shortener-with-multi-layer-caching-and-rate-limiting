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

        if (custom_alias) {
            const aliasCheck = await pool.query('SELECT id FROM urls WHERE custom_alias = $1', [custom_alias]);
            if (aliasCheck.rows.length > 0) {
                return res.status(400).json({ error: 'Custom alias is already taken' });
            }
            short_code = custom_alias;
        } else {
            short_code = nanoid(7);
        }

        // Generate Primary Key ID (We will replace this with Snowflake in V2)
        const id = nanoid(15); 

        
        const result = await pool.query(
            `INSERT INTO urls (id, original_url, short_code, custom_alias, expires_at)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [id, original_url, short_code, custom_alias || null, expires_at || null]
        );

        const savedUrl = result.rows[0];
        const fullShortUrl = `${process.env.BASE_URL}/${short_code}`;
        
        
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


const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const redirectUrl = async (req, res) => {
    const { shortCode } = req.params;

    try {

        const l1Result = l1Cache.get(shortCode);
        if (l1Result) {
            console.log(`[L1 CACHE HIT] ${shortCode}`);
            return res.redirect(l1Result);
        }

        const l2Result = await redisClient.get(`url:${shortCode}`);
        if (l2Result) {
            console.log(`[L2 CACHE HIT] ${shortCode}`);
            // Repopulate L1 cache for the next request
            l1Cache.set(shortCode, l2Result);
            return res.redirect(l2Result);
        }

        // stapmede
        const lockKey = `lock:${shortCode}`;

        const acquiredLock = await redisClient.set(lockKey, '1', { NX: true, EX: 5 });

        if (!acquiredLock) {

            console.log(`[STAMPEDE PREVENTED] Waiting for DB query to finish...`);
            await sleep(50);
            return redirectUrl(req, res); // Recursive retry
        }

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

        // Repopulate L2 (Redis) 
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
