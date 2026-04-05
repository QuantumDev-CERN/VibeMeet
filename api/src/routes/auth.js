import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool  from '../db.js';

const router = Router();

// POST /api/auth/register

router.post('/register', async (req, res, next) => {
    try {
        const { username, email, password } = req.body;

        if(!username || !email || !password) {
            return res.status(400).json({
                error: 'username, email and password are required'
            })
        }

        // Check if email or username already taken
        const existing = await pool.query(
            'SELECT id FROM users WHERE email = $1 OR username = $2',
            [email,username]
        );

        if (existing.rows.length>0) {
            return res.status(409).json({error: 'Email or username already in use'})
        }

        const hash = await bcrypt.hash(password, 12); //12-> salt rounds secure

        const result = await pool.query(
            `INSERT INTO users (username, email, password)
            VALUES ($1, $2, $3)
            RETURNING id, username, email, created_at`,
            [username, email, hash]
        );

        const user = result.rows[0];

        const token = jwt.sign(
            {id: user.id, username: user.username, email: user.email},
            process.env.JWT_SECRET,
            { expiresIn: '7d'}
        );

        res.status(201).json({ token, user});
    } catch(err) {
        next(err);
    }

});

// POST /api/auth/login
router.post('/login', async(req, res, next) => {
    try {
        const {email, password: inputpassword} = req.body;

        if(!email || !inputpassword) {
            return res.status(400).json({error: 'email and password are required'});
        }

        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({error: 'Invalid credentials'});
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(inputpassword, user.password);

        if (!valid) {
            return res.status(401).json({error: 'Invalid Credentials'});
        }

        const token = jwt.sign(
            {id: user.id, username: user.username, email: user.email},
            process.env.JWT_SECRET,
            {expiresIn: '7d'}
        );

        // Dont send Password_hash back
        const {password, ...safeUser} = user;

        res.json({token, user:safeUser});
    } catch (err) {
        next(err);
    }
});
export default router;