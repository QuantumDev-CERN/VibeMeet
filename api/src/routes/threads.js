import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { validateUUID } from '../middleware/validate.js';
import { deletePhoto } from '../lib/storage.js';

const router = Router({ mergeParams: true});

router.post('/', authenticate, async(req, res, next) => {
   try {
    const { communityId } = req.params;
    const { title, description, event_date, location } = req.body;
    const userId = req.user.id;

    if (!title) return res.status(400).json({error: 'title is required'});

    const community = await pool.query(`
        SELECT id FROM communities WHERE id = $1
        `, [communityId]);
    
    if (community.rows.length === 0) return res.status(404).json({error: 'community not found'});

    const result = await pool.query(
        `INSERT INTO threads (community_id, created_by, title, description, event_date, location)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING * `,
        [communityId, userId, title, description ?? null, event_date ?? null, location ?? null]
    );

    res.status(201).json({ thread: result.rows[0]});
   } catch (err) {
    next(err);
   } 
});

router.get('/' ,async (req, res, next) => {
    try {
        const { communityId } = req.params;

        const community = await pool.query(`SELECT id FROM communities WHERE id =$1` , [communityId]);
        if (community.rows.length === 0) return res.status(404).json({error: 'no community found'});

        const result = await pool.query(`
            SELECT id, community_id, created_by, title, description, event_date, location, created_at
            FROM threads WHERE community_id = $1 ORDER BY created_at DESC`, [communityId] );
        res.json({ threads: result.rows});
    } catch (err) {
        next(err);
    }
});

router.get('/:id', validateUUID('id'), async(req, res, next) => {
    try{
        const { id } =req.params;

        const result = await pool.query(`
            SELECT id, community_id, created_by, title, description, event_date, location, created_at 
            FROM threads WHERE id = $1`,
            [id]);
        
        if (result.rows.length === 0) return res.status(404).json({error: 'Thread not Found'});

        res.json({thread: result.rows[0]});


    } catch (err) {
        next(err);
    }
});

router.delete('/:id', authenticate, validateUUID('id'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const threadResult = await pool.query(
            `SELECT id, created_by FROM threads WHERE id = $1`,
            [id]
        );
        if (threadResult.rows.length === 0) {
            return res.status(404).json({ error: 'Thread not found' });
        }
        if (threadResult.rows[0].created_by !== userId) {
            return res.status(403).json({ error: 'Only the thread creator can delete this thread' });
        }

        const photosResult = await pool.query(
            `SELECT storage_key, storage_key_thumb FROM photos WHERE thread_id = $1`,
            [id]
        );

        await pool.query(`DELETE FROM threads WHERE id = $1`, [id]);

        const cleanup = photosResult.rows.flatMap((p) => [
            deletePhoto(p.storage_key).catch((e) =>
                console.error(`[R2] cleanup failed for key ${p.storage_key}: ${e.message}`)
            ),
            deletePhoto(p.storage_key_thumb).catch((e) =>
                console.error(`[R2] cleanup failed for key ${p.storage_key_thumb}: ${e.message}`)
            ),
        ]);
        await Promise.all(cleanup);

        res.json({ message: 'Thread deleted' });
    } catch (err) {
        next(err);
    }
});

export default router;