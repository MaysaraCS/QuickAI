import connectDB from "./config/db.js";
import {} from "dotenv/config";
import { app } from "./app.js"
import { clerkMiddleware, requireAuth } from '@clerk/express'

import express from 'express';
import cors from 'cors';
import "dotenv/config";


const app = express();
app.use(cors())
app.use(express.json())
app.use(clerkMiddleware())


app.get('/', (req, res)=> res.send("Server Is Live..."))

app.use(requireAuth())

const PORT = process.env.PORT || 3000;

app.listen(PORT, ()=>{
    console.log(`Server is running on port ${PORT}`);
});
