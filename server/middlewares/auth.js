import { clerkClient } from "@clerk/express";

// Simple in-memory cache to reduce Clerk API calls
const userCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Middleware to check userId and hasPremiumPlan
export const auth = async (req, res, next) => {
    try {
        // Call req.auth() as a function (NEW API)
        const authData = await req.auth();
        const { userId, has } = authData;
        
        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: "Unauthorized - Please sign in" 
            });
        }

        // Check cache first to reduce API calls
        const cached = userCache.get(userId);
        const now = Date.now();
        
        if (cached && (now - cached.timestamp) < CACHE_DURATION) {
            console.log('Using cached user data for:', userId);
            req.plan = cached.plan;
            req.free_usage = cached.free_usage;
            return next();
        }

        // Check for premium plan
        const hasPremiumPlan = await has({ plan: 'premium' });
        
        let free_usage = 0;
        
        if (!hasPremiumPlan) {
            try {
                const user = await clerkClient.users.getUser(userId);
                
                if (user.privateMetadata?.free_usage !== undefined) {
                    free_usage = user.privateMetadata.free_usage;
                } else {
                    await clerkClient.users.updateUserMetadata(userId, {
                        privateMetadata: { free_usage: 0 }
                    });
                    free_usage = 0;
                }
            } catch (error) {
                console.error('Failed to fetch user metadata:', error);
                // Use default value if Clerk API fails
                free_usage = 0;
            }
        }
        
        const plan = hasPremiumPlan ? 'premium' : 'free';
        
        // Cache the result
        userCache.set(userId, {
            plan,
            free_usage,
            timestamp: now
        });
        
        req.plan = plan;
        req.free_usage = free_usage;
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        
        // Handle specific Clerk errors
        if (error.status === 429) {
            return res.status(429).json({ 
                success: false, 
                message: "Rate limit exceeded. Please wait a moment and try again."
            });
        }
        
        res.status(error.status || 500).json({ 
            success: false, 
            message: error.message || 'Authentication error' 
        });
    }
}

// Clear stale cache entries periodically (every 10 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [userId, data] of userCache.entries()) {
        if (now - data.timestamp > CACHE_DURATION) {
            userCache.delete(userId);
        }
    }
}, 10 * 60 * 1000);