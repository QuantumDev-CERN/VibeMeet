import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import redis, { TTL, OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN, isRedisHealthy } from '../lib/redis.js';
import { sendOtpEmail } from '../lib/email.js';

const router = Router();
const EMAIL_RE = /^\S+@\S+\.\S+$/;

function pendingKey(email) {
    return `pending_register:${email.toLowerCase()}`;
}

function makeCode() {
    return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
}

function otpMatches(code, storedHash) {
    if (typeof storedHash !== 'string') return false;
    const given = Buffer.from(hashOtp(code), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    return given.length === stored.length && crypto.timingSafeEqual(given, stored);
}

async function readPending(email) {
    const raw = await redis.get(pendingKey(email));
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function savePending(email, pending, { refreshTtl }) {
    const value = JSON.stringify(pending);
    if (refreshTtl) {
        await redis.set(pendingKey(email), value, 'EX', TTL.OTP_PENDING);
    } else {
        await redis.set(pendingKey(email), value, 'KEEPTTL');
    }
}

function requireRedis(res) {
    if (!isRedisHealthy()) {
        res.status(503).json({ error: 'Verification service temporarily unavailable' });
        return false;
    }
    return true;
}

function signToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
}

router.post('/register/request', async (req, res, next) => {
    try {
        if (!requireRedis(res)) return;
        const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'username, email and password are required' });
        }
        if (!EMAIL_RE.test(email)) {
            return res.status(400).json({ error: 'Enter a valid email address' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const existing = await pool.query(
            'SELECT id FROM users WHERE LOWER(email) = $1 OR username = $2',
            [email, username]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email or username already in use' });
        }

        const pending = await readPending(email);
        if (pending) {
            const elapsedMs = Date.now() - (pending.last_sent_at || 0);
            if (elapsedMs < OTP_RESEND_COOLDOWN * 1000) {
                const retryAfter = Math.ceil((OTP_RESEND_COOLDOWN * 1000 - elapsedMs) / 1000);
                return res.status(429).json({
                    error: `A code was just sent. Wait ${retryAfter} seconds before requesting another.`,
                    retry_after: retryAfter,
                });
            }
        }

        const passwordHash = await bcrypt.hash(password, 12); // 12 -> salt rounds secure
        const code = makeCode();
        try {
            await sendOtpEmail(email, code);
        } catch (err) {
            return res.status(err.status || 502).json({
                error: err.message || 'Could not send verification email. Try again.',
            });
        }
        await savePending(
            email,
            {
                username,
                email,
                password_hash: passwordHash,
                otp_hash: hashOtp(code),
                attempts: 0,
                last_sent_at: Date.now(),
            },
            { refreshTtl: true }
        );
        res.json({ email });
    } catch (err) {
        next(err);
    }
});

router.post('/register/verify', async (req, res, next) => {
    try {
        if (!requireRedis(res)) return;
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

        if (!email || !code) {
            return res.status(400).json({ error: 'email and code are required' });
        }
        if (!/^\d{6}$/.test(code)) {
            return res.status(400).json({ error: 'Enter the 6-digit code' });
        }

        const pending = await readPending(email);
        if (!pending) {
            return res.status(410).json({ error: 'Code expired. Start again from the register page.' });
        }

        if (!otpMatches(code, pending.otp_hash)) {
            const attempts = (pending.attempts || 0) + 1;
            if (attempts >= OTP_MAX_ATTEMPTS) {
                const newCode = makeCode();
                try {
                    await sendOtpEmail(email, newCode);
                } catch (err) {
                    await savePending(email, { ...pending, attempts }, { refreshTtl: false });
                    return res.status(err.status || 502).json({
                        error: 'Could not send a new code. Try resending in a moment.',
                    });
                }
                await savePending(
                    email,
                    { ...pending, otp_hash: hashOtp(newCode), attempts: 0, last_sent_at: Date.now() },
                    { refreshTtl: true }
                );
                return res.status(400).json({
                    error: 'Too many tries — a new code has been sent to your email.',
                    new_code_sent: true,
                    attempts_left: OTP_MAX_ATTEMPTS,
                });
            }
            await savePending(email, { ...pending, attempts }, { refreshTtl: false });
            const left = OTP_MAX_ATTEMPTS - attempts;
            return res.status(400).json({
                error: `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
                attempts_left: left,
            });
        }
        const existing = await pool.query(
            'SELECT id FROM users WHERE LOWER(email) = $1 OR username = $2',
            [pending.email, pending.username]
        );
        if (existing.rows.length > 0) {
            await redis.del(pendingKey(email));
            return res.status(409).json({ error: 'Email or username already in use' });
        }

        const result = await pool.query(
            `INSERT INTO users (username, email, password)
             VALUES ($1, $2, $3)
             RETURNING id, username, email, created_at`,
            [pending.username, pending.email, pending.password_hash]
        );
        const user = result.rows[0];
        await redis.del(pendingKey(email));
        res.status(201).json({ token: signToken(user), user });
    } catch (err) {
        next(err);
    }
});

router.post('/register/resend', async (req, res, next) => {
    try {
        if (!requireRedis(res)) return;
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        if (!email) {
            return res.status(400).json({ error: 'email is required' });
        }

        const pending = await readPending(email);
        if (!pending) {
            return res.status(410).json({ error: 'Code expired. Start again from the register page.' });
        }

        const elapsedMs = Date.now() - (pending.last_sent_at || 0);
        if (elapsedMs < OTP_RESEND_COOLDOWN * 1000) {
            const retryAfter = Math.ceil((OTP_RESEND_COOLDOWN * 1000 - elapsedMs) / 1000);
            return res.status(429).json({
                error: `Wait ${retryAfter} seconds before resending.`,
                retry_after: retryAfter,
            });
        }

        const newCode = makeCode();
        try {
            await sendOtpEmail(email, newCode);
        } catch (err) {
            return res.status(err.status || 502).json({
                error: err.message || 'Could not send verification email. Try again.',
            });
        }

        await savePending(
            email,
            { ...pending, otp_hash: hashOtp(newCode), attempts: 0, last_sent_at: Date.now() },
            { refreshTtl: true }
        );
        res.json({ email, message: 'New code sent' });
    } catch (err) {
        next(err);
    }
});

router.post('/login', async (req, res, next) => {
    try {
        const { email, password: inputpassword } = req.body;

        if (!email || !inputpassword) {
            return res.status(400).json({ error: 'email and password are required' });
        }

        const result = await pool.query(
            'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(inputpassword, user.password);

        if (!valid) {
            return res.status(401).json({ error: 'Invalid Credentials' });
        }

        const token = signToken(user);
        const { password, ...safeUser } = user;
        res.json({ token, user: safeUser });
    } catch (err) {
        next(err);
    }
});

export default router;
