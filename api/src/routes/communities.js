import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/', authenticate, async (req, res, next ) => {
    try{

    const { name, description} = req.body;
    const creatorId = req.user.id;

    if(!name || !description) return res.status(400).json({error: 'name and description is required'});

    // Slug: "My Cool Event" → "my-cool-event"
    // URL safe transform

    const slug = name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

     //If the community_members insert fails, the community row is rolled back.
     const client = await pool.connect();
     try {
        await client.query('BEGIN');

        const communityResult = await client.query(
            `INSERT INTO communities (name, slug, description, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name, slug, description, created_at             
            `,
            [name, slug, description, creatorId]
        );

        const community = communityResult.rows[0];

        //Creater auto-rejoin as admin (same connection)
        await client.query(`
            INSERT INTO community_members (user_id, community_id, role)
            VALUES ($1, $2, 'admin')`,
            [creatorId, community.id]
        );

        await client.query('COMMIT');
        res.status(201).json({ community });

     } catch (err) {
        await client.query('ROLLBACK');
        // Postgres unique violation code — slug or name collision
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Community name already taken'})
        }
        throw err;
     } finally {
        client.release();
     }

    } catch (err) {
        next(err);
    }
});

router.get('/', authenticate, async (req, res, next) => {
    try {
        // Changes in scheme to have member_count , creating subquery for count isnt optimal.

        const result = await pool.query(
            `SELECT
            c.id, c.name, c.slug, c.description, c.banner_url, c.created_at,
            (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id)
            AS member_count FROM communities c
            ORDER BY c.created_at DESC`
        );
        res.json({ communities: result.rows});

    } catch(err) {
        next(err)
    }
});

router.get('/:slug', async (req, res, next) => {
    try{
        const { slug } = req.params;

        const result = await pool.query(`
            SELECT c.id, c.name, c.description, c.banner_url, c.created_at,
            (SELECT COUNT (*) FROM community_members cm WHERE cm.community_id = c.id) AS member_count
            FROM communities c WHERE c.slug = $1
            `,[slug]);
        
        if (results.rows.length === 0) {
            return res.status(404).json({error: 'Community not found'});
        }

        res.json({ community: result.rows[0] });

    } catch (err) {
        next(err);
    }
});