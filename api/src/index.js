import express from 'express';
import dotenv from'dotenv';

import authRoutes from './routes/auth.js';
//import userRoutes from './routes/users.js';
import communityRoutes from './routes/communities.js';
import threadRoutes from './routes/threads.js';
//import photoRoutes from './routes/photos.js';
//import searchRoutes from './routes/search.js';

dotenv.config();

const app = express();

app.use(express.json()); //Parse JSON bodies

//Routes
app.use('/api/auth', authRoutes);
//app.use('/api/users', userRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/threads', threadRoutes);
//app.use('/api/photos', photoRoutes);
//app.use('/api/search', searchRoutes);


//Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({error: err.message || 'Internal server Error'});
})


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));