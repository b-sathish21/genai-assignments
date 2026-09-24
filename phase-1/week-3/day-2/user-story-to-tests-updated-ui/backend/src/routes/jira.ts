import express from "express";
import { JiraCredentialsSchema, JiraTicketsRequestSchema } from "../schemas";
import { fetchTickets, validateCredentials } from "../services/jiraService";

export const jiraRouter = express.Router();

jiraRouter.post(
  "/validate",
  async (req: express.Request, res: express.Response): Promise<void> => {
    const validation = JiraCredentialsSchema.safeParse(req.body);
    if (!validation.success) {
      res
        .status(400)
        .json({ error: "In-valid Credentials/ URL - Please check the inputs" });
      return;
    }

    try {
      await validateCredentials(validation.data);
      res.json({ valid: true });
    } catch (error) {
      console.error("Jira validation failed:", error);
      res
        .status(502)
        .json({ error: "In-valid Credentials/ URL - Please check the inputs" });
    }
  },
);

jiraRouter.post(
  "/tickets",
  async (req: express.Request, res: express.Response): Promise<void> => {
    const validation = JiraTicketsRequestSchema.safeParse(req.body);
    if (!validation.success) {
      res
        .status(400)
        .json({ error: "In-valid Credentials/ URL - Please check the inputs" });
      return;
    }

    const {
      baseUrl,
      email,
      apiKey,
      startAt,
      maxResults,
      search,
      sortField,
      sortDirection,
    } = validation.data;
    try {
      const page = await fetchTickets(
        { baseUrl, email, apiKey },
        startAt,
        maxResults,
        search,
        sortField,
        sortDirection,
      );
      res.json(page);
    } catch (error) {
      console.error("Jira ticket retrieval failed:", error);
      res.status(502).json({
        error:
          process.env.NODE_ENV === "production"
            ? "Unable to retrieve Jira tickets. Please check the inputs"
            : error instanceof Error
              ? error.message
              : "Unable to retrieve Jira tickets. Please check the inputs",
      });
    }
  },
);
