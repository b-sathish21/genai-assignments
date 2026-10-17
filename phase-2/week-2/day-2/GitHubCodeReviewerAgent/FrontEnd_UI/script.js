"use strict";

const WEBHOOK_URL = "http://localhost:5678/webhook/GCR";
const PROGRESS_MESSAGES = [
  "Reading Code...",
  "Contacting Github API...",
  "Filtering Scripts from other files...",
  "Synthesizing recommendations...",
];

const form = document.getElementById("review-form");
const githubInput = document.getElementById("github-url");
const urlField = document.querySelector(".url-field");
const formError = document.getElementById("github-error");
const reviewButton = document.getElementById("review-button");
const reviewButtonLabel = document.getElementById("review-button-label");
const workspace = document.querySelector(".review-workspace");
const workspaceWaiting = document.querySelector(".workspace-waiting");
const workspaceLoading = document.querySelector(".workspace-loading");
const workspaceError = document.querySelector(".workspace-error");
const workspaceErrorMessage = document.getElementById("workspace-error-message");
const workspaceResult = document.querySelector(".workspace-result");
const reviewResult = document.getElementById("review-result");
const reviewSummary = document.getElementById("review-summary");
const zipDownload = document.getElementById("zip-download");
const reviewToast = document.getElementById("review-toast");
const progressStatus = document.getElementById("progress-status");
const connectionBadge = document.querySelector(".connection-badge");
const connectionStatusLabel = document.getElementById("connection-status-label");
const analysisCompleteBadge = document.getElementById("analysis-complete-badge");

const requiredElements = {
  form,
  githubInput,
  urlField,
  formError,
  reviewButton,
  reviewButtonLabel,
  workspace,
  workspaceWaiting,
  workspaceLoading,
  workspaceError,
  workspaceErrorMessage,
  workspaceResult,
  reviewResult,
  reviewSummary,
  zipDownload,
  reviewToast,
  progressStatus,
  connectionBadge,
  connectionStatusLabel,
  analysisCompleteBadge,
};

const missingElement = Object.entries(requiredElements).find(([, element]) => !element);
if (missingElement) {
  throw new Error(`Required review interface element is missing: ${missingElement[0]}`);
}

let progressTimer = null;
let toastTimer = null;

class WebhookResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = "WebhookResponseError";
  }
}

function extractReviewText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(extractReviewText).filter(Boolean).join("\n\n");
  }

  if (typeof value === "object") {
    const preferredKeys = [
      "analysis",
      "response",
      "output",
      "text",
      "content",
      "message",
      "result",
      "data",
      "body",
    ];

    for (const key of preferredKeys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const text = extractReviewText(value[key]);
        if (text) {
          return text;
        }
      }
    }

    return Object.entries(value)
      .map(([key, nestedValue]) => {
        if (isZipFieldKey(key)) {
          return "";
        }
        const text = extractReviewText(nestedValue);
        return text ? `${key}: ${text}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }

  return "";
}

function isZipFieldKey(key) {
  return /^(zipfile|zipfilename|zipfilebase64|zipbase64|zipdata)$/i.test(key);
}

function formatReviewPayload(payload) {
  const record = Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
  if (record && typeof record === "object" && !Array.isArray(record)) {
    const metricValues = record["5 Metrics average score"];
    const metrics = metricValues && typeof metricValues === "object" && !Array.isArray(metricValues)
      ? metricValues
      : {};
    const summary = {
      totalScriptsReviewed: record["Total Code files"],
      codeReadability: metrics["Code Readability"] ?? record["Code Readability"],
      codeEfficiency: metrics["Code Efficiency"] ?? record["Code Efficiency"],
      errorHandling: metrics["Error Handling"] ?? record["Error Handling"],
      maintainability: metrics.Maintainability ?? record.Maintainability,
      bestPractices: metrics["Best Practices & Standards"] ?? record["Best Practices & Standards"],
      overallScore: record["Overall Score"],
    };

    const hasSummary = Object.values(summary).some(
      (value) => value !== undefined && value !== null,
    );
    if (hasSummary) {
      return { summary, reviewText: "" };
    }
  }

  return {
    summary: null,
    reviewText: extractReviewText(payload),
  };
}

function displayValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return value === undefined || value === null || value === "" ? "—" : String(value);
}

function renderReviewSummary(summary) {
  const values = {
    "total-scripts-reviewed": summary.totalScriptsReviewed,
    "score-code-readability": summary.codeReadability,
    "score-code-efficiency": summary.codeEfficiency,
    "score-error-handling": summary.errorHandling,
    "score-maintainability": summary.maintainability,
    "score-best-practices": summary.bestPractices,
    "overall-score": summary.overallScore,
  };

  for (const [elementId, value] of Object.entries(values)) {
    document.getElementById(elementId).textContent = displayValue(value);
  }
}

function hideReviewToast() {
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
  reviewToast.hidden = true;
}

function showReviewToast() {
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
  }
  reviewToast.textContent = "Feature under CONSTRUCTION";
  reviewToast.hidden = false;
  toastTimer = window.setTimeout(() => {
    reviewToast.hidden = true;
    toastTimer = null;
  }, 10000);
}

function escapeHtml(value) {
  const escapedCharacters = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return value.replace(/[&<>"']/g, (character) => escapedCharacters[character]);
}

function renderInlineMarkdown(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function splitMarkdownTableRow(line) {
  let content = line.trim();
  if (content.startsWith("|")) {
    content = content.slice(1);
  }
  if (content.endsWith("|")) {
    content = content.slice(0, -1);
  }
  return content.split("|").map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function isMarkdownTableStart(lines, index) {
  return (
    index + 1 < lines.length &&
    lines[index].includes("|") &&
    isMarkdownTableSeparator(lines[index + 1])
  );
}

function renderMarkdownTable(headers, rows) {
  const renderCells = (cells, tagName) =>
    headers
      .map((_, index) => `<${tagName}>${renderInlineMarkdown(cells[index] || "")}</${tagName}>`)
      .join("");
  const headerMarkup = `<thead><tr>${renderCells(headers, "th")}</tr></thead>`;
  const bodyMarkup = rows
    .map((row) => `<tr>${renderCells(row, "td")}</tr>`)
    .join("");

  return `<div class="markdown-table-wrap"><table>${headerMarkup}<tbody>${bodyMarkup}</tbody></table></div>`;
}

function renderMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let listOpen = false;
  let codeOpen = false;
  let codeLines = [];

  function closeList() {
    if (listOpen) {
      blocks.push("</ul>");
      listOpen = false;
    }
  }

  function addCodeBlock() {
    blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
    codeOpen = false;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (codeOpen) {
      if (/^\s*```/.test(line)) {
        addCodeBlock();
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (/^\s*```/.test(line)) {
      closeList();
      codeOpen = true;
      codeLines = [];
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      closeList();
      const headers = splitMarkdownTableRow(line);
      const rows = [];
      let rowIndex = index + 2;

      while (
        rowIndex < lines.length &&
        lines[rowIndex].trim() &&
        lines[rowIndex].includes("|")
      ) {
        rows.push(splitMarkdownTableRow(lines[rowIndex]));
        rowIndex += 1;
      }

      blocks.push(renderMarkdownTable(headers, rows));
      index = rowIndex - 1;
      continue;
    }

    const listItem = line.match(/^\s*[-*+]\s+(.+)$/);
    if (listItem) {
      if (!listOpen) {
        blocks.push("<ul>");
        listOpen = true;
      }
      blocks.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`);
      continue;
    }

    closeList();
    const paragraphLines = [line.trim()];
    while (
      index + 1 < lines.length &&
      lines[index + 1].trim() &&
      !/^\s*```/.test(lines[index + 1]) &&
      !/^\s{0,3}#{1,6}\s+/.test(lines[index + 1]) &&
      !/^\s*[-*+]\s+/.test(lines[index + 1]) &&
      !isMarkdownTableStart(lines, index + 1)
    ) {
      index += 1;
      paragraphLines.push(lines[index].trim());
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join(" "))}</p>`);
  }

  closeList();
  if (codeOpen) {
    addCodeBlock();
  }

  return blocks.join("");
}

function setConnectionStatus(status) {
  connectionBadge.classList.remove("is-connecting", "is-error");

  if (status === "connecting") {
    connectionBadge.classList.add("is-connecting");
    connectionStatusLabel.textContent = "n8n Connecting";
    return;
  }

  if (status === "error") {
    connectionBadge.classList.add("is-error");
    connectionStatusLabel.textContent = "n8n Disconnected";
    return;
  }

  if (status === "response-error") {
    connectionBadge.classList.add("is-error");
    connectionStatusLabel.textContent = "n8n Error";
    return;
  }

  connectionStatusLabel.textContent = "n8n Connected";
}

function clearProgressTicker() {
  if (progressTimer !== null) {
    window.clearInterval(progressTimer);
    progressTimer = null;
  }
}

function startProgressTicker() {
  clearProgressTicker();
  let messageIndex = 0;
  progressStatus.textContent = PROGRESS_MESSAGES[messageIndex];

  progressTimer = window.setInterval(() => {
    messageIndex = (messageIndex + 1) % PROGRESS_MESSAGES.length;
    progressStatus.textContent = PROGRESS_MESSAGES[messageIndex];
  }, 1500);
}

function updateWorkspaceState(state) {
  workspace.classList.remove("is-loading", "has-error", "has-result", "has-validation-error");
  workspace.setAttribute("aria-busy", state === "loading" ? "true" : "false");

  workspaceWaiting.setAttribute("aria-hidden", String(state !== "waiting"));
  workspaceLoading.setAttribute("aria-hidden", String(state !== "loading"));
  workspaceError.setAttribute("aria-hidden", String(state !== "error"));
  workspaceResult.setAttribute("aria-hidden", String(state !== "result"));

  if (state === "loading") {
    workspace.classList.add("is-loading");
  } else if (state === "error") {
    workspace.classList.add("has-error");
  } else if (state === "result") {
    workspace.classList.add("has-result");
  }
}

function clearValidationError() {
  formError.hidden = true;
  githubInput.setAttribute("aria-invalid", "false");
  urlField.classList.remove("is-invalid");
  workspace.classList.remove("has-validation-error");
}

function showValidationError() {
  formError.hidden = false;
  githubInput.setAttribute("aria-invalid", "true");
  urlField.classList.add("is-invalid");
  workspace.classList.remove("has-validation-error");
  void workspace.offsetWidth;
  workspace.classList.add("has-validation-error");
  githubInput.focus();
}

function setControlsDisabled(disabled) {
  githubInput.disabled = disabled;
  reviewButton.disabled = disabled;
}

function setButtonLabel(label) {
  reviewButtonLabel.textContent = label;
}

function showConnectionError(error) {
  clearProgressTicker();
  updateWorkspaceState("error");
  analysisCompleteBadge.hidden = true;
  workspaceErrorMessage.textContent =
    error instanceof WebhookResponseError
      ? error.message
      : `Could not connect to n8n at ${WEBHOOK_URL}. Confirm that n8n is running and the webhook is available.`;

  setControlsDisabled(false);
  setButtonLabel("Review Code");
  setConnectionStatus(error instanceof WebhookResponseError ? "response-error" : "error");
}

async function readReviewResponse(response) {
  const responseBody = await response.text();
  let payload = responseBody;
  try {
    payload = JSON.parse(responseBody);
  } catch {
    payload = responseBody;
  }

  if (!response.ok) {
    const responseDetails = extractReviewText(payload) || responseBody.trim();
    const detail = responseDetails ? `: ${responseDetails.slice(0, 500)}` : "";
    throw new WebhookResponseError(
      `The n8n webhook returned HTTP ${response.status}${detail}`,
    );
  }

  const result = formatReviewPayload(payload);
  if (!result.reviewText && !result.summary) {
    throw new WebhookResponseError(
      "The n8n webhook responded, but it did not include readable review text.",
    );
  }

  return result;
}

async function submitReview(githubUrl) {
  clearValidationError();
  analysisCompleteBadge.hidden = true;
  reviewResult.textContent = "";
  reviewResult.hidden = true;
  reviewSummary.hidden = true;
  hideReviewToast();
  workspaceErrorMessage.textContent = "";
  updateWorkspaceState("loading");
  setControlsDisabled(true);
  setButtonLabel("Analyzing...");
  setConnectionStatus("connecting");
  startProgressTicker();

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ githubUrl }),
    });
    const { reviewText, summary } = await readReviewResponse(response);

    clearProgressTicker();
    if (summary) {
      renderReviewSummary(summary);
      reviewSummary.hidden = false;
    } else {
      // The renderer escapes response text before emitting its limited Markdown markup.
      reviewResult.innerHTML = renderMarkdown(reviewText);
      reviewResult.hidden = false;
    }
    updateWorkspaceState("result");
    setControlsDisabled(false);
    setButtonLabel("Review Code");
    setConnectionStatus("connected");
    analysisCompleteBadge.hidden = false;
  } catch (error) {
    showConnectionError(error);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const githubUrl = githubInput.value.trim();

  if (!githubUrl) {
    showValidationError();
    return;
  }

  if (!githubInput.checkValidity()) {
    githubInput.reportValidity();
    return;
  }

  void submitReview(githubUrl);
});

zipDownload.addEventListener("click", showReviewToast);
githubInput.addEventListener("input", clearValidationError);
