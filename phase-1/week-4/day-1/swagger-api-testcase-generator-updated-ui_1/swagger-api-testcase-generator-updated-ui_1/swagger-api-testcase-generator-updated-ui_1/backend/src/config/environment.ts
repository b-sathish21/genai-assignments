import "dotenv/config";
import { z } from "zod";

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(5),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  INCEPTION_API_KEY: z.string().trim().optional(),
  INCEPTION_BASE_URL: z.string().url().default("https://api.inceptionlabs.ai/v1"),
  INCEPTION_MODEL: z.string().trim().default("mercury-2.5"),
  INCEPTION_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  INCEPTION_MAX_COMPLETION_TOKENS: z.coerce.number().int().positive().default(8000),
  INCEPTION_REASONING_EFFORT: z.enum(["instant", "low", "medium", "high"]).optional(),
  MAX_TEST_CASES: z.coerce.number().int().positive().default(50)
});

export const env = EnvironmentSchema.parse(process.env);
export const llmEnabled = Boolean(env.INCEPTION_API_KEY && env.INCEPTION_MODEL);
