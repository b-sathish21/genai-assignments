import {
  GenerateRequest,
  GenerateResponse,
  JiraCredentials,
  JiraTicketsRequest,
  JiraTicketsResponse,
} from "./types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8081/api";

export async function generateTests(
  request: GenerateRequest,
): Promise<GenerateResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/generate-tests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`,
      );
    }

    const data: GenerateResponse = await response.json();
    return data;
  } catch (error) {
    console.error("Error generating tests:", error);
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

async function jiraRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/jira${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({ error: "Unknown error" }));
  if (!response.ok) {
    throw new Error(
      data.error || `Jira request failed with status ${response.status}`,
    );
  }

  return data as T;
}

export function validateJiraCredentials(
  credentials: JiraCredentials,
): Promise<{ valid: boolean }> {
  return jiraRequest<{ valid: boolean }>("/validate", credentials);
}

export function fetchJiraTickets(
  request: JiraTicketsRequest,
): Promise<JiraTicketsResponse> {
  const { credentials, ...ticketRequest } = request;
  return jiraRequest<JiraTicketsResponse>("/tickets", {
    ...credentials,
    ...ticketRequest,
  });
}
