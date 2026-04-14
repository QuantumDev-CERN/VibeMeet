import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

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

router.get('/:id', async(req, res, next) => {
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

export default router;