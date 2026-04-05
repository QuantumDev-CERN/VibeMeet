import jwt from 'jsonwebtoken';

export function authenticate(req, res, next){
    const header = req.header.authorization;

    if(!header || !header.startsWith('Bearer ')){
        return res.status(401).json({error: 'Missing or malformed token'});
    }

    const token = header.split(' ')[1];

    try{
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({error: 'Invalid or expired token'});
    }
}