import "dotenv/config";
import express from 'express';
import cors from 'cors';
import { clerkMiddleware, requireAuth } from '@clerk/express';
import connectCloudinary from "./configs/cloudinary.js";
import aiRouter from "./routes/aiRoutes.js";
import userRouter from "./routes/userRoutes.js";
import { auth } from './middlewares/auth.js';

const app = express();

// Connect to cloudinary
await connectCloudinary();

// Middleware
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(clerkMiddleware());

// Request logging middleware (for debugging)
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});

// Public routes
app.get('/', (req, res) => res.send("Server Is Live..."));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Protected routes
app.use('/api/ai', requireAuth(), auth, aiRouter);
app.use('/api/user', requireAuth(), auth, userRouter);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal Server Error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});