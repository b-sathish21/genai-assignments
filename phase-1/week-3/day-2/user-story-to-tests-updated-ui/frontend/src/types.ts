export interface GenerateRequest {
  storyTitle: string;
  summary: string;
  acceptanceCriteria: string;
  description?: string;
  additionalInfo?: string;
}

export interface TestCase {
  id: string;
  title: string;
  steps: string[];
  testData?: string;
  expectedResult: string;
  category: string;
}

export interface GenerateResponse {
  cases: TestCase[];
  model?: string;
  promptTokens: number;
  completionTokens: number;
}

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiKey: string;
}

export interface JiraTicket {
  issueKey: string;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  priority: string;
  assignee: string;
}

export interface JiraTicketsRequest {
  credentials: JiraCredentials;
  startAt: number;
  maxResults: number;
  search?: Record<string, string>;
  sortField?: keyof JiraTicket;
  sortDirection?: "asc" | "desc";
}

export interface JiraTicketsResponse {
  tickets: JiraTicket[];
  total: number;
  startAt: number;
  maxResults: number;
}
