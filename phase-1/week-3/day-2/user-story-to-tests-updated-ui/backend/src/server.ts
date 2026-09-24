import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { generateRouter } from "./routes/generate";
import { jiraRouter } from "./routes/jira";

// Load environment variables from root directory
const envPath = path.join(__dirname, "../../.env");
console.log(`Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });

// Debug environment variables
console.log("Environment variables loaded:");
console.log(`PORT: ${process.env.PORT}`);
console.log(`CORS_ORIGIN: ${process.env.CORS_ORIGIN}`);
console.log(`groq_API_BASE: ${process.env.groq_API_BASE}`);
console.log(`groq_API_KEY: ${process.env.groq_API_KEY ? "SET" : "NOT SET"}`);
console.log(`groq_MODEL: ${process.env.groq_MODEL}`);

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// API routes
app.use("/api/generate-tests", generateRouter);
app.use("/api/jira", jiraRouter);

// Error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error("Error:", err.message);
    res.status(500).json({
      error:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
    });
  },
);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
  console.log(`🔍 Health check at http://localhost:${PORT}/api/health`);
});
