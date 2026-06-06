import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import communityRoutes from './routes/communities.js';
import threadRoutes from './routes/threads.js';
import photoRoutes from './routes/photos.js';
import searchRoutes from './routes/search.js';

dotenv.config();

const app = express();

app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/threads', threadRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/search', searchRoutes);

// Multer error handler — must come before the global error handler.
// Multer throws MulterError with specific codes for file size violations,
// unexpected field names, too many files etc.
// Without this they fall through to the global handler and return a
// confusing 500 instead of a clean 400.
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

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
