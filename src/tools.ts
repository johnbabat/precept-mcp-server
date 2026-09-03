import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios, { AxiosError } from "axios";
import dotenv from "dotenv";

import { apiKeyStorage } from "./context.js";
import { SERVER_VERSION } from "./version.js";

dotenv.config();

const PRECEPT_API_URL =
  process.env.PRECEPT_API_URL || "https://api.preceptai.co.uk";

// Helper to construct API headers
function getHeaders() {
  const currentApiKey = apiKeyStorage.getStore();
  // Use != null so that an explicit key (even if unusual) is respected
  const apiKey =
    currentApiKey != null ? currentApiKey : process.env.PRECEPT_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Precept API Key is not configured. Please authorize the server or set PRECEPT_API_KEY in the environment.",
    );
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

// Helper to format responses
function formatResponse(data: any) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

// Helper to format errors with detailed diagnostics
function formatError(error: any, context: string) {
  let errorMsg: string;
  if (error instanceof AxiosError) {
    const status = error.response?.status
      ? ` (HTTP ${error.response.status})`
      : "";
    const detail =
      error.response?.data?.error ||
      error.response?.data?.message ||
      (typeof error.response?.data === "string" ? error.response.data : "") ||
      error.message;
    errorMsg = `${detail}${status}`;
    console.error(`[Tool Error] Error in ${context}: ${errorMsg}`, {
      status: error.response?.status,
      url: error.config?.url,
      data: error.response?.data,
    });
  } else {
    errorMsg = error?.message || String(error);
    console.error(`[Tool Error] Error in ${context}: ${errorMsg}`);
  }

  return {
    content: [
      {
        type: "text" as const,
        text: `Error ${context}: ${errorMsg}`,
      },
    ],
    isError: true,
  };
}

// Helper to return current running server version metadata
export function checkServerVersion(currentVersion: string = SERVER_VERSION) {
  return {
    serverVersion: currentVersion,
    status: "active",
    message: `Precept MCP server is running v${currentVersion}.`,
  };
}

// Shared Zod schema for enrichments object (used in company insights and company search)
const enrichmentsSchema = z
  .object({
    type: z
      .enum([
        "decision_makers",
        "all_employees",
        "employee_count",
        "job_posting_insights",
        "department_ratio",
        "employee_count_change",
        "technology_stack",
        "revenue",
        "recent_funding",
      ])
      .optional()
      .describe(
        "The type of structured enrichment to perform. " +
          "Company-level: 'technology_stack', 'revenue', 'recent_funding'. " +
          "Department-level (requires departments/jobTitles): 'employee_count', 'employee_count_change', 'department_ratio', 'job_posting_insights'. " +
          "Lead-level: 'decision_makers' (finds key people by seniority), 'all_employees' (entire directory).",
      ),
    departments: z
      .array(z.string())
      .max(40)
      .optional()
      .describe(
        "Department names to find employees or insights for (case-insensitive). " +
          "Valid values include: 'C-Suite', 'Engineering and Technical', 'Sales', 'Marketing', 'Product', 'Human Resources', 'Finance & Accounting', 'Operations', 'Design', 'Data & Analytics', 'Legal', 'Customer Service', 'Information Technology', 'Research', 'Consulting', 'Founder', and more. " +
          "NOTE: The combined sum of departments and jobTitles must not exceed 40.",
      ),
    jobTitles: z
      .array(z.string())
      .max(40)
      .optional()
      .describe(
        "Job titles to find employees for. Any title works (e.g. 'Software Engineer', 'VP Sales', 'Head of Marketing'). " +
          "NOTE: The combined sum of departments and jobTitles must not exceed 40.",
      ),
    country: z
      .array(z.string())
      .optional()
      .describe(
        "Filter decision makers by country (e.g. ['United States', 'United Kingdom']). Only applicable for decision_makers type.",
      ),
    includeContactDetails: z
      .boolean()
      .optional()
      .describe(
        "Find verified email addresses and phone numbers for decision makers. Only applicable for decision_makers type. Adds contact enrichment cost per person found (1 credit for email per person, 10 for phone per person, or 11 for both per person). IMPORTANT: Do NOT enable unless the user explicitly requested contact details.",
      ),
    decisionMakersLimit: z
      .number()
      .optional()
      .describe(
        "Max number of decision makers to return per company. Defaults to 5. Only applicable for decision_makers type.",
      ),
    limitType: z
      .enum(["per_role", "overall"])
      .optional()
      .describe(
        "How the decisionMakersLimit is applied. 'overall' (default): limit is a total maximum across all roles, searched sequentially. 'per_role': limit applies per department/job title.",
      ),
  })
  .optional()
  .describe(
    "Optional enrichment configuration. See Precept API docs for detailed enrichment types and costs.",
  );

// Shared Zod schemas for tool outputs (enables structured JSON support and removes 'OUTPUT SCHEMA RECOMMENDED' badge in ChatGPT)
const asyncJobInitOutputSchema = z
  .object({
    enrichment_id: z
      .string()
      .optional()
      .describe("The unique job ID to poll with precept_get_job_status"),
    message: z
      .string()
      .optional()
      .describe("Status message describing the initialized job"),
    finalLimit: z
      .number()
      .optional()
      .describe("Adjusted limit based on available credit balance"),
  })
  .passthrough()
  .describe("Initialization response containing the jobId to poll for results");

const jobStatusOutputSchema = z
  .object({
    enrichment_id: z.string().optional().describe("The job ID"),
    status: z
      .string()
      .optional()
      .describe(
        "Current lifecycle status of the job (e.g. 'pending', 'in_progress', 'processing', 'completed', 'failed')",
      ),
    name: z
      .string()
      .optional()
      .describe("Readable name of the job if specified"),
    progress: z
      .object({
        completed: z
          .number()
          .optional()
          .describe("Number of items processed so far"),
        total: z.number().optional().describe("Total items to process"),
        skipped: z.number().optional().describe("Number of skipped items"),
      })
      .optional()
      .describe("Progress counters while the job is still running"),
    results: z
      .any()
      .optional()
      .describe("Array of discovered lead or company objects when completed"),
    cost: z
      .object({
        credits: z
          .number()
          .optional()
          .describe("Total credits billed for this job"),
      })
      .optional()
      .describe("Credit cost summary"),
    phones_found: z
      .number()
      .optional()
      .describe("Total phone numbers successfully found"),
    emails_found: z
      .number()
      .optional()
      .describe("Total email addresses successfully found"),
  })
  .passthrough()
  .describe("Job status and full data results when completed");

const checkCreditsOutputSchema = z
  .object({
    credits: z
      .number()
      .optional()
      .describe("Available credit balance for this account"),
    versionStatus: z
      .object({
        serverVersion: z
          .string()
          .optional()
          .describe("Currently running MCP server version"),
        status: z.string().optional().describe("Server status code"),
        message: z.string().optional().describe("Status message"),
      })
      .optional()
      .describe("MCP server version status"),
  })
  .passthrough()
  .describe("Current available credit balance and version status");

const checkVersionOutputSchema = z
  .object({
    serverVersion: z
      .string()
      .optional()
      .describe("Currently running MCP server version"),
    status: z.string().optional().describe("Server status code"),
    message: z.string().optional().describe("Status message"),
  })
  .passthrough()
  .describe("MCP server version status");

export function registerAllTools(
  server: McpServer,
  serverVersion: string = SERVER_VERSION,
) {
  // ──────────────────────────────────────────
  // 1. precept_search_leads
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_search_leads",
    {
      description:
        "Search and discover business leads/contacts using natural language queries. " +
        "Finds people matching your ideal customer profile and can enrich them with verified contact details and AI-powered insights. " +
        "IMPORTANT: Always verify user has sufficient credits with precept_check_credits before executing. Unless the user specifies a count, default to returning 30 on the first attempt and ask if they want more afterwards. " +
        "This is an async operation — it returns an enrichment_id (jobId) immediately. You MUST continuously poll precept_get_job_status every 4 seconds for up to 150 attempts (~10 minutes) while in progress, providing the user with status updates at least every 15 polls (~1 minute) until completed.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Natural language search query describing the target persona and company (e.g. 'Marketing heads at SaaS companies in California', 'CTOs at fintech startups in London with 50-200 employees').",
          ),
        limit: z
          .number()
          .max(1000)
          .optional()
          .describe(
            "Maximum number of leads to return (max 1000). Unless the user specifies a count, default to 30 on the first attempt and ask if they want more afterwards. Always verify the user has sufficient credits for the volume before executing.",
          ),
        name: z
          .string()
          .optional()
          .describe(
            "A readable name for this enrichment job, used for searching on the Precept dashboard.",
          ),
        enrichType: z
          .array(z.enum(["emails", "phones"]))
          .optional()
          .describe(
            "Type of contact details to find. Options: 'emails' (+1 credit/lead), 'phones' (+10 credits/lead). Default: both (+11 credits/lead). Only used when includeContactDetails is true.",
          ),
        findInsights: z
          .boolean()
          .optional()
          .describe(
            "Generate AI insights for each lead including professional summary, top problems, internal strategic initiatives, and public appearances. Costs 1.1 credits per lead if true, 0.1 credits if false. Default: false.",
          ),
        includeContactDetails: z
          .boolean()
          .optional()
          .describe(
            "Whether to find and verify email addresses and phone numbers for each discovered lead. Enables waterfall search across 15+ data providers (+1 credit for email per lead, +10 for phone per lead, or +11 for both per lead). Increases processing time significantly for phone numbers. IMPORTANT: Do NOT enable unless the user explicitly requested contact details.",
          ),
        postInteractionKeywords: z
          .array(z.string())
          .max(5)
          .optional()
          .describe(
            "Activity-based filtering: find leads who recently posted or interacted with specific topics on LinkedIn. Provide up to 5 keywords or phrases. Adds +5 credits per lead.",
          ),
        webhookUrl: z
          .string()
          .url()
          .optional()
          .describe(
            "Optional webhook URL to receive enrichment results. NOTE: NOT needed for MCP assistant workflows. You can omit this and use precept_get_job_status with the returned enrichment_id to fetch the results directly.",
          ),
        streamingResults: z
          .boolean()
          .optional()
          .describe(
            "Optional. When true (and webhookUrl is provided), contact results are progressively streamed to the webhook as each lead is enriched. NOT needed when polling with precept_get_job_status.",
          ),
      }),
      outputSchema: asyncJobInitOutputSchema,
    },
    async (args) => {
      try {
        console.log(
          `[Tool] precept_search_leads starting... query="${args.query}", limit=${args.limit || "default"}, contactDetails=${!!args.includeContactDetails}`,
        );
        const response = await axios.post(
          `${PRECEPT_API_URL}/v1/leads/search`,
          args,
          { headers: getHeaders() },
        );
        console.log(
          `[Tool] precept_search_leads succeeded. jobId=${response.data?.enrichment_id || "none"}`,
        );
        return formatResponse(response.data);
      } catch (error) {
        return formatError(error, "searching leads");
      }
    },
  );

  // ──────────────────────────────────────────
  // 2. precept_enrich_leads
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_enrich_leads",
    {
      description:
        "Enrich a list of specific contacts with verified contact details and AI-powered insights. " +
        "Each lead can be identified by LinkedIn URL or a combination of first name, last name, and company name/domain. " +
        "Returns enriched data including verified emails, phone numbers, professional summary, top problems, strategic initiatives, and public appearances. " +
        "IMPORTANT: Always check user credits with precept_check_credits before calling this tool. " +
        "This is an async operation — it returns an enrichment_id (jobId) immediately. You MUST continuously poll precept_get_job_status every 4 seconds for up to 150 attempts (~10 minutes) while in progress, providing the user with status updates at least every 15 polls (~1 minute) until completed.",
      inputSchema: z.object({
        leads: z
          .array(
            z.object({
              linkedinUrl: z
                .string()
                .optional()
                .describe(
                  "LinkedIn profile URL of the contact (e.g. 'https://linkedin.com/in/johndoe'). Highly recommended for most accurate enrichment.",
                ),
              firstName: z
                .string()
                .optional()
                .describe("First name of the contact."),
              lastName: z
                .string()
                .optional()
                .describe("Last name of the contact."),
              companyName: z
                .string()
                .optional()
                .describe("Name of the company where the contact works."),
              companyDomain: z
                .string()
                .optional()
                .describe("Domain of the company (e.g. 'stripe.com')."),
              enrichType: z
                .array(z.enum(["emails", "phones"]))
                .optional()
                .describe(
                  "Type of contact details to find for this lead. Options: 'emails' (+1 credit), 'phones' (+10 credits). Default: both (+11 credits).",
                ),
              customData: z
                .record(z.string())
                .optional()
                .describe(
                  "Custom key-value metadata to associate with this lead. Will be returned in results for easy mapping back to your system. Max 5 properties, values max 100 chars.",
                ),
            }),
          )
          .max(1000)
          .describe(
            "Array of leads to enrich (up to 1000). Each lead must have either a linkedinUrl OR a combination of firstName + lastName + (companyName or companyDomain).",
          ),
        name: z
          .string()
          .optional()
          .describe(
            "A readable name for this enrichment job, used for searching on the Precept dashboard.",
          ),
        includeContactDetails: z
          .boolean()
          .optional()
          .describe(
            "Whether to find and verify email and phone numbers (+1 credit for email per lead, +10 for phone per lead, or +11 for both per lead). If true, results include enrich_email and enrich_phone fields. IMPORTANT: Do NOT enable unless the user explicitly requested contact details.",
          ),
        translate: z
          .boolean()
          .optional()
          .describe(
            "Set to true if lead names are not in English. Names will be translated before enrichment for more accurate results.",
          ),
        webhookUrl: z
          .string()
          .url()
          .optional()
          .describe(
            "Optional webhook URL to receive enrichment results. NOTE: NOT needed for MCP assistant workflows. You can omit this and use precept_get_job_status with the returned enrichment_id to fetch the results directly.",
          ),
        streamingResults: z
          .boolean()
          .optional()
          .describe(
            "Optional. When true (and webhookUrl is provided), contact results are progressively streamed to the webhook as each lead is enriched. NOT needed when polling with precept_get_job_status.",
          ),
      }),
      outputSchema: asyncJobInitOutputSchema,
    },
    async (args) => {
      try {
        console.log(
          `[Tool] precept_enrich_leads starting... count=${args.leads?.length}, contactDetails=${!!args.includeContactDetails}`,
        );
        const response = await axios.post(
          `${PRECEPT_API_URL}/v1/leads/enrich`,
          args,
          { headers: getHeaders() },
        );
        console.log(
          `[Tool] precept_enrich_leads succeeded. jobId=${response.data?.enrichment_id || "none"}`,
        );
        return formatResponse(response.data);
      } catch (error) {
        return formatError(error, "enriching leads");
      }
    },
  );

  // ──────────────────────────────────────────
  // 3. precept_get_company_insights
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_get_company_insights",
    {
      description:
        "Retrieve detailed insights and enrichments for a list of specific companies. " +
        "Provide companies by website URL or LinkedIn URL, and optionally specify enrichments like decision makers, technology stack, revenue, funding, employee counts, and department ratios. " +
        "You can also ask custom natural language queries about each company (e.g. 'What CRM do they use?'). " +
        "IMPORTANT: Always check user credits with precept_check_credits before calling this tool. " +
        "This is an async operation — it returns an enrichment_id (jobId) immediately. You MUST continuously poll precept_get_job_status every 4 seconds for up to 150 attempts (~10 minutes) while in progress, providing the user with status updates at least every 15 polls (~1 minute) until completed.",
      inputSchema: z.object({
        companies: z
          .array(
            z.object({
              companyName: z
                .string()
                .optional()
                .describe("The name of the company."),
              companyWebsite: z
                .string()
                .optional()
                .describe(
                  "The official website URL or domain (e.g. 'stripe.com' or 'https://stripe.com').",
                ),
              companyLinkedin: z
                .string()
                .optional()
                .describe(
                  "The LinkedIn company page URL (e.g. 'https://linkedin.com/company/stripe').",
                ),
              customData: z
                .record(z.string())
                .optional()
                .describe(
                  "Custom key-value metadata to associate with this company for mapping results back to your system. Max 5 properties, values max 100 chars.",
                ),
            }),
          )
          .max(5000)
          .describe(
            "List of companies to retrieve insights for (up to 5000). Each company must have at least a companyWebsite or companyLinkedin.",
          ),
        enrichments: enrichmentsSchema,
        name: z
          .string()
          .optional()
          .describe("A readable name for this enrichment job."),
        queries: z
          .array(z.string())
          .optional()
          .describe(
            "Custom natural language questions to ask about each company (e.g. ['What CRM do they use?', 'What compliance certifications do they hold?']). Each query costs 0.2 credits per company. Responses returned in query_responses field.",
          ),
      }),
      outputSchema: asyncJobInitOutputSchema,
    },
    async (args) => {
      try {
        console.log(
          `[Tool] precept_get_company_insights starting... count=${args.companies?.length}`,
        );
        const response = await axios.post(
          `${PRECEPT_API_URL}/v1/companies/insights`,
          args,
          { headers: getHeaders() },
        );
        console.log(
          `[Tool] precept_get_company_insights succeeded. jobId=${response.data?.enrichment_id || "none"}`,
        );
        return formatResponse(response.data);
      } catch (error) {
        return formatError(error, "fetching company insights");
      }
    },
  );

  // ──────────────────────────────────────────
  // 4. precept_search_companies
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_search_companies",
    {
      description:
        "Search for companies using natural language queries and optionally enrich them with insights, decision makers, or custom queries. " +
        "Examples: 'SaaS companies in London with 50-200 employees', 'Y Combinator startups in fintech', 'AI companies hiring in Berlin'. " +
        "IMPORTANT: Always verify user has sufficient credits with precept_check_credits before executing. Unless the user specifies a count, default to returning 30 on the first attempt and ask if they want more afterwards. " +
        "This is an async operation — it returns an enrichment_id (jobId) immediately. You MUST continuously poll precept_get_job_status every 4 seconds for up to 150 attempts (~10 minutes) while in progress, providing the user with status updates at least every 15 polls (~1 minute) until completed.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Natural language query to search for companies (e.g. 'SaaS companies in the UK with 50-200 employees').",
          ),
        limit: z
          .number()
          .max(1000)
          .optional()
          .describe(
            "Maximum number of companies to return (max 1000). Unless the user specifies a count, default to 30 on the first attempt and ask if they want more afterwards. Always verify the user has sufficient credits for the volume before executing.",
          ),
        name: z
          .string()
          .optional()
          .describe("A readable name for this enrichment job."),
        enrichments: enrichmentsSchema,
        queries: z
          .array(z.string())
          .optional()
          .describe(
            "Custom natural language questions to ask about each discovered company. Each query costs 0.2 credits per company.",
          ),
      }),
      outputSchema: asyncJobInitOutputSchema,
    },
    async (args) => {
      try {
        console.log(
          `[Tool] precept_search_companies starting... query="${args.query}", limit=${args.limit || "default"}`,
        );
        const response = await axios.post(
          `${PRECEPT_API_URL}/v1/companies/search`,
          args,
          { headers: getHeaders() },
        );
        console.log(
          `[Tool] precept_search_companies succeeded. jobId=${response.data?.enrichment_id || "none"}`,
        );
        return formatResponse(response.data);
      } catch (error) {
        return formatError(error, "searching companies");
      }
    },
  );

  // ──────────────────────────────────────────
  // 5. precept_get_job_status
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_get_job_status",
    {
      description:
        "Check the status and retrieve results of any Precept enrichment or search job. " +
        "All Precept tools (search leads, enrich leads, company insights, search companies) are asynchronous and return an enrichment_id (jobId). " +
        "MANDATORY POLLING RULE: Continue to poll this tool every 4 seconds for up to 150 attempts (~10 minutes) as long as the job status is in progress ('pending', 'processing', 'in_progress'). You MUST also provide the user with progress updates on what is happening at least every 15 polls (~1 minute) until completed. " +
        "If the job reaches 150 attempts (~10 minutes) and is still in progress, stop polling and inform the user to check back in a few minutes as it is taking longer than usual. " +
        "Returns status 'processing' with progress info while running, or 'completed' with the full results when done.",
      inputSchema: z.object({
        jobId: z
          .string()
          .describe(
            "The enrichment_id returned by any of the Precept search or enrichment tools.",
          ),
      }),
      outputSchema: jobStatusOutputSchema,
    },
    async ({ jobId }) => {
      try {
        console.log(`[Tool] precept_get_job_status starting... jobId=${jobId}`);
        const response = await axios.get(
          `${PRECEPT_API_URL}/v1/jobs/${jobId}`,
          { headers: getHeaders() },
        );
        const data = response.data;
        const progressInfo = data?.progress
          ? ` (progress: ${data.progress.completed || 0}/${data.progress.total || 0})`
          : "";
        console.log(
          `[Tool] precept_get_job_status succeeded. jobId=${jobId}, status=${data?.status}${progressInfo}`,
        );
        return formatResponse(data);
      } catch (error) {
        return formatError(error, `fetching job status for ${jobId}`);
      }
    },
  );

  // ──────────────────────────────────────────
  // 6. precept_check_credits
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_check_credits",
    {
      description:
        "Check the remaining credit balance for your Precept account. " +
        "Returns the total number of credits currently available for search and enrichment tasks, along with server version status.",
      inputSchema: z.object({}),
      outputSchema: checkCreditsOutputSchema,
    },
    async () => {
      try {
        console.log("[Tool] precept_check_credits starting...");
        const response = await axios.get(`${PRECEPT_API_URL}/v1/credits`, {
          headers: getHeaders(),
        });
        const versionStatus = await checkServerVersion(serverVersion);
        console.log(
          `[Tool] precept_check_credits succeeded. credits=${response.data?.credits}`,
        );
        return formatResponse({
          ...response.data,
          versionStatus,
        });
      } catch (error) {
        return formatError(error, "checking credits");
      }
    },
  );

  // ──────────────────────────────────────────
  // 7. precept_check_version
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_check_version",
    {
      description:
        "Check the current running version of the Precept MCP server against the latest published version. " +
        "Returns whether the server is up to date and provides instructions to refresh the connector if an update is available.",
      inputSchema: z.object({}),
      outputSchema: checkVersionOutputSchema,
    },
    async () => {
      try {
        console.log(
          `[Tool] precept_check_version starting... (running v${serverVersion})`,
        );
        const versionStatus = await checkServerVersion(serverVersion);
        console.log(
          `[Tool] precept_check_version succeeded: v${versionStatus.serverVersion}`,
        );
        return formatResponse(versionStatus);
      } catch (error) {
        return formatError(error, "checking version");
      }
    },
  );
}
