import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { validateUUID } from '../middleware/validate.js';
import { deletePhoto } from '../lib/r2.js';
import threadRoutes from './threads.js';

const router = Router();

router.post('/', authenticate, async (req, res, next ) => {
    try{

    const { name, description} = req.body;
    const creatorId = req.user.id;

    if(!name || !description) return res.status(400).json({error: 'name and description is required'});

    // Slug: "My Cool Event" → "my-cool-event"
    // URL safe transform

    const slug = name.toLowerCase().trim()
                                        .replace(/\s+/g, '-')
                                        .replace(/[^a-z0-9-]/g, '')
                                        .replace(/-+/g, '-');

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

router.get('/', async (req, res, next) => {
    try {
        // Changes in scheme to have member_count , creating subquery for count isnt optimal.

        const result = await pool.query(
            `SELECT 
                id,
                name,
                slug,
                description,
                banner_url,
                member_count,
                created_at
            FROM communities ORDER BY created_at DESC`
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
            SELECT 
                id, 
                name, 
                slug, 
                description, 
                banner_url, 
                member_count, 
                created_at
            FROM communities WHERE slug = $1`,
            [slug]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({error: 'Community not found'});
        }

        res.json({ community: result.rows[0] });

    } catch (err) {
        next(err);
    }
});

router.post('/:id/join', authenticate, validateUUID('id'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        //Verify Existance of community
        const community = await pool.query(
            `SELECT id FROM communities WHERE id = $1`,[id]
        );

        if (community.rows.length === 0) return res.status(404).json({error: 'Community not found'});

        //On conflict DO NOTHING (idompotent rule)

        const result = await pool.query(`
            INSERT INTO community_members (user_id, community_id, role)
            VALUES ($1, $2, 'member')
            ON CONFLICT (user_id, community_id) DO NOTHING
            RETURNING user_id`,
        [userId,id]);

        if (result.rows.length > 0) {
            await pool.query(`
                UPDATE communities SET member_count = member_count + 1 WHERE id = $1`, [id]);
        }

        res.json({message: 'Joined successfully'});
    } catch(err) {
        next(err);
    }
});

// DELETE /api/communities/:id
// Only the community's creator may delete it. Deleting a community
// cascades in the DB (communities -> threads -> photos ->
// face_embeddings/photo_faces are all ON DELETE CASCADE in schema.sql),
// so the single DELETE below handles every row. The one thing Postgres
// can't clean up for us is the actual objects sitting in R2/B2/MinIO —
// storage_key/storage_key_thumb are just strings to the DB — so we fetch
// them first and delete the objects after the DB row is gone.
router.delete('/:id', authenticate, validateUUID('id'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const communityResult = await pool.query(
            `SELECT id, created_by FROM communities WHERE id = $1`,
            [id]
        );
        if (communityResult.rows.length === 0) {
            return res.status(404).json({ error: 'Community not found' });
        }
        if (communityResult.rows[0].created_by !== userId) {
            return res.status(403).json({ error: 'Only the community creator can delete this community' });
        }

        // Grab every photo's storage keys across every thread in this
        // community before the cascade deletes the rows out from under us.
        const photosResult = await pool.query(
            `SELECT p.storage_key, p.storage_key_thumb
             FROM photos p
             JOIN threads t ON t.id = p.thread_id
             WHERE t.community_id = $1`,
            [id]
        );

        await pool.query(`DELETE FROM communities WHERE id = $1`, [id]);

        // Best-effort object cleanup — DB is already consistent regardless.
        const cleanup = photosResult.rows.flatMap((p) => [
            deletePhoto(p.storage_key).catch((e) =>
                console.error(`[R2] cleanup failed for key ${p.storage_key}: ${e.message}`)
            ),
            deletePhoto(p.storage_key_thumb).catch((e) =>
                console.error(`[R2] cleanup failed for key ${p.storage_key_thumb}: ${e.message}`)
            ),
        ]);
        await Promise.all(cleanup);

        res.json({ message: 'Community deleted' });
    } catch (err) {
        next(err);
    }
});

router.use('/:communityId/threads', threadRoutes);

export default router;