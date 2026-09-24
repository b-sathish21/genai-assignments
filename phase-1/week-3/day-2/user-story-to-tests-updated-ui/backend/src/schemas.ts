import { z } from "zod";

export const GenerateRequestSchema = z.object({
  storyTitle: z.string().min(1, "Story title is required"),
  summary: z.string().min(1, "Summary is required"),
  acceptanceCriteria: z.string().min(1, "Acceptance criteria is required"),
  description: z.string().optional(),
  additionalInfo: z.string().optional(),
});

export const TestCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  steps: z.array(z.string()),
  testData: z.string().optional(),
  expectedResult: z.string(),
  category: z.string(),
});

export const GenerateResponseSchema = z.object({
  cases: z.array(TestCaseSchema),
  model: z.string().optional(),
  promptTokens: z.number(),
  completionTokens: z.number(),
});

export const JiraCredentialsSchema = z.object({
  baseUrl: z.string().url(),
  email: z.string().email(),
  apiKey: z.string().min(1),
});

export const JiraTicketsRequestSchema = JiraCredentialsSchema.extend({
  startAt: z.number().int().min(0),
  maxResults: z.number().int().min(1).max(100),
  search: z.record(z.string()).optional(),
  sortField: z
    .enum([
      "issueKey",
      "summary",
      "description",
      "acceptanceCriteria",
      "priority",
      "assignee",
    ])
    .optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
});

// Type exports
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;
export type JiraCredentials = z.infer<typeof JiraCredentialsSchema>;
