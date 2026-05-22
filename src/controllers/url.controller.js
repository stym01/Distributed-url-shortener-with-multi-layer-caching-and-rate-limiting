import { nanoid } from 'nanoid';
import pool from '../config/db.js';
import { generateQRCode } from '../utils/qrcode.js';


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

export const redirectUrl = async (req, res) => {
    const { shortCode } = req.params;

    try {
        const result = await pool.query('SELECT original_url, expires_at FROM urls WHERE short_code = $1', [shortCode]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'URL not found' });
        }

        const urlData = result.rows[0];

        // Check for expiry
        if (urlData.expires_at && new Date() > new Date(urlData.expires_at)) {
            return res.status(410).json({ error: 'This URL has expired' });
        }

        // Redirect to original URL
        res.redirect(urlData.original_url);

    } catch (error) {
        console.error('Error redirecting:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};