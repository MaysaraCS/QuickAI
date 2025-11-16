import OpenAI from "openai";
import sql from "../configs/db.js";
import axios from 'axios';
import { v2 as cloudinary } from 'cloudinary';
import { clerkClient } from '@clerk/express';
import fs from 'fs';
import FormData from 'form-data';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

const AI = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});

// ============ RATE LIMITING QUEUE ============
class RateLimiter {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.lastRequestTime = 0;
        this.minDelay = 5000; // 5 seconds between requests (safer than 4s)
        this.requestCount = 0;
        this.dailyLimit = 1400;
        this.resetTime = Date.now() + 24 * 60 * 60 * 1000;
    }

    async add(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;

        while (this.queue.length > 0) {
            // Check daily limit
            if (Date.now() > this.resetTime) {
                this.requestCount = 0;
                this.resetTime = Date.now() + 24 * 60 * 60 * 1000;
            }

            if (this.requestCount >= this.dailyLimit) {
                const item = this.queue.shift();
                item.reject(new Error('Daily API limit reached. Please try again tomorrow.'));
                continue;
            }

            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            
            if (timeSinceLastRequest < this.minDelay) {
                const waitTime = this.minDelay - timeSinceLastRequest;
                console.log(`Rate limiting: waiting ${waitTime}ms before next request`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            const item = this.queue.shift();
            
            try {
                this.lastRequestTime = Date.now();
                this.requestCount++;
                const result = await item.fn();
                item.resolve(result);
            } catch (error) {
                item.reject(error);
            }

            // Add buffer between requests
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        this.processing = false;
    }
}

const rateLimiter = new RateLimiter();

// Helper function to call AI with rate limiting and better error handling
const callAIWithRateLimit = async (params) => {
    return rateLimiter.add(async () => {
        let retries = 0;
        const maxRetries = 3;
        
        while (retries < maxRetries) {
            try {
                const response = await AI.chat.completions.create(params);
                return response;
            } catch (error) {
                if (error.status === 429) {
                    retries++;
                    const waitTime = Math.pow(2, retries) * 5000; // 5s, 10s, 20s
                    console.log(`429 error (attempt ${retries}/${maxRetries}), waiting ${waitTime}ms...`);
                    
                    if (retries < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                }
                throw error;
            }
        }
    });
};

export const generateArticle = asyncHandler(async (req, res) => {
    try {
        const authData = await req.auth();
        const { userId } = authData;
        
        const { prompt, length } = req.body;
        const plan = req.plan;
        const free_usage = req.free_usage;

        if (plan !== 'premium' && free_usage >= 10) {
            return res.json({ success: false, message: "Free plan limit reached. Please upgrade to premium plan." });
        }

        const response = await callAIWithRateLimit({
            model: "gemini-2.0-flash-exp",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: 0.7,
            max_tokens: length,
        });

        const content = response.choices[0]?.message?.content;
        await sql`INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, ${prompt}, ${content}, 'article')`;

        if (plan !== 'premium') {
            await clerkClient.users.updateUserMetadata(userId, {
                privateMetadata: {
                    free_usage: free_usage + 1
                }
            });
        }
        res.json({ success: true, content });
    } catch (error) {
        console.log('Generate article error:', error.message);
        
        if (error.message.includes('Daily API limit')) {
            return res.json({ 
                success: false, 
                message: "Daily API limit reached. Please try again tomorrow." 
            });
        }
        
        if (error.status === 429) {
            return res.json({ 
                success: false, 
                message: "Rate limit exceeded. Your account may have hit Google's daily quota. Please wait 5-10 minutes and try again, or try again tomorrow." 
            });
        }
        
        res.json({ success: false, message: error.message || "Failed to generate article" });
    }
});

export const generateBlogTitle = asyncHandler(async (req, res) => {
    try {
        const authData = await req.auth();
        const { userId } = authData;
        
        const { prompt } = req.body;
        const plan = req.plan;
        const free_usage = req.free_usage;

        if (plan !== 'premium' && free_usage >= 10) {
            return res.json({ success: false, message: "Free plan limit reached. Please upgrade to premium plan." });
        }

        const response = await callAIWithRateLimit({
            model: "gemini-2.0-flash-exp",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: 0.7,
            max_tokens: 100,
        });

        const content = response.choices[0]?.message?.content;

        await sql`INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, ${prompt}, ${content}, 'blog-title')`;

        if (plan !== 'premium') {
            await clerkClient.users.updateUserMetadata(userId, {
                privateMetadata: {
                    free_usage: free_usage + 1
                }
            });
        }
        res.json({ success: true, content });
    } catch (error) {
        console.log('Generate blog title error:', error.message);
        
        if (error.message.includes('Daily API limit')) {
            return res.json({ 
                success: false, 
                message: "Daily API limit reached. Please try again tomorrow." 
            });
        }
        
        if (error.status === 429) {
            return res.json({ 
                success: false, 
                message: "Rate limit exceeded. Your account may have hit Google's daily quota. Please wait 5-10 minutes and try again, or try again tomorrow." 
            });
        }
        
        res.json({ success: false, message: error.message || "Failed to generate blog title" });
    }
});

export const generateImage = asyncHandler(async (req, res) => {
    try {
        const authData = await req.auth();
        const { userId } = authData;
        
        const { prompt, publish } = req.body;
        const plan = req.plan;

        if (plan !== 'premium') {
            return res.json({ success: false, message: "This feature is only available for premium subscriptions." });
        }

        // Check if API key is configured
        if (!process.env.CLIPDROP_API_KEY) {
            return res.json({ 
                success: false, 
                message: "Image generation is not configured. Please contact administrator." 
            });
        }

        const formData = new FormData();
        formData.append('prompt', prompt);
        
        try {
            const response = await axios.post("https://clipdrop-api.co/text-to-image/v1", formData, {
                headers: { 
                    'x-api-key': process.env.CLIPDROP_API_KEY,
                    ...formData.getHeaders()
                },
                responseType: "arraybuffer",
                timeout: 30000 // 30 second timeout
            });

            const base64Image = `data:image/png;base64,${Buffer.from(response.data).toString('base64')}`;

            const { secure_url } = await cloudinary.uploader.upload(base64Image);

            await sql`INSERT INTO creations (user_id, prompt, content, type, publish) 
            VALUES (${userId}, ${prompt}, ${secure_url}, 'image', ${publish ?? false})`;

            res.json({ success: true, content: secure_url });
        } catch (apiError) {
            if (apiError.response?.status === 403) {
                console.error('ClipDrop API 403 error - Invalid or expired API key');
                return res.json({ 
                    success: false, 
                    message: "Image generation service is unavailable. The API key may be invalid or expired. Please contact support." 
                });
            }
            throw apiError;
        }
    } catch (error) {
        console.log('Generate image error:', error.message);
        res.json({ success: false, message: error.response?.data?.error || error.message || "Failed to generate image" });
    }
});

export const removeImageBackground = asyncHandler(async (req, res) => {
    try {
        const authData = await req.auth();
        const { userId } = authData;
        
        const image = req.file;
        const plan = req.plan;

        if (plan !== 'premium') {
            return res.json({ success: false, message: "This feature is only available for premium subscriptions." });
        }

        if (!image) {
            return res.json({ success: false, message: "No image file uploaded." });
        }

        const { secure_url } = await cloudinary.uploader.upload(image.path, {
            transformation: [
                {
                    effect: 'background_removal',
                    background_removal: 'remove_the_background'
                }
            ]
        });

        // Clean up uploaded file
        fs.unlinkSync(image.path);

        await sql`INSERT INTO creations (user_id, prompt, content, type) 
        VALUES (${userId}, 'Remove background from image', ${secure_url}, 'image')`;

        res.json({ success: true, content: secure_url });
        
    } catch (error) {
        console.log('Remove background error:', error.message);
        res.json({ success: false, message: error.message });
    }
});

export const removeImageObject = asyncHandler(async (req, res) => {
    try {
        const authData = await req.auth();
        const { userId } = authData;
        
        const { object } = req.body;
        const image = req.file;
        const plan = req.plan;

        if (plan !== 'premium') {
            return res.json({ success: false, message: "This feature is only available for premium subscriptions." });
        }

        if (!image) {
            return res.json({ success: false, message: "No image file uploaded." });
        }

        if (!object) {
            return res.json({ success: false, message: "Please specify the object to remove." });
        }

        const { public_id } = await cloudinary.uploader.upload(image.path);
        
        // Clean up uploaded file
        fs.unlinkSync(image.path);

        const imageUrl = cloudinary.url(public_id, {
            transformation: [{ effect: `gen_remove:${object}` }],
            resource_type: 'image',
        });

        await sql`INSERT INTO creations (user_id, prompt, content, type) 
            VALUES (${userId}, ${`Removed ${object} from image`}, ${imageUrl}, 'image')`;

        res.json({ success: true, content: imageUrl });

    } catch (error) {
        console.log('Remove object error:', error.message);
        res.json({ success: false, message: error.message });
    }
});

export const resumeReview = asyncHandler(async (req, res) => {
    try {
        const authData = await req.auth();
        const { userId } = authData;
        
        const resume = req.file;
        const plan = req.plan;

        if (plan !== 'premium') {
            return res.json({ success: false, message: "This feature is only available for premium subscriptions." });
        }

        if (!resume) {
            return res.json({ success: false, message: "No resume file uploaded." });
        }

        if (resume.size > 5 * 1024 * 1024) {
            return res.json({ success: false, message: "File size exceeds 5MB limit." });
        }

        // Read PDF file
        const dataBuffer = fs.readFileSync(resume.path);
        
        // Parse PDF - FIXED: Use default import correctly
        const pdfData = await pdfParse(dataBuffer);
        
        // Clean up uploaded file
        fs.unlinkSync(resume.path);

        const prompt = `Review the following resume and provide constructive feedback on its strengths, weaknesses, and areas for improvement. Resume Content:\n\n${pdfData.text}`;

        const response = await callAIWithRateLimit({
            model: "gemini-2.0-flash-exp",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: 0.7,
            max_tokens: 1000,
        });

        const content = response.choices[0]?.message?.content;

        await sql`INSERT INTO creations (user_id, prompt, content, type) 
            VALUES (${userId}, 'Review the uploaded resume', ${content}, 'resume-review')`;

        res.json({ success: true, content });

    } catch (error) {
        console.log('Resume review error:', error.message);
        
        if (error.message.includes('Daily API limit')) {
            return res.json({ 
                success: false, 
                message: "Daily API limit reached. Please try again tomorrow." 
            });
        }
        
        if (error.status === 429) {
            return res.json({ 
                success: false, 
                message: "Rate limit exceeded. Your account may have hit Google's daily quota. Please wait 5-10 minutes and try again, or try again tomorrow." 
            });
        }
        
        res.json({ success: false, message: error.message || "Failed to review resume" });
    }
});