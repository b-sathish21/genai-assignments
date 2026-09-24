import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { fetchJiraTickets, validateJiraCredentials } from "./api";
import { loadJiraCredentials, saveJiraCredentials } from "./jiraStorage";
import { JiraCredentials, JiraTicket, JiraTicketsResponse } from "./types";

interface JiraPageProps {
  onBack: () => void;
  onSelectTicket: (ticket: JiraTicket) => void;
}

type JiraTab = "tickets" | "settings";
type SortDirection = "asc" | "desc";

const pageSize = 10;
const columns: Array<{ key: keyof JiraTicket; label: string }> = [
  { key: "issueKey", label: "Issue Key" },
  { key: "summary", label: "Summary" },
  { key: "description", label: "Description" },
  { key: "acceptanceCriteria", label: "Acceptance Criteria" },
  { key: "priority", label: "Priority" },
  { key: "assignee", label: "Assignee" },
];

function JiraPage({ onBack, onSelectTicket }: JiraPageProps) {
  const [activeTab, setActiveTab] = useState<JiraTab>("tickets");
  const [credentials, setCredentials] = useState<JiraCredentials>({
    baseUrl: "",
    email: "",
    apiKey: "",
  });
  const [tickets, setTickets] = useState<JiraTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [search, setSearch] = useState<Record<string, string>>({});
  const [openSearchColumn, setOpenSearchColumn] = useState<string | null>(null);
  const [sortField, setSortField] = useState<keyof JiraTicket>("issueKey");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const getNormalizedCredentials = (): JiraCredentials => ({
    baseUrl: credentials.baseUrl.trim().replace(/\/+$/, ""),
    email: credentials.email.trim(),
    apiKey: credentials.apiKey.trim(),
  });

  const loadTickets = async (
    page = currentPage,
    credentialsOverride?: JiraCredentials,
  ) => {
    const normalizedCredentials =
      credentialsOverride || getNormalizedCredentials();
    if (
      !normalizedCredentials.baseUrl ||
      !normalizedCredentials.email ||
      !normalizedCredentials.apiKey
    )
      return;
    setIsLoading(true);
    try {
      const response: JiraTicketsResponse = await fetchJiraTickets({
        credentials: normalizedCredentials,
        startAt: (page - 1) * pageSize,
        maxResults: pageSize,
        search,
        sortField,
        sortDirection,
      });
      setTickets(response.tickets);
      setTotal(response.total);
      setCurrentPage(page);
      setSelectedKeys([]);
    } catch (error) {
      await Swal.fire({
        icon: "error",
        title: "Jira Error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to retrieve Jira tickets",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (
      activeTab === "tickets" &&
      credentials.baseUrl &&
      credentials.email &&
      credentials.apiKey
    ) {
      void loadTickets(1);
    }
  }, [sortField, sortDirection, search]);

  useEffect(() => {
    let isMounted = true;

    void loadJiraCredentials().then((savedCredentials) => {
      if (!isMounted || !savedCredentials) return;
      setCredentials(savedCredentials);
      void loadTickets(1, savedCredentials);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !credentials.baseUrl.trim() ||
      !credentials.email.trim() ||
      !credentials.apiKey.trim()
    ) {
      await Swal.fire({
        icon: "error",
        title: "Invalid Inputs",
        text: "Base URL, Email ID and API Key are required",
      });
      return;
    }

    setIsSaving(true);
    try {
      const normalizedCredentials = getNormalizedCredentials();
      setCredentials(normalizedCredentials);
      await validateJiraCredentials(normalizedCredentials);
      await saveJiraCredentials(normalizedCredentials);
      await Swal.fire({
        icon: "success",
        title: "Connected",
        text: "Jira credentials saved successfully",
      });
      setActiveTab("tickets");
      await loadTickets(1, normalizedCredentials);
    } catch (error) {
      await Swal.fire({
        icon: "error",
        title: "Connection Failed",
        text:
          error instanceof Error
            ? error.message
            : "In-valid Credentials/ URL - Please check the inputs",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = () => {
    setCredentials({ baseUrl: "", email: "", apiKey: "" });
    setShowApiKey(false);
  };

  const toggleSearch = (key: string) => {
    if (openSearchColumn === key) {
      setOpenSearchColumn(null);
      setSearch((previous) => ({ ...previous, [key]: "" }));
    } else {
      setOpenSearchColumn(key);
    }
  };

  const toggleSort = (key: keyof JiraTicket) => {
    if (sortField === key) {
      setSortDirection((previous) => (previous === "asc" ? "desc" : "asc"));
    } else {
      setSortField(key);
      setSortDirection("asc");
    }
  };

  const toggleSelected = (issueKey: string) => {
    setSelectedKeys((previous) =>
      previous.includes(issueKey)
        ? previous.filter((key) => key !== issueKey)
        : [...previous, issueKey],
    );
  };

  const handleGenerate = async () => {
    if (selectedKeys.length > 1) {
      await Swal.fire({
        icon: "warning",
        title: "Choose One Story",
        text: "More than one story is chosen for generating Test case. Please choose only one story.",
      });
      return;
    }
    if (selectedKeys.length === 0) {
      await Swal.fire({
        icon: "error",
        title: "No Story Selected",
        text: "No User Story is chosen. Please choose any one story to generate Test Case",
      });
      return;
    }
    const ticket = tickets.find((item) => item.issueKey === selectedKeys[0]);
    if (ticket) onSelectTicket(ticket);
  };

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const firstRecord = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastRecord = Math.min(currentPage * pageSize, total);

  return (
    <div className="jira-page">
      <div className="jira-page-header">
        <button type="button" className="jira-back-btn" onClick={onBack}>
          Back to Generator
        </button>
        <h1>Connect-To-Jira</h1>
      </div>

      <div className="jira-tabs" role="tablist">
        <button
          type="button"
          className={activeTab === "tickets" ? "jira-tab active" : "jira-tab"}
          onClick={() => setActiveTab("tickets")}
        >
          Tickets
        </button>
        <button
          type="button"
          className={activeTab === "settings" ? "jira-tab active" : "jira-tab"}
          onClick={() => setActiveTab("settings")}
        >
          Settings
        </button>
      </div>

      {activeTab === "settings" && (
        <form className="jira-settings" onSubmit={handleSave}>
          <label>
            Base URL{" "}
            <textarea
              value={credentials.baseUrl}
              onChange={(event) =>
                setCredentials({ ...credentials, baseUrl: event.target.value })
              }
              placeholder="https://your-domain.atlassian.net"
              required
            />
          </label>
          <label>
            Email ID{" "}
            <textarea
              value={credentials.email}
              onChange={(event) =>
                setCredentials({ ...credentials, email: event.target.value })
              }
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            API Key{" "}
            <div className="jira-secret-field">
              <input
                type={showApiKey ? "text" : "password"}
                value={credentials.apiKey}
                onChange={(event) =>
                  setCredentials({
                    ...credentials,
                    apiKey: event.target.value,
                  })
                }
                placeholder="Jira API token"
                required
                autoComplete="off"
              />
              <button
                type="button"
                className="jira-visibility-btn"
                onClick={() => setShowApiKey((visible) => !visible)}
                aria-label={showApiKey ? "Hide API key" : "Show API key"}
                title={showApiKey ? "Hide API key" : "Show API key"}
              >
                {showApiKey ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <div className="jira-settings-actions">
            <button
              type="submit"
              className="jira-primary-btn"
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="jira-secondary-btn"
              onClick={handleClear}
              disabled={isSaving}
            >
              Clear
            </button>
          </div>
        </form>
      )}

      {activeTab === "tickets" && (
        <>
          <section className="jira-action-container">
            <button
              type="button"
              className="jira-secondary-btn"
              onClick={() => void loadTickets(1)}
              disabled={isLoading}
            >
              Refresh
            </button>
            <button
              type="button"
              className="jira-primary-btn"
              onClick={() => void handleGenerate()}
            >
              Generate Test Case
            </button>
          </section>
          <section className="jira-table-container">
            <table className="jira-table">
              <thead>
                <tr>
                  <th>Checkbox</th>
                  {columns.map((column) => (
                    <th key={column.key}>
                      <div className="jira-header-cell">
                        <span>{column.label}</span>
                        <button
                          type="button"
                          className="jira-icon-btn"
                          title={`Search ${column.label}`}
                          onClick={() => toggleSearch(column.key)}
                        >
                          ⌕
                        </button>
                        <button
                          type="button"
                          className="jira-icon-btn"
                          title={`Sort ${column.label}`}
                          onClick={() => toggleSort(column.key)}
                        >
                          {sortField === column.key
                            ? sortDirection === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </button>
                      </div>
                      {openSearchColumn === column.key && (
                        <input
                          className="jira-search-input"
                          value={search[column.key] || ""}
                          onChange={(event) =>
                            setSearch({
                              ...search,
                              [column.key]: event.target.value,
                            })
                          }
                          placeholder={`Search ${column.label}`}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.issueKey}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedKeys.includes(ticket.issueKey)}
                        onChange={() => toggleSelected(ticket.issueKey)}
                      />
                    </td>
                    {columns.map((column) => (
                      <td key={column.key}>{ticket[column.key] || "-"}</td>
                    ))}
                  </tr>
                ))}
                {!isLoading && tickets.length === 0 && (
                  <tr>
                    <td colSpan={7} className="jira-empty">
                      Connect Jira in Settings to load tickets.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="jira-pagination">
              <div className="jira-page-controls">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => void loadTickets(1)}
                >
                  &lt;&lt;
                </button>
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => void loadTickets(currentPage - 1)}
                >
                  &lt;
                </button>
                <span>{currentPage}</span>
                <button
                  type="button"
                  disabled={currentPage === lastPage}
                  onClick={() => void loadTickets(currentPage + 1)}
                >
                  &gt;
                </button>
                <button
                  type="button"
                  disabled={currentPage === lastPage}
                  onClick={() => void loadTickets(lastPage)}
                >
                  &gt;&gt;
                </button>
              </div>
              <span>
                {firstRecord} to {lastRecord} of {total}
              </span>
            </div>
          </section>
        </>
      )}

      <style>{`
        .jira-page { max-width: 1600px; margin: 0 auto; padding: 36px; color: var(--text); }
        .jira-page-header, .jira-action-container, .jira-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .jira-page-header { margin-bottom: 24px; }
        .jira-page-header h1 { font-size: 2rem; }
        .jira-tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
        .jira-tab { border: 0; background: transparent; padding: 12px 18px; color: var(--muted); font-weight: 700; cursor: pointer; border-bottom: 3px solid transparent; }
        .jira-tab.active { color: var(--brand-darker); border-bottom-color: var(--brand); }
        .jira-settings { max-width: 640px; background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 24px; display: grid; gap: 16px; }
        .jira-settings label { display: grid; gap: 8px; font-weight: 700; }
        .jira-settings textarea, .jira-search-input { width: 100%; border: 1px solid var(--border); border-radius: 8px; padding: 10px; font: inherit; resize: vertical; }
        .jira-settings textarea { min-height: 72px; }
        .jira-settings-actions { display: flex; align-items: center; gap: 10px; }
        .jira-secret-field { display: flex; align-items: center; gap: 8px; }
        .jira-secret-field input { flex: 1; min-width: 0; border: 1px solid var(--border); border-radius: 8px; padding: 10px; font: inherit; }
        .jira-visibility-btn { border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; background: var(--brand-soft); color: var(--brand-darker); cursor: pointer; font-weight: 700; }
        .jira-action-container { justify-content: flex-end; margin-bottom: 16px; }
        .jira-primary-btn, .jira-secondary-btn, .jira-back-btn, .jira-page-controls button { border: 1px solid var(--border); border-radius: 8px; padding: 9px 14px; cursor: pointer; font-weight: 700; }
        .jira-primary-btn { background: var(--brand); color: #fff; border-color: var(--brand-dark); }
        .jira-secondary-btn, .jira-back-btn { background: var(--brand-soft); color: var(--brand-darker); }
        .jira-primary-btn:disabled, .jira-page-controls button:disabled { opacity: .5; cursor: not-allowed; }
        .jira-table-container { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; overflow-x: auto; }
        .jira-table { width: 100%; border-collapse: collapse; min-width: 1000px; }
        .jira-table th, .jira-table td { padding: 12px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); }
        .jira-table th { background: #f6f9f2; color: var(--muted); font-size: 12px; text-transform: uppercase; }
        .jira-header-cell { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
        .jira-icon-btn { border: 0; background: transparent; color: var(--brand-darker); cursor: pointer; font-size: 16px; }
        .jira-search-input { margin-top: 8px; font-size: 12px; }
        .jira-empty { text-align: center !important; color: var(--muted); padding: 40px !important; }
        .jira-pagination { padding: 14px 16px; }
        .jira-page-controls { display: flex; align-items: center; gap: 8px; }
        .jira-page-controls span { min-width: 30px; text-align: center; font-weight: 700; }
        @media (max-width: 700px) { .jira-page { padding: 20px; } .jira-page-header { align-items: flex-start; flex-direction: column-reverse; } .jira-pagination { align-items: flex-start; flex-direction: column; } }
      `}</style>
    </div>
  );
}

export default JiraPage;
