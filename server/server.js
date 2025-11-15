import "dotenv/config";
import express from 'express';
import cors from 'cors';
import { clerkMiddleware, requireAuth } from '@clerk/express';
import connectDB from "./configs/db.js";
import connectCloudinary from "./configs/cloudinary.js";
import aiRouter from "./routes/aiRoutes.js";
import userRouter from "./routes/userRoutes.js";
import { auth } from './middlewares/auth.js';

const app = express();  // ✅ ADD THIS LINE

// Connect to database and cloudinary
await connectDB();
await connectCloudinary();

// Middleware
app.use(cors());
app.use(express.json());
app.use(clerkMiddleware());

// Public routes
app.get('/', (req, res) => res.send("Server Is Live..."));

// Protected routes
app.use('/api/ai', requireAuth(), auth, aiRouter);
app.use('/api/user', requireAuth(), auth, userRouter);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});