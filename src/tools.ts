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

export const CANONICAL_DEPARTMENTS = [
  "Underwriting",
  "Pricing",
  "Claims",
  "Actuary",
  "Logistics",
  "Risk & Compliance",
  "Sustainability",
  "Health & Safety",
  "Governance & Quality",
  "Procurement & Sourcing",
  "Finance & Accounting",
  "Founder",
  "Information Technology",
  "Security",
  "Innovation",
  "Data & Analytics",
  "Quality Control & Assurance",
  "C-Suite",
  "Sales",
  "CEO",
  "CFO",
  "COO",
  "Company-Secretary",
  "Corporate Secretary",
  "Administrative",
  "Human Resources",
  "Legal",
  "Engineering and Technical",
  "Customer Service",
  "Product",
  "Project Management",
  "Marketing",
  "Design",
  "Operations",
  "Research",
  "Trades",
  "Consulting",
  "Medical",
  "Real Estate",
  "Education",
] as const;

export const departmentEnum = z.enum(CANONICAL_DEPARTMENTS);

export const DEPARTMENTS_DESCRIPTION =
  "Canonical department names to find employees or insights for. Must be chosen from the enum values. " +
  "CONCEPTUAL MAPPING: Map broad business functions to the closest canonical enum options: " +
  "- 'Commercial', 'GTM', 'Go-to-market' -> ['Sales', 'Marketing']; " +
  "- 'Revenue', 'BizDev' -> ['Sales', 'Finance & Accounting']; " +
  "- 'Tech', 'Software', 'Developers' -> ['Engineering and Technical', 'Information Technology']; " +
  "- 'AI', 'ML', 'Data Science' -> ['Data & Analytics', 'Engineering and Technical']; " +
  "- 'People', 'Talent', 'Recruiting' -> ['Human Resources']; " +
  "- 'Leadership', 'Management' -> ['C-Suite', 'CEO', 'COO']; " +
  "- 'Cybersecurity', 'InfoSec' -> ['Security', 'Information Technology']; " +
  "- 'Supply Chain' -> ['Operations', 'Logistics']. " +
  "For bespoke or custom role titles (e.g. 'RevOps', 'DevRel', 'Full Stack Engineer'), use jobTitles instead. " +
  "SUBSCRIPTION LIMITS: Max 5 departments and max 10 job titles per subscription.";

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
      .array(departmentEnum)
      .max(40)
      .optional()
      .describe(DEPARTMENTS_DESCRIPTION),
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

const leadInputSchema = z.object({
  name: z.string().describe("Full name of the lead"),
  linkedinUrl: z.string().describe("LinkedIn profile URL of the lead"),
  email: z.string().optional().describe("Email address if available"),
  company: z.string().optional().describe("Company or employer name"),
  title: z.string().optional().describe("Job title or headline"),
  headline: z.string().optional().describe("Headline description"),
  note: z
    .string()
    .optional()
    .describe("Custom personalized connection note specifically for this lead"),
});

const extensionStatusOutputSchema = z
  .object({
    installed: z
      .boolean()
      .describe("Whether the Precept Chrome extension is installed"),
    active: z
      .boolean()
      .describe(
        "Whether the extension has communicated with Precept recently (<10 min)",
      ),
    lastSeenAt: z
      .string()
      .nullable()
      .optional()
      .describe("ISO timestamp of the last extension heartbeat check-in"),
    extensionVersion: z
      .string()
      .nullable()
      .optional()
      .describe("Installed version of the Chrome extension"),
    chromeStoreUrl: z
      .string()
      .describe("Direct Chrome Web Store URL to install the extension"),
    message: z
      .string()
      .describe("Human-readable status summary and next action instructions"),
  })
  .passthrough()
  .describe("Status of the user's Precept Chrome extension");

const queueCampaignOutputSchema = z
  .object({
    success: z.boolean(),
    campaignId: z.string().optional(),
    name: z.string().optional(),
    status: z
      .string()
      .optional()
      .describe(
        "'running' if it started immediately, 'queued' if placed behind an active campaign",
      ),
    queuePosition: z
      .number()
      .optional()
      .describe("Position in the outreach queue (1 = next in line)"),
    totalLeads: z.number().optional(),
    autoSavedListId: z
      .string()
      .optional()
      .describe("ID of the newly created lead list saved in Precept"),
    message: z.string().optional(),
  })
  .passthrough()
  .describe("Result of queuing the LinkedIn outreach campaign");

const sendMessageOutputSchema = z
  .object({
    success: z.boolean(),
    messageId: z.string().optional(),
    recipient: z
      .object({
        name: z.string().optional(),
        linkedinUrl: z.string().optional(),
      })
      .optional(),
    status: z
      .string()
      .optional()
      .describe("'pending' while awaiting extension check-in, or 'sent'"),
    deliveryMethod: z.string().optional(),
    message: z.string().optional(),
    warning: z.string().optional(),
  })
  .passthrough()
  .describe("Result of dispatching a LinkedIn message to a lead");

const messageStatusOutputSchema = z
  .object({
    success: z.boolean(),
    messageId: z.string(),
    status: z
      .string()
      .describe("'pending', 'sent', 'already_pending', or 'failed'"),
    deliveryMethod: z
      .string()
      .nullable()
      .optional()
      .describe(
        "'direct_message' (1st-degree connection) or 'connection_note' (fallback note)",
      ),
    recipient: z
      .object({
        name: z.string().optional(),
        linkedinUrl: z.string().optional(),
        company: z.string().optional(),
        title: z.string().optional(),
      })
      .optional(),
    queuedAt: z.string().optional(),
    processedAt: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
  })
  .passthrough()
  .describe("Current delivery status of a direct LinkedIn message");

const outreachQueueOutputSchema = z
  .object({
    activeCampaign: z
      .object({
        id: z.string(),
        name: z.string(),
        status: z.string(),
        currentIndex: z.number().optional(),
        totalCount: z.number().optional(),
        progressPct: z.number().optional(),
        rateLimitPause: z
          .object({
            isPaused: z.boolean(),
            resumeAt: z.string().nullable().optional(),
            remainingMinutes: z.number().optional(),
          })
          .optional(),
        stats: z
          .object({
            invited: z.number(),
            accepted: z.number(),
            messageSent: z.number(),
            replied: z.number(),
          })
          .optional(),
        latestLog: z.string().optional(),
      })
      .nullable()
      .optional(),
    queue: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        queuePosition: z.number(),
        totalLeads: z.number(),
        status: z.string(),
        createdAt: z.string().optional(),
      }),
    ),
    queueCount: z.number().optional(),
    history: z.array(z.any()).optional(),
    extension: z
      .object({
        installed: z.boolean(),
        active: z.boolean(),
        chromeStoreUrl: z.string(),
      })
      .optional(),
  })
  .passthrough()
  .describe("Current outreach queue, active campaign progress, and stats");

const manageQueueOutputSchema = z
  .object({
    success: z.boolean(),
    action: z.string(),
    campaignId: z.string().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    message: z.string(),
  })
  .passthrough()
  .describe("Result of managing outreach campaign lifecycle");

const subscriptionCompanySchema = z
  .object({
    companyName: z.string().describe("Name of the company."),
    companyWebsite: z
      .string()
      .optional()
      .describe(
        "Official company website domain or URL (e.g. 'stripe.com'). Recommended for accurate matching.",
      ),
    companyLinkedin: z
      .string()
      .optional()
      .describe(
        "Company LinkedIn URL (e.g. 'https://linkedin.com/company/stripe').",
      ),
  })
  .describe("Company to monitor for job postings.");

const subscriptionOutputSchema = z
  .object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    subscriptionId: z.string().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    companiesCount: z.number().optional(),
    frequencyDays: z.number().optional(),
    nextRunAt: z.number().optional(),
    droppedCompanies: z.array(z.any()).optional(),
    subscription: z.any().optional(),
    latestResult: z.any().optional(),
    count: z.number().optional(),
  })
  .passthrough()
  .describe("Subscription details and confirmation");

const subscriptionListOutputSchema = z
  .object({
    subscriptions: z.array(z.any()).optional(),
    count: z.number().optional(),
  })
  .passthrough()
  .describe("List of user's job posting subscriptions");

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
        "IMPORTANT: Always verify user has sufficient credits with precept_check_credits before executing. Silently default to returning 30 leads on the first attempt — DO NOT tell the user you are defaulting to 30 and DO NOT ask about volume or contact details upfront. " +
        "This is an async operation — it returns an enrichment_id (jobId) immediately. You MUST continuously poll precept_get_job_status every 4 seconds for up to 150 attempts (~10 minutes) while in progress, providing the user with status updates at least every 15 polls (~1 minute) until completed. " +
        "Upon completion, always try to give users the lead results in a sheet doc. " +
        "If you searched only default 30 leads on the first run, in the follow-up AFTER returning results, first tell the user that only 30 leads were searched for on this initial run, and then ask if they want to find more (asking them to specify how many more) or if they want to enrich the contacts with phone numbers or email addresses.",
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
            "Maximum number of leads to return (max 1000). Default is 30 on initial searches. DO NOT ask the user about volume or lead count upfront.",
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
            "Whether to find and verify email addresses and phone numbers for each discovered lead. Enables waterfall search across 140+ data providers (+1 credit for email per lead, +10 for phone per lead, or +11 for both per lead). Increases processing time significantly for phone numbers. IMPORTANT: Do NOT enable unless the user explicitly requested contact details in their prompt. DO NOT ask the user upfront if they want contact details.",
          ),
        signal: z
          .object({
            type: z.literal("post_interaction"),
            keywords: z
              .array(z.string())
              .min(1)
              .max(5)
              .describe(
                "1 to 5 keywords or phrases to find leads who recently engaged (posted, liked, commented) with relevant content.",
              ),
          })
          .optional()
          .describe(
            "Optional LinkedIn activity signal for filtering persona search. Finds leads matching your query who recently engaged with relevant posts. Adds +5 credits per lead. (For discovering leads directly from post authors matching keywords without a persona query, use precept_get_leads_from_post_search).",
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
  // 1b. precept_get_leads_from_post_search
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_get_leads_from_post_search",
    {
      description:
        "Discover business leads and contacts directly from authors who recently published LinkedIn posts matching specific keywords. " +
        "Unlike precept_search_leads (which searches by persona query), this tool discovers leads directly from content authors without requiring a persona query. " +
        "Each discovered lead includes their verified profile and the specific LinkedIn post they authored. " +
        "CRITICAL TIMEFRAME RULE: Do NOT silently default to 'month'. When a user asks to search posts without specifying a timeframe, the ONLY question you may ask the user upfront is their preferred timeframe: past 24 hours ('24h'), past week ('week'), or past month ('month'). DO NOT mention that you are searching for 30 leads or ask about volume upfront, and DO NOT ask if they want contact details (emails/phones) upfront. Silently default to 30 leads and without contact details. All other questions must come AFTER the first result is returned. " +
        "CRITICAL KEYWORD GUIDELINES: Keep keywords concise (1 to 3 words or a short phrase, e.g. ['SEO problem', 'struggling with SEO'] or ['AI workflow', 'marketing automation']). Do NOT generate long conversational sentences or filler phrases (e.g. avoid 'looking for a new senior product designer for our fintech startup') as long phrases drastically lower search engine recall. " +
        "IMPORTANT: Always verify user has sufficient credits with precept_check_credits before executing (+5 credits/lead for post search). Silently default to 30 on the first attempt without asking about count. " +
        "This is an async operation — it returns an enrichment_id (jobId) immediately. You MUST continuously poll precept_get_job_status every 4 seconds for up to 150 attempts (~10 minutes) while in progress. " +
        "Upon completion, always try to give users the lead results in a sheet doc. " +
        "If you searched only default 30 leads on the first run, in the follow-up AFTER returning results, first tell the user that only 30 leads were searched for on this initial run, and then ask if they want to find more (asking them to specify how many more) or if they want to enrich the contacts with phone numbers or email addresses.",
      inputSchema: z.object({
        keywords: z
          .array(z.string())
          .min(1)
          .max(5)
          .describe(
            "1 to 5 concise keywords or phrases to search LinkedIn posts for (e.g. ['SEO problem', 'struggling with SEO'] or ['AI workflow', 'marketing automation']). " +
              "Keep phrases short (1-3 words) to maximize search recall. Avoid full sentences or conversational filler.",
          ),
        description: z
          .string()
          .optional()
          .describe(
            "A clear, detailed description of what the user is searching for (e.g. 'Founders discussing AI workflow automation or marketing challenges'). " +
              "This provides context for relevance evaluation.",
          ),
        timeframe: z
          .enum(["24h", "day", "week", "month", "year"])
          .optional()
          .describe(
            "Timeframe of LinkedIn posts to search: '24h' (past 24 hours), 'week' (past week), 'month' (past month), or 'year' (past year). 'day' is also accepted for backward compatibility. " +
              "Do NOT silently default to 'month' if unspecified. ALWAYS ask the user whether they want posts from within the past 24 hours ('24h'), past week ('week'), or past month ('month') before calling this tool, unless they already specified it in their prompt.",
          ),
        location: z
          .string()
          .optional()
          .describe(
            "Optional target location/country to filter post authors by (e.g. 'United States', 'US', 'UK', 'Canada'). " +
              "Filters authors by verified profile location/country in real-time.",
          ),
        limit: z
          .number()
          .max(1000)
          .optional()
          .describe(
            "Maximum number of leads to return (max 1000). Default is 30 on initial searches. DO NOT ask the user about volume or lead count upfront.",
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
            "Whether to find and verify email addresses and phone numbers for discovered authors. Adds +1 credit for email, +10 for phone (or +11 for both) per person. IMPORTANT: Do NOT enable unless the user explicitly requested contact details in their prompt. DO NOT ask the user upfront if they want contact details.",
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
            "Optional. When true (and webhookUrl is provided), contact results are progressively streamed to the webhook as each lead is enriched.",
          ),
      }),
      outputSchema: asyncJobInitOutputSchema,
    },
    async (args) => {
      try {
        console.log(
          `[Tool] precept_get_leads_from_post_search starting... keywords=${JSON.stringify(args.keywords)}, limit=${args.limit || "default"}, contactDetails=${!!args.includeContactDetails}`,
        );
        const payload = {
          ...args,
          ...(args.timeframe
            ? { timeframe: args.timeframe === "day" ? "24h" : args.timeframe }
            : {}),
        };
        const response = await axios.post(
          `${PRECEPT_API_URL}/v1/leads/post-search`,
          payload,
          { headers: getHeaders() },
        );
        console.log(
          `[Tool] precept_get_leads_from_post_search succeeded. jobId=${response.data?.enrichment_id || "none"}`,
        );
        return formatResponse(response.data);
      } catch (error) {
        return formatError(error, "getting leads from post search");
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
        "This is an async operation — it returns an enrichment_id (jobId) immediately. You MUST continuously poll precept_get_job_status every 4 seconds for up to 150 attempts (~10 minutes) while in progress, providing the user with status updates at least every 15 polls (~1 minute) until completed. " +
        "Upon completion, always try to give users the lead results in a sheet doc.",
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
        interests: z
          .array(z.string())
          .max(5)
          .optional()
          .describe(
            "Optional array of up to 5 keyword interests for the batch (e.g. ['Banking', 'Insurance']). Precept researches the web to find verified information about each person related to these topics and appends findings as '[<Keyword> Interest]: ...' paragraphs to their professional summary.",
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
        "This is an async operation — it returns an enrichment_id (jobId) immediately. You MUST continuously poll precept_get_job_status every 4 seconds for up to 150 attempts (~10 minutes) while in progress, providing the user with status updates at least every 15 polls (~1 minute) until completed. " +
        "Upon completion, always try to give users the company results in a sheet doc.",
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
        "Examples: 'SaaS companies in London with 50-200 employees', 'Y Combinator startups in fintech', 'AI companies in Berlin'. " +
        "IMPORTANT: Always verify user has sufficient credits with precept_check_credits before executing. Unless the user specifies a count, default to returning 30 on the first attempt and ask if they want more afterwards. " +
        "This is an async operation — it returns an enrichment_id (jobId) immediately. You MUST continuously poll precept_get_job_status every 4 seconds for up to 150 attempts (~10 minutes) while in progress, providing the user with status updates at least every 15 polls (~1 minute) until completed. " +
        "Upon completion, always try to give users the company results in a sheet doc.",
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
        "Returns status 'processing' with progress info while running, or 'completed' with the full results when done. " +
        "When completed, always try to give users the lead or company results in a sheet doc. " +
        "For lead results, if you searched only default 30 leads on the first run, in the follow-up AFTER returning results, first tell the user that only 30 leads were searched for on this initial run, and then ask if they want to find more (asking them to specify how many more) or if they want to enrich the contacts with phone numbers or email addresses.",
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

  // ──────────────────────────────────────────
  // 8. precept_get_extension_status
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_get_extension_status",
    {
      description:
        "Check whether the user's Precept Chrome extension is installed, active, and communicating with Precept. " +
        "Automated outreach runs in the background of Google Chrome via this extension (no open tabs or DOM interaction needed). " +
        "If the extension is not installed or inactive, the response contains instructions and a direct Chrome Web Store link for the user.",
      inputSchema: z.object({}),
      outputSchema: extensionStatusOutputSchema,
    },
    async () => {
      try {
        console.log("[Tool] precept_get_extension_status starting...");
        const response = await axios.get(
          `${PRECEPT_API_URL}/v1/campaigns/extension-status`,
          { headers: getHeaders() },
        );
        console.log(
          `[Tool] precept_get_extension_status succeeded. installed=${response.data?.installed}, active=${response.data?.active}`,
        );
        return formatResponse(response.data);
      } catch (error) {
        return formatError(error, "checking extension status");
      }
    },
  );

  // ──────────────────────────────────────────
  // 9. precept_queue_campaign
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_queue_campaign",
    {
      description:
        "Queue an automated LinkedIn outreach campaign to connect with leads. " +
        "Supports queuing ad-hoc leads directly from search results without needing a pre-saved list (with optional auto-saving to your Precept lead lists), or referencing an existing saved leadsListId. " +
        "If an outreach campaign is already running or paused, this campaign will be placed safely into the queue in FIFO order.",
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            "Descriptive name for the campaign (e.g. 'Fintech Founders Outreach - London Q3').",
          ),
        leads: z
          .array(leadInputSchema)
          .optional()
          .describe(
            "Array of leads to reach out to. Must include at least 'name' and 'linkedinUrl'. Required if leadsListId is not provided.",
          ),
        leadsListId: z
          .string()
          .optional()
          .describe(
            "ID of an existing Precept lead list to run outreach on. Required if leads is not provided.",
          ),
        includePersonalizedNote: z
          .boolean()
          .optional()
          .describe(
            "Whether to include a personalized message note with the connection request. Defaults to true if a note or noteTemplate is provided.",
          ),
        noteTemplate: z
          .string()
          .optional()
          .describe(
            "Template for personalized connection note. Supports template variables: {{firstName}}, {{company}}, {{title}}. Example: 'Hi {{firstName}}, noticed your work at {{company}} and would love to connect!'",
          ),
        autoSaveLeadsList: z
          .boolean()
          .optional()
          .describe(
            "When providing ad-hoc leads directly from search results, automatically saves them as a new lead list in your Precept account for future reference. Defaults to true.",
          ),
      }),
      outputSchema: queueCampaignOutputSchema,
    },
    async ({
      name,
      leads,
      leadsListId,
      includePersonalizedNote,
      noteTemplate,
      autoSaveLeadsList,
    }) => {
      try {
        console.log(
          `[Tool] precept_queue_campaign starting... name=${name}, leadsCount=${leads?.length || 0}, leadsListId=${leadsListId}`,
        );
        const response = await axios.post(
          `${PRECEPT_API_URL}/v1/campaigns/queue`,
          {
            name,
            leads,
            leadsListId,
            includePersonalizedNote,
            noteTemplate,
            autoSaveLeadsList,
          },
          { headers: getHeaders() },
        );
        console.log(
          `[Tool] precept_queue_campaign succeeded. campaignId=${response.data?.campaignId}, status=${response.data?.status}, queuePosition=${response.data?.queuePosition}`,
        );
        return formatResponse(response.data);
      } catch (error) {
        return formatError(error, `queuing campaign '${name}'`);
      }
    },
  );

  // ──────────────────────────────────────────
  // 10. precept_get_outreach_queue
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_get_outreach_queue",
    {
      description:
        "Get full visibility into the current LinkedIn outreach queue. " +
        "Returns the actively running campaign (with live progress, rate-limit sleep countdowns, and accepted invite stats), upcoming queued campaigns with their queue positions, and extension liveness.",
      inputSchema: z.object({}),
      outputSchema: outreachQueueOutputSchema,
    },
    async () => {
      try {
        console.log("[Tool] precept_get_outreach_queue starting...");
        const response = await axios.get(
          `${PRECEPT_API_URL}/v1/campaigns/queue`,
          { headers: getHeaders() },
        );
        const activeName = response.data?.activeCampaign?.name || "none";
        const queueLen = response.data?.queue?.length || 0;
        console.log(
          `[Tool] precept_get_outreach_queue succeeded. active=${activeName}, queueLength=${queueLen}`,
        );
        return formatResponse(response.data);
      } catch (error) {
        return formatError(error, "fetching outreach queue");
      }
    },
  );

  // ──────────────────────────────────────────
  // 11. precept_manage_queue
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_manage_queue",
    {
      description:
        "Manage the LinkedIn outreach queue. Pause active outreach, resume paused campaigns, archive an active campaign to History, or remove an upcoming campaign from the queue.",
      inputSchema: z.object({
        action: z
          .enum(["pause", "resume", "archive", "cancel", "remove"])
          .describe(
            "The management action to perform: 'pause' to temporarily halt outreach, 'resume' to continue outreach, 'archive' (or 'cancel') to end outreach and move the campaign to History, or 'remove' to remove an upcoming campaign from the queue.",
          ),
        campaignId: z
          .string()
          .optional()
          .describe(
            "Specific campaign ID to pause, resume, or cancel. If omitted for pause or resume, targets the currently active campaign.",
          ),
      }),
      outputSchema: manageQueueOutputSchema,
    },
    async ({ action, campaignId }) => {
      try {
        console.log(
          `[Tool] precept_manage_queue starting... action=${action}, campaignId=${campaignId || "active"}`,
        );
        const response = await axios.post(
          `${PRECEPT_API_URL}/v1/campaigns/action`,
          { action, campaignId },
          { headers: getHeaders() },
        );
        console.log(
          `[Tool] precept_manage_queue succeeded: ${response.data?.message}`,
        );
        return formatResponse(response.data);
      } catch (error) {
        return formatError(
          error,
          `performing action '${action}' on campaign ${campaignId || "active"}`,
        );
      }
    },
  );

  // ──────────────────────────────────────────
  // 12. precept_send_message
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_send_message",
    {
      description:
        "Send a direct message or outreach note to an individual LinkedIn lead via the Precept Chrome extension. " +
        "MANDATORY PRE-CHECK: Before calling this tool, you MUST first verify that the extension is active using `precept_get_extension_status`. " +
        "MANDATORY POLLING RULE: Once dispatched, you MUST continuously poll `precept_get_message_status` up to 40 times (every 3 seconds) while status is 'pending'. " +
        "If status becomes 'sent', 'already_pending', or 'failed', present the final outcome (including error details if failed). " +
        "If still pending after 40 checks, tell the user it is taking longer than usual and they can check back later. " +
        "If the lead is already a 1st-degree connection, it delivers as a direct message (DM). " +
        "If the lead is not connected, it automatically routes to a connection request with your message as a personalized note (capped at 200 chars).",
      inputSchema: z.object({
        recipient: z
          .object({
            name: z
              .string()
              .describe("Full name of the recipient (e.g. 'Sarah Miller')."),
            linkedinUrl: z
              .string()
              .describe(
                "Full LinkedIn profile URL of the recipient (e.g. 'https://www.linkedin.com/in/sarahmiller').",
              ),
            company: z
              .string()
              .optional()
              .describe("Company name of the lead (e.g. 'Stripe')."),
            title: z
              .string()
              .optional()
              .describe("Job title of the lead (e.g. 'VP of Engineering')."),
          })
          .describe("The lead to send the message to."),
        message: z
          .string()
          .describe(
            "The message text to send. Keep it concise (ideally under 200 characters) so it can cleanly fit as a connection request note if the recipient is not yet connected.",
          ),
        fallbackToConnectionNote: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Whether to automatically fall back to sending a connection request with this message as a note if the lead is not a 1st-degree connection. Defaults to true.",
          ),
      }),
      outputSchema: sendMessageOutputSchema,
    },
    async ({ recipient, message, fallbackToConnectionNote }) => {
      try {
        console.log(
          `[Tool] precept_send_message starting... recipient=${recipient?.name} (${recipient?.linkedinUrl})`,
        );

        // Extension liveness & version check
        try {
          const extCheck = await axios.get(
            `${PRECEPT_API_URL}/v1/campaigns/extension-status`,
            { headers: getHeaders() },
          );
          if (extCheck.data && !extCheck.data.active) {
            return formatResponse({
              success: false,
              warning: "Extension Inactive",
              message:
                "The Precept Chrome extension is not active. Please ensure Google Chrome is open and logged into LinkedIn so the message can be delivered.",
            });
          }
          const ver = extCheck.data?.extensionVersion || "1.1.1";
          const parts = ver.split(".").map((n: string) => parseInt(n, 10) || 0);
          const isSupported =
            parts[0] > 1 ||
            (parts[0] === 1 && parts[1] > 1) ||
            (parts[0] === 1 && parts[1] === 1 && (parts[2] || 0) >= 3);
          if (extCheck.data?.installed && !isSupported) {
            return formatResponse({
              success: false,
              warning: "Extension Update Required",
              message: `Direct messaging requires Precept Chrome extension v1.1.3 or higher. You are currently running v${ver}. Please reload or update the extension from chrome://extensions.`,
            });
          }
        } catch (extErr) {
          console.warn(
            "[Tool] precept_send_message extension check warning:",
            extErr,
          );
        }

        const response = await axios.post(
          `${PRECEPT_API_URL}/v1/messages/send`,
          {
            recipient,
            message,
            fallbackToConnectionNote: fallbackToConnectionNote !== false,
          },
          { headers: getHeaders() },
        );

        console.log(
          `[Tool] precept_send_message succeeded. messageId=${response.data?.messageId}, status=${response.data?.status}`,
        );
        return formatResponse(response.data);
      } catch (error) {
        return formatError(
          error,
          `sending message to '${recipient?.name || "recipient"}'`,
        );
      }
    },
  );

  // ──────────────────────────────────────────
  // 13. precept_get_message_status
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_get_message_status",
    {
      description:
        "Check the delivery status of a direct LinkedIn message previously dispatched via precept_send_message. " +
        "MANDATORY POLLING RULE: Poll this tool up to 40 times (every 3 seconds) while status is 'pending'. " +
        "If status becomes 'sent', 'already_pending', or 'failed', present the final outcome (including error details if failed). " +
        "If still pending after 40 checks, tell the user it is taking longer than usual and they can check back later.",
      inputSchema: z.object({
        messageId: z
          .string()
          .describe(
            "The message ID returned by precept_send_message (e.g. 'msg_1726237000000_abc').",
          ),
      }),
      outputSchema: messageStatusOutputSchema,
    },
    async ({ messageId }) => {
      try {
        console.log(
          `[Tool] precept_get_message_status starting... messageId=${messageId}`,
        );
        const response = await axios.get(
          `${PRECEPT_API_URL}/v1/messages/${messageId}`,
          { headers: getHeaders() },
        );
        return formatResponse(response.data);
      } catch (error) {
        return formatError(
          error,
          `checking delivery status for message '${messageId}'`,
        );
      }
    },
  );

  // ──────────────────────────────────────────
  // 14. precept_create_job_posting_subscription
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_create_job_posting_subscription",
    {
      description:
        "Create an automated recurring subscription to monitor target companies for active job postings and discover matching decision makers for those roles. " +
        "Precept checks for open positions in the specified departments or job titles on your chosen cadence (every 7 to 30 days, default 7). When open positions are found, it discovers up to 10 key decision makers for those exact roles. " +
        "Guarantees automatic lead deduplication: previously returned decision makers are never re-fetched or charged on recurring runs. " +
        "Supports 'runImmediately: true' (default: true) to start the first search run right away. " +
        "Results can be fetched via 'precept_get_job_posting_subscription' or delivered automatically to an optional 'webhookUrl'. " +
        "You can monitor up to 100 companies per subscription. Max 5 departments and 10 job titles per subscription.",
      inputSchema: z.object({
        name: z
          .string()
          .optional()
          .describe(
            "A readable name for this subscription (e.g. 'Fintech Underwriting Hiring').",
          ),
        companies: z
          .array(subscriptionCompanySchema)
          .min(1)
          .max(100)
          .describe(
            "Array of up to 100 companies to monitor. Each company must include 'companyName' and at least 'companyWebsite' or 'companyLinkedin'.",
          ),
        departments: z
          .array(departmentEnum)
          .max(5)
          .optional()
          .describe(DEPARTMENTS_DESCRIPTION),
        jobTitles: z
          .array(z.string())
          .max(10)
          .optional()
          .describe(
            "Specific job titles to monitor (max 10, e.g. ['Underwriting Lead', 'VP Sales']).",
          ),
        frequencyDays: z
          .number()
          .min(7)
          .max(30)
          .optional()
          .describe(
            "Cadence in days between automated checks. Minimum 7 days, maximum 30 days. Default: 7 (weekly).",
          ),
        runImmediately: z
          .boolean()
          .optional()
          .describe(
            "Whether to immediately start the first run upon creation (default: true).",
          ),
        webhookUrl: z
          .string()
          .url()
          .optional()
          .describe(
            "Optional webhook URL where findings will be POSTed on each completed run.",
          ),
      }),
      outputSchema: subscriptionOutputSchema,
    },
    async (args) => {
      try {
        console.log(
          `[Tool] precept_create_job_posting_subscription starting... companiesCount=${args.companies?.length}, name='${args.name || "unnamed"}'`,
        );
        const response = await axios.post(
          `${PRECEPT_API_URL}/v1/subscriptions/job-postings`,
          args,
          { headers: getHeaders() },
        );
        const data = response.data;
        const sub = data?.subscription || {};
        const formatted = {
          success: data?.success ?? true,
          message: data?.message ?? "Subscription created successfully.",
          subscriptionId: sub.id,
          name: sub.name,
          status: sub.status,
          companiesCount:
            sub.companiesCount ??
            (Array.isArray(sub.companies)
              ? sub.companies.length
              : args.companies?.length),
          frequencyDays: sub.frequencyDays,
          nextRunAt: sub.nextRunAt,
          ...(data?.droppedCompanies?.length
            ? { droppedCompanies: data.droppedCompanies }
            : {}),
        };
        return formatResponse(formatted);
      } catch (error) {
        return formatError(error, "creating job posting subscription");
      }
    },
  );

  // ──────────────────────────────────────────
  // 15. precept_get_job_posting_subscription
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_get_job_posting_subscription",
    {
      description:
        "Retrieve a job posting subscription by ID, including its configuration, active status, cadence, and latest findings (active job postings and discovered decision makers). " +
        "Returns the most recent batch of results found for each monitored company.",
      inputSchema: z.object({
        subscriptionId: z
          .string()
          .describe("The unique ID of the subscription to retrieve."),
      }),
      outputSchema: subscriptionOutputSchema,
    },
    async ({ subscriptionId }) => {
      try {
        console.log(
          `[Tool] precept_get_job_posting_subscription starting... subscriptionId=${subscriptionId}`,
        );
        const response = await axios.get(
          `${PRECEPT_API_URL}/v1/subscriptions/job-postings/${subscriptionId}`,
          { headers: getHeaders() },
        );
        const data = response.data;
        if (data?.subscription) {
          const { seenLeadIds, ...rest } = data.subscription;
          data.subscription = {
            ...rest,
            seenLeadsCount:
              data.subscription.seenLeadsCount ?? (seenLeadIds?.length || 0),
          };
        }
        return formatResponse(data);
      } catch (error) {
        return formatError(
          error,
          `fetching job posting subscription '${subscriptionId}'`,
        );
      }
    },
  );

  // ──────────────────────────────────────────
  // 16. precept_update_job_posting_subscription
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_update_job_posting_subscription",
    {
      description:
        "Update an existing job posting subscription. Allows adding or removing companies, changing target departments or job titles, updating cadence (7-30 days), setting/clearing webhookUrl, or pausing/resuming.",
      inputSchema: z.object({
        subscriptionId: z
          .string()
          .describe("The unique ID of the subscription to update."),
        name: z.string().optional().describe("Updated name for the subscription."),
        companies: z
          .array(subscriptionCompanySchema)
          .max(100)
          .optional()
          .describe(
            "Replace the full list of monitored companies with this array (max 100).",
          ),
        addCompanies: z
          .array(subscriptionCompanySchema)
          .optional()
          .describe(
            "Append new companies to the existing monitored list (total cannot exceed 100).",
          ),
        removeCompanyWebsites: z
          .array(z.string())
          .optional()
          .describe(
            "List of company website domains to remove from the monitored list.",
          ),
        departments: z
          .array(departmentEnum)
          .max(5)
          .optional()
          .describe(DEPARTMENTS_DESCRIPTION),
        jobTitles: z
          .array(z.string())
          .max(10)
          .optional()
          .describe("Updated list of job titles to monitor (max 10)."),
        frequencyDays: z
          .number()
          .min(7)
          .max(30)
          .optional()
          .describe("Updated cadence in days (7 to 30)."),
        webhookUrl: z
          .string()
          .url()
          .optional()
          .describe(
            "Updated webhook URL, or empty string to disable webhook delivery.",
          ),
        status: z
          .enum(["active", "paused"])
          .optional()
          .describe("Change subscription status: 'active' to run on schedule, 'paused' to halt."),
      }),
      outputSchema: subscriptionOutputSchema,
    },
    async ({ subscriptionId, ...updateFields }) => {
      try {
        console.log(
          `[Tool] precept_update_job_posting_subscription starting... subscriptionId=${subscriptionId}`,
        );
        const response = await axios.patch(
          `${PRECEPT_API_URL}/v1/subscriptions/job-postings/${subscriptionId}`,
          updateFields,
          { headers: getHeaders() },
        );
        const data = response.data;
        const sub = data?.subscription || {};
        const formatted = {
          success: data?.success ?? true,
          message: data?.message ?? "Subscription updated successfully.",
          subscriptionId: sub.id || subscriptionId,
          name: sub.name,
          status: sub.status,
          companiesCount:
            sub.companiesCount ??
            (Array.isArray(sub.companies) ? sub.companies.length : undefined),
          frequencyDays: sub.frequencyDays,
          nextRunAt: sub.nextRunAt,
          ...(data?.droppedCompanies?.length
            ? { droppedCompanies: data.droppedCompanies }
            : {}),
        };
        return formatResponse(formatted);
      } catch (error) {
        return formatError(
          error,
          `updating job posting subscription '${subscriptionId}'`,
        );
      }
    },
  );

  // ──────────────────────────────────────────
  // 17. precept_list_job_posting_subscriptions
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_list_job_posting_subscriptions",
    {
      description:
        "List all job posting subscriptions created for your account, showing monitored companies, status ('active', 'paused', 'insufficient_credits'), and run schedule.",
      inputSchema: z.object({}),
      outputSchema: subscriptionListOutputSchema,
    },
    async () => {
      try {
        console.log("[Tool] precept_list_job_posting_subscriptions starting...");
        const response = await axios.get(
          `${PRECEPT_API_URL}/v1/subscriptions/job-postings`,
          { headers: getHeaders() },
        );
        const rawSubs = response.data?.subscriptions || [];
        const subscriptions = rawSubs.map((sub: any) => {
          const { seenLeadIds, ...rest } = sub;
          return {
            id: rest.id,
            name: rest.name,
            status: rest.status,
            companiesCount:
              rest.companiesCount ??
              (Array.isArray(rest.companies) ? rest.companies.length : 0),
            departments: rest.departments,
            jobTitles: rest.jobTitles,
            frequencyDays: rest.frequencyDays,
            nextRunAt: rest.nextRunAt,
            lastRunAt: rest.lastRunAt,
            createdAt: rest.createdAt,
            updatedAt: rest.updatedAt,
          };
        });
        return formatResponse({
          subscriptions,
          count: subscriptions.length,
        });
      } catch (error) {
        return formatError(error, "listing job posting subscriptions");
      }
    },
  );

  // ──────────────────────────────────────────
  // 18. precept_delete_job_posting_subscription
  // ──────────────────────────────────────────
  server.registerTool(
    "precept_delete_job_posting_subscription",
    {
      description:
        "Cancel and permanently delete an automated job posting subscription.",
      inputSchema: z.object({
        subscriptionId: z
          .string()
          .describe("The unique ID of the subscription to delete."),
      }),
      outputSchema: subscriptionOutputSchema,
    },
    async ({ subscriptionId }) => {
      try {
        console.log(
          `[Tool] precept_delete_job_posting_subscription starting... subscriptionId=${subscriptionId}`,
        );
        const response = await axios.delete(
          `${PRECEPT_API_URL}/v1/subscriptions/job-postings/${subscriptionId}`,
          { headers: getHeaders() },
        );
        return formatResponse(response.data);
      } catch (error) {
        return formatError(
          error,
          `deleting job posting subscription '${subscriptionId}'`,
        );
      }
    },
  );
}
