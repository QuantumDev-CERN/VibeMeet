import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { validateUUID } from '../middleware/validate.js';
import { deletePhoto } from '../lib/storage.js';
import threadRoutes from './threads.js';

const router = Router();
router.post('/', authenticate, async (req, res, next ) => {
    try{
    const { name, description} = req.body;
    const creatorId = req.user.id;
    if(!name || !description) return res.status(400).json({error: 'name and description is required'});
    const slug = name.toLowerCase().trim()
                                        .replace(/\s+/g, '-')
                                        .replace(/[^a-z0-9-]/g, '')
                                        .replace(/-+/g, '-');
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
        await client.query(`
            INSERT INTO community_members (user_id, community_id, role)
            VALUES ($1, $2, 'admin')`,
            [creatorId, community.id]
        );
        await client.query('COMMIT');
        res.status(201).json({ community });
     } catch (err) {
        await client.query('ROLLBACK');
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
        const community = await pool.query(
            `SELECT id FROM communities WHERE id = $1`,[id]
        );

        if (community.rows.length === 0) return res.status(404).json({error: 'Community not found'});

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
        const photosResult = await pool.query(
            `SELECT p.storage_key, p.storage_key_thumb
             FROM photos p
             JOIN threads t ON t.id = p.thread_id
             WHERE t.community_id = $1`,
            [id]
        );
        await pool.query(`DELETE FROM communities WHERE id = $1`, [id]);
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