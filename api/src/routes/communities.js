import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { validateUUID } from '../middleware/validate.js';
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

router.get('/:slug', authenticate,async (req, res, next) => {
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
        const community = result.rows[0];
        const member = await pool.query(
            `SELECT role FROM community_members WHERE user_id = $1 AND community_id = $2`,
            [req.user.id, community.id]
        );
        const is_member = member.rows.length > 0;
        const role = is_member ? member.rows[0].role : null;
        res.json({ community: { ...community, is_member, role } });

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

router.post('/:id/leave', authenticate, validateUUID('id'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const community = await pool.query(
            `SELECT id FROM communities WHERE id = $1`,[id]
        );

        if (community.rows.length === 0) return res.status(404).json({error: 'Community not found'});

        const member = await pool.query(
            `SELECT role FROM community_members WHERE user_id = $1 AND community_id = $2`,
            [userId, id]
        );

        if (member.rows.length === 0) {
            return res.status(400).json({ error: 'You are not a member of this community' });
        }
        if (member.rows[0].role === 'admin') {
            return res.status(403).json({ error: 'The community creator cannot leave the community' });
        }

        const result = await pool.query(
            `DELETE FROM community_members WHERE user_id = $1 AND community_id = $2 RETURNING user_id`,
            [userId, id]
        );

        if (result.rows.length > 0) {
            await pool.query(
                `UPDATE communities SET member_count = member_count - 1 WHERE id = $1`, [id]);
        }
        res.json({message: 'Left successfully'});
    } catch(err) {
        next(err);
    }
});



router.use('/:communityId/threads', threadRoutes);

export default router;