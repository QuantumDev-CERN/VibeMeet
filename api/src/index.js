import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import communityRoutes from './routes/communities.js';
import threadRoutes from './routes/threads.js';
import photoRoutes from './routes/photos.js';
import searchRoutes from './routes/search.js';
import { isStorageHealthy } from './lib/storage.js';

dotenv.config();

const app = express();

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
}));

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/threads', threadRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/search', searchRoutes);

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const messages = {
            LIMIT_FILE_SIZE:  'File too large',
            LIMIT_FILE_COUNT: 'Too many files uploaded',
            LIMIT_FIELD_KEY:  'Field name too long',
            LIMIT_UNEXPECTED_FILE: 'Unexpected file field',
        };
        const message = messages[err.code] ?? err.message;
        return res.status(400).json({ error: message });
    }
    next(err);
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
    console.log(`API running on port ${PORT}`);

    const storage = await isStorageHealthy();
    if (storage.healthy) {
        console.log(`Storage OK — bucket "${storage.bucket}" at ${storage.endpoint}`);
    } else {
        console.warn(`Storage UNHEALTHY — uploads will fail: ${storage.error}`);
        console.warn('See docs/STORAGE.md for Backblaze B2 / MinIO setup.');
    }
});
