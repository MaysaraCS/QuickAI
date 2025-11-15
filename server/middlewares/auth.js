import { clerkClient } from "@clerk/express";

// Middleware to check userId and hasPremiumPlan
export const auth = async (req, res, next) => {
    try {
        const { userId, has } = req.auth;
        
        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: "Unauthorized - Please sign in" 
            });
        }

        // Check for premium plan
        const hasPremiumPlan = await has({ plan: 'premium' });
        
        // Get user metadata (with retry logic for rate limits)
        let user;
        let retries = 3;
        while (retries > 0) {
            try {
                user = await clerkClient.users.getUser(userId);
                break;
            } catch (error) {
                if (error.status === 429 && retries > 1) {
                    console.log(`Rate limited, retrying... (${retries - 1} attempts left)`);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                    retries--;
                } else {
                    throw error;
                }
            }
        }

        if (!hasPremiumPlan) {
            if (user.privateMetadata?.free_usage !== undefined) {
                req.free_usage = user.privateMetadata.free_usage;
            } else {
                // Try to set initial free usage
                try {
                    await clerkClient.users.updateUserMetadata(userId, {
                        privateMetadata: { free_usage: 0 }
                    });
                    req.free_usage = 0;
                } catch (updateError) {
                    console.error('Failed to update user metadata:', updateError);
                    // Default to 0 if update fails
                    req.free_usage = 0;
                }
            }
        }
        
        req.plan = hasPremiumPlan ? 'premium' : 'free';
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        
        // Handle specific Clerk errors
        if (error.status === 429) {
            return res.status(429).json({ 
                success: false, 
                message: "Rate limit exceeded. Please wait a moment and try again. Consider upgrading to production Clerk keys."
            });
        }
        
        res.status(error.status || 500).json({ 
            success: false, 
            message: error.message || 'Authentication error' 
        });
    }
}