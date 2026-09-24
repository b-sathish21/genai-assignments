import fetch from "node-fetch";
import { JiraCredentials } from "../schemas";

export interface JiraTicket {
  issueKey: string;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  priority: string;
  assignee: string;
}

export interface JiraTicketPage {
  tickets: JiraTicket[];
  total: number;
  startAt: number;
  maxResults: number;
}

interface JiraIssue {
  key?: string;
  fields?: Record<string, unknown>;
}

interface JiraSearchResponse {
  issues?: JiraIssue[];
  total?: number;
  startAt?: number;
  maxResults?: number;
  isLast?: boolean;
  nextPageToken?: string;
}

function getAcceptanceCriteriaField(): string {
  return process.env.JIRA_ACCEPTANCE_CRITERIA_FIELD || "customfield_10000";
}

function authHeaders(credentials: JiraCredentials): Record<string, string> {
  const token = Buffer.from(
    `${credentials.email}:${credentials.apiKey}`,
  ).toString("base64");
  return {
    Authorization: `Basic ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function jiraUrl(credentials: JiraCredentials, path: string): string {
  return `${credentials.baseUrl.replace(/\/$/, "")}${path}`;
}

function readText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  const content = (value as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => readText(item))
    .join(" ")
    .trim();
}

function mapIssue(issue: JiraIssue): JiraTicket {
  const fields = issue.fields || {};
  const acceptanceCriteriaField = getAcceptanceCriteriaField();
  const priority = fields.priority as { name?: string } | undefined;
  const assignee = fields.assignee as
    | { displayName?: string; emailAddress?: string }
    | undefined;

  return {
    issueKey: issue.key || "",
    summary: readText(fields.summary),
    description: readText(fields.description),
    acceptanceCriteria: readText(fields[acceptanceCriteriaField]),
    priority: priority?.name || "",
    assignee: assignee?.displayName || assignee?.emailAddress || "",
  };
}

export async function validateCredentials(
  credentials: JiraCredentials,
): Promise<void> {
  const response = await fetch(jiraUrl(credentials, "/rest/api/3/myself"), {
    method: "GET",
    headers: authHeaders(credentials),
  });

  if (!response.ok) {
    throw new Error(`Jira credentials rejected with status ${response.status}`);
  }
}

export async function fetchTickets(
  credentials: JiraCredentials,
  startAt: number,
  maxResults: number,
  search: Record<string, string> | undefined,
  sortField: string | undefined,
  sortDirection: string | undefined,
): Promise<JiraTicketPage> {
  const acceptanceCriteriaField = getAcceptanceCriteriaField();
  const clauses = ["project is not EMPTY"];
  const searchEntry = Object.entries(search || {}).find(([, value]) =>
    value.trim(),
  );
  if (searchEntry) {
    const [searchField, rawSearchText] = searchEntry;
    const searchText = rawSearchText.trim();
    const escapedText = searchText.replace(/([\\\"'])/g, "\\$1");
    const jiraField =
      searchField === "issueKey"
        ? "key"
        : searchField === "acceptanceCriteria"
          ? acceptanceCriteriaField
          : searchField;
    clauses.push(`${jiraField} ~ "${escapedText}"`);
  }

  const orderField =
    sortField === "issueKey" || !sortField
      ? "key"
      : sortField === "acceptanceCriteria"
        ? acceptanceCriteriaField
        : sortField;
  const direction = sortDirection === "desc" ? "DESC" : "ASC";
  const query = `${clauses.join(" AND ")} ORDER BY ${orderField} ${direction}`;
  const fields = [
    "summary",
    "description",
    "priority",
    "assignee",
    acceptanceCriteriaField,
  ];
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  let isLast = false;

  while (!isLast) {
    const response = await fetch(
      jiraUrl(credentials, "/rest/api/3/search/jql"),
      {
        method: "POST",
        headers: authHeaders(credentials),
        body: JSON.stringify({
          jql: query,
          maxResults: 100,
          fields,
          ...(nextPageToken ? { nextPageToken } : {}),
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Jira ticket request failed with status ${response.status}: ${errorBody}`,
      );
    }

    const data = (await response.json()) as JiraSearchResponse;
    issues.push(...(data.issues || []));
    isLast = data.isLast === true || !data.nextPageToken;
    nextPageToken = data.nextPageToken;
  }

  const page = issues.slice(startAt, startAt + maxResults);
  return {
    tickets: page.map(mapIssue),
    total: issues.length,
    startAt,
    maxResults,
  };
}
