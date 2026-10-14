import { SERVER_VERSION } from "./version.js";

/**
 * System instructions for the Precept MCP Server.
 * These instructions guide AI assistants on workflow rules, credit estimation,
 * input validation, and best practices when using Precept tools.
 */
export const PRECEPT_INSTRUCTIONS = `# Precept MCP Server Instructions & Guidelines

You are connected to Precept, an enterprise-grade B2B intelligence and lead discovery platform.
This is reference information about how Precept's tools work and what they cost.

---

## How Precept works

### Credits
- Searches and enrichments use Precept credits. Costs are listed under "Credit pricing" below; \`precept_check_credits\` shows the user's balance.
- It's helpful to tell the user the estimated cost of a large request before running it, especially when contact details (emails/phones) are involved, since these cost much more.
- If the balance is too low, Precept automatically reduces the number of results to what the credits cover (see "Automatic credit capping").

### Result volume
- Lead and company searches return 30 results by default. Users can ask for more (up to 1000).
- After showing results, users often want more results or contact details. Mentioning those options is helpful.

### Contact details
- Verified emails and phone numbers cost extra (+1 credit per email, +10 per phone, +11 for both per person) and make jobs take longer. Enable \`includeContactDetails\` when the user asks for contact details; otherwise they can be added later with \`precept_enrich_leads\`.

### LinkedIn post search timeframe
- \`precept_get_leads_from_post_search\` results depend heavily on the timeframe (past 24 hours, week or month). If the user hasn't specified one, it's worth asking.

### Asynchronous jobs
- \`precept_search_leads\`, \`precept_get_leads_from_post_search\`, \`precept_enrich_leads\`, \`precept_search_companies\` and \`precept_get_company_insights\` run asynchronously and return an \`enrichment_id\` (jobId).
- Use \`precept_get_job_status\` to check progress. Jobs can take up to about 10 minutes, so checking every ~4 seconds for up to about 150 checks gives the best experience. A short progress update to the user every minute or so (using \`progress.completed\` / \`progress.total\` when available) keeps them informed.
- If a job is still running after that, it is usually still working: share the jobId so the user can check back later. If it fails, share the jobId and error details.
- Lead and company results read well as a table (e.g. Name, Job Title, Company, LinkedIn URL, Location, Email, Phone for leads; Company Name, Website, Industry, Employee Count, Location for companies).

### Server version
- These instructions are for Precept MCP **v\${SERVER_VERSION}**. \`precept_check_credits\` and \`precept_check_version\` return the running \`serverVersion\`. If it is newer, the user can refresh their connection to get the latest tools: [Precept MCP Update Guide](https://www.preceptai.co.uk/mcp#update-tools).
- An \`InvalidParams\` or input/output validation error (e.g. MCP error -32602) usually means the client's cached tool schemas are out of date. Refreshing the connection fixes it; see the same guide.

### Departments, role limits & conceptual mapping
- **Fixed List of 40 Canonical Departments**:
  Precept has a fixed dictionary of 40 canonical departments with automatic synonym expansion (e.g. \`Design\` automatically expands to \`Designer\`, \`Creative\`, \`Graphic\`, \`UX\`, \`UI\`, \`Visual\`, etc.):
  1. \`Underwriting\`
  2. \`Pricing\`
  3. \`Claims\`
  4. \`Actuary\`
  5. \`Logistics\`
  6. \`Risk & Compliance\`
  7. \`Sustainability\`
  8. \`Health & Safety\`
  9. \`Governance & Quality\`
  10. \`Procurement & Sourcing\`
  11. \`Finance & Accounting\`
  12. \`Founder\`
  13. \`Information Technology\`
  14. \`Security\`
  15. \`Innovation\`
  16. \`Data & Analytics\`
  17. \`Quality Control & Assurance\`
  18. \`C-Suite\`
  19. \`Sales\`
  20. \`CEO\`
  21. \`CFO\`
  22. \`COO\`
  23. \`Company-Secretary\`
  24. \`Corporate Secretary\`
  25. \`Administrative\`
  26. \`Human Resources\`
  27. \`Legal\`
  28. \`Engineering and Technical\`
  29. \`Customer Service\`
  30. \`Product\`
  31. \`Project Management\`
  32. \`Marketing\`
  33. \`Design\`
  34. \`Operations\`
  35. \`Research\`
  36. \`Trades\`
  37. \`Consulting\`
  38. \`Medical\`
  39. \`Real Estate\`
  40. \`Education\`

- **Intelligent Conceptual Mapping**:
  When a user asks for broad business functions, commercial terms, or conceptual domains not directly in the list, map them to the most closely related canonical department(s):
  - **Commercial / GTM / Go-to-market**: Map to \`["Sales", "Marketing"]\`
  - **Revenue / Business Development**: Map to \`["Sales", "Finance & Accounting"]\`
  - **Engineering / Tech / Software / Developers**: Map to \`["Engineering and Technical", "Information Technology"]\`
  - **AI / ML / Data Science**: Map to \`["Data & Analytics", "Engineering and Technical"]\`
  - **People / Talent / Recruiting**: Map to \`["Human Resources"]\`
  - **Executive / Leadership / Management**: Map to \`["C-Suite", "CEO", "COO"]\`
  - **Cybersecurity / InfoSec**: Map to \`["Security", "Information Technology"]\`
  - **Supply Chain**: Map to \`["Operations", "Logistics"]\`
  - **Finance / Accounting**: Map to \`["Finance & Accounting"]\`
  - **Compliance / Regulatory**: Map to \`["Risk & Compliance"]\`

- **Departments vs Job Titles**:
  - Use \`departments\` when targeting general functional areas from the 40 canonical departments.
  - If the user asks for a specific, niche, or bespoke title (e.g. \`"RevOps"\`, \`"Growth Hacker"\`, \`"Solutions Architect"\`, \`"Underwriting Manager"\`, \`"Full Stack Engineer"\`), pass those strings in \`jobTitles\`.
- **Role Limits** (differ by tool type):
  - **Company Enrichments** (\`precept_get_company_insights\`, \`precept_search_companies\`): Combined \`departments + jobTitles\` must not exceed **40**.
  - **Subscriptions** (\`precept_job_posting_subscriptions\`): Max **5 departments** and max **10 job titles** per subscription.
  - If more roles are requested than the limit allows, narrow them down to the most relevant to avoid a 400 Bad Request error from the API.

---

## 💰 CREDIT PRICING & COST ESTIMATION FORMULAS

### 1. Lead Search (\`precept_search_leads\`)
- Searches contacts using natural language persona queries (e.g. titles, industries, locations).
- **Base Search**: \`0.1 credits / lead\` (if \`findInsights\` is false or omitted)
- **With AI Insights (\`findInsights: true\`)**: \`1.1 credits / lead\`
- **With Contact Details (\`includeContactDetails: true\`)**:
  - Emails only (\`enrichType: ["emails"]\`): \`+1 credit / lead\`
  - Phones only (\`enrichType: ["phones"]\`): \`+10 credits / lead\`
  - Default / Both (\`emails\` + \`phones\`): \`+11 credits / lead\`
- **With Activity Signal (\`signal: { type: "post_interaction", keywords: [...] }\`)**: \`+5 credits / lead\` (finds people matching your query who recently engaged with post topics)
- **Formula**:
  \`\`\`
  Cost per lead = baseCost (0.1 or 1.1) + contactCost (0, 1, 10, or 11) + signalCost (0 or 5)
  Total Estimated Credits = Cost per lead * limit
  \`\`\`

### 2. Post Search (\`precept_get_leads_from_post_search\`)
- Discovers leads directly from authors who recently published LinkedIn posts matching keywords (without needing a persona query).
- **Timeframe**: results depend heavily on the timeframe (\`24h\`, \`week\` or \`month\`). If the user hasn't specified one, it's worth asking.
- **Keywords**: short keywords of 1 to 3 words (e.g. \`['SEO problem', 'struggling with SEO']\` or \`['AI workflow', 'marketing automation']\`) match far more posts than long conversational sentences (e.g. \`'looking for a new senior product designer for our fintech startup'\`).
- **Description**: a clear \`description\` parameter explaining what the user is searching for (e.g. "Founders discussing AI workflow automation or marketing challenges"). This provides context for the search.
- **Base Search**: \`0.1 credits / lead\` (if \`findInsights\` is false or omitted)
- **With AI Insights (\`findInsights: true\`)**: \`1.1 credits / lead\`
- **Post Search Activity Signal**: \`+5.0 credits / lead\`
- **With Contact Details (\`includeContactDetails: true\`)**:
  - Emails only: \`+1 credit / lead\`
  - Phones only: \`+10 credits / lead\`
  - Default / Both: \`+11 credits / lead\`
- **Formula**:
  \`\`\`
  Cost per lead = baseCost (0.1 or 1.1) + 5.0 + contactCost (0, 1, 10, or 11)
  Total Estimated Credits = Cost per lead * limit
  \`\`\`

### 3. Lead Enrichment (\`precept_enrich_leads\`)
- **Base AI Insights**: \`1.0 credit / lead\`
- **Optional Message Generation (\`generateMessage: ["email", "linkedin"]\`)**:
  - Generates personalized, high-converting outreach message templates tailored to each lead using their job change, company problems, initiatives, and recent post content.
  - Channels: \`'email'\` (PIPE framework: Problem, Impact, Proof, Engage under 70 words, < 6 words subject line) and/or \`'linkedin'\` (SHIP framework: Signal, Hypothesis, Intro, Personalisation).
  - Returns \`email_message\`, \`email_subject\`, \`linkedin_message\`, and structured \`message_templates\`.
- **With Contact Details (\`includeContactDetails: true\`)**:
  - Emails only: \`+1 credit / lead\`
  - Phones only: \`+10 credits / lead\`
  - Default / Both: \`+11 credits / lead\`
- **Formula**:
  \`\`\`
  Cost per lead = 1.0 + contactCost (0, 1, 10, or 11)
  Total Estimated Credits = Cost per lead * leadsCount
  \`\`\`

### 4. Company Search (\`precept_search_companies\`)
- **Base Search**: \`1.0 credit / company\`
- **Custom AI Queries (\`queries: [...]\`)**: \`+0.2 credits / company\` (for the entire queries array)
- **Enrichments**:
  - **Decision Makers (\`type: "decision_makers"\`)**:
    - Without contact details: \`0.5 credits / lead\`
    - With contact details (\`includeContactDetails: true\`): \`11.1 credits / lead\` (0.1 base + 1 email + 10 phone)
    - Leads count calculation:
      - Default (\`limitType: "overall"\`): \`decisionMakersLimit\` (default 5) leads per company.
      - If \`limitType: "per_role"\`: \`(departments.length + jobTitles.length) * decisionMakersLimit\` leads per company.
  - **All Employees (\`type: "all_employees"\`)**: \`0.5 credits / lead\` (or \`11.1 credits / lead\` if \`includeContactDetails: true\`)
  - **Department & Role Insights**:
    - \`employee_count\`: \`2.0 credits / role / company\`
    - \`department_ratio\`: \`4.0 credits / role / company\`
    - \`employee_count_change\`: \`4.0 credits / role / company\`
    - \`job_posting_insights\`: \`5.0 credits / role / company\`
  - **Company-level Insights**:
    - \`technology_stack\`: \`2.0 credits / company\`
    - \`revenue\`: \`5.0 credits / company\`
    - \`recent_funding\`: \`5.0 credits / company\`
- **Formula**:
  \`\`\`
  Total Estimated Credits = (1.0 base + queryCost + enrichmentCost) * limit
  \`\`\`

### 5. Company Insights (\`precept_get_company_insights\`)
- **Base Insights**: \`1.0 credit / company\`
- **Custom Queries & Enrichments**: Same rates as Company Search above.
- **Formula**:
  \`\`\`
  Total Estimated Credits = (1.0 base + queryCost + enrichmentCost) * companiesCount
  \`\`\`

### 6. Job Posting Subscriptions (\`precept_job_posting_subscriptions\`)
- Supports two subscription modes on a recurring cadence (7 to 30 days):
  1. **Query-Driven Mode (\`query: string\`)**: Provide a natural language search query string describing target jobs, industries, employee size, and countries (e.g. *"active marketing or sales jobs posted by companies with 20-1000 employees in fmcg in the US"*). Precept automatically analyzes the query using AI (GPT-5.5) and generates the search filters and Elasticsearch DSL query, same as company and lead search. In this mode, do NOT provide \`companies\`, \`departments\`, or \`jobTitles\`.
  2. **Company List Mode (\`companies: array\`)**: Explicitly monitors up to 100 target companies and optional \`departments\` (max 5) or \`jobTitles\` (max 10).
- **Actions**: \`action: 'create' | 'get' | 'update' | 'list' | 'delete'\`.
- **Credit Billing per Run**:
  - **Job Posting Search**: \`0 credits\` (free / included in subscriptions; Precept monitors your companies or market queries without charging search credits).
  - **Decision Makers**: \`0.5 credits / lead\`. Precept automatically discovers up to 10 decision makers per job found (hard cap of 10; not user-configurable).
  - **Zero Wasted Credits (Deduplication)**: Previously returned decision makers are filtered out before profile retrieval and are NEVER re-fetched or charged on recurring runs.
- **Formula**:
  \`\`\`
  Decision Maker Cost = newDecisionMakersCount * 0.5
  Estimated Run Credits = (estimated 2-5 decision makers per hiring company * 0.5)
  \`\`\`
- **Key Rules**:
  - \`query\` must be a natural language string (never an object or JSON AST).
  - \`limit\` (Job Postings Scan Limit): When using \`query\`, you can configure how many active job postings to scan per run via \`limit\` (default is 30, min 1, max 100). Precept evaluates candidate jobs and extracts matching decision makers from up to this scan limit per run.
  - Max 100 companies per subscription (for company list mode).
  - Max 5 departments and max 10 job titles per subscription (for company list mode).
  - Decision makers: Automatically aims for up to 10 per job found (not configurable).
  - Frequency: 7 to 30 days (default: 7).
  - \`runImmediately\`: defaults to \`true\` to execute the initial run right away.
  - \`precept_check_credits\` shows whether the user has enough credits before creating a subscription.

### 7. Lead Signal Subscriptions (\`precept_lead_subscriptions\`)
- Monitors specific target people/leads by their LinkedIn URLs for:
  1. **Job Changes**: Switching employers or companies.
  2. **Role Title Changes**: Internal promotions or title switches.
  3. **LinkedIn Posts & Activity**: Detects new LinkedIn posts and retrieves the post content using CoreSignal activity objects.
- **Actions**: \`action: 'create' | 'get' | 'update' | 'list' | 'delete'\`.
- **Key Rules & Limits**:
  - **Cadence**: 7 to 30 days (default: 7).
  - **Organization Limit**: Each organization is strictly limited to a total of **150 subscribed leads** across all active subscriptions.
  - **Initial Upload Baseline**: Precept resolves each lead from CoreSignal on upload to save their baseline company and job title, and seed existing activities.
  - **Subsequent Runs**: Checks CoreSignal on schedule or on demand and returns only people who had a change and the exact change they had, as well as new LinkedIn posts.
  - Supports \`runImmediately: true\` (default: true) and optional \`webhookUrl\`.

---

## ⚡ AUTOMATIC CREDIT CAPPING (PRECEPT BEHAVIOR)
- When a user initiates a search or enrichment job with insufficient credits:
  - If available credits > 0: Precept calculates \`finalLimit = floor(availableCredits / costPerUnit)\` and returns HTTP 202, processing only up to \`finalLimit\` items.
  - If available credits <= 0: Precept rejects the request immediately with HTTP 402 ("Not enough credits").

---

## LinkedIn outreach & campaign queue

### Precept Chrome extension
- Campaigns (\`precept_campaign_queue\`, action \`"queue"\`) and direct messages (\`precept_linkedin_messages\`, action \`"send"\`) run through the user's Precept Chrome extension, in the background whenever Chrome is open and signed in to LinkedIn. No Precept or LinkedIn tab needs to stay open.
- \`precept_get_extension_status\` shows whether the extension is installed, active, and which version is running. Checking it before outreach avoids failed sends.
  - Not installed (\`installed === false\`): the extension is free from the [Chrome Web Store](https://chromewebstore.google.com/detail/precept/mlhpcomoechogpgbmjgpfenbmpflcfig).
  - Installed but inactive (\`active === false\`): Chrome needs to be open and signed in to LinkedIn.
  - Direct messaging needs extension v1.1.3 or higher; older versions can be updated or reloaded from \`chrome://extensions\`.

### Acting on the user's behalf
- Outreach sends real messages and invitations from the user's LinkedIn account, so only queue campaigns or send messages the user has asked for, and confirm the recipients and message text with them first.

### Queuing leads from search results
- Leads from \`precept_search_leads\` can be queued directly: pass them in the \`leads\` array as \`[{ name, linkedinUrl, company, title }]\`. A saved list isn't required.
- With \`autoSaveLeadsList: true\` (default), Precept also saves the leads as a list in the user's Precept dashboard.

### Queue behaviour
- One campaign connects at a time to protect the user's LinkedIn account from rate limits. New campaigns join a first-in, first-out queue with a \`queuePosition\` (1 = next in line).
- \`action: "get_queue"\` shows the active campaign's progress (e.g. \`14/50 leads connected\`), any rate-limit cool-off (\`rateLimitPause.remainingMinutes\`), invitations sent and accepted, and upcoming campaigns.
- Controls: \`"pause"\`, \`"resume"\`, \`"archive"\` (or \`"cancel"\`) to move an active or paused campaign to History so the next one can start, and \`"remove"\` to drop an upcoming campaign.

### Direct messages
- \`precept_linkedin_messages\` with \`action: "send"\`, \`recipient: { name, linkedinUrl, company, title }\` and \`message\` returns a \`messageId\`. If the recipient isn't a 1st-degree connection, the message is sent as a connection note, which LinkedIn limits to about 200 characters.
- Delivery is asynchronous. \`action: "get_status"\` with the \`messageId\` returns \`pending\` until it becomes \`sent\` (with whether it went as a DM or a connection note), \`already_pending\` (an invitation was already pending), or \`failed\` (with the reason, e.g. session expired, profile inaccessible or LinkedIn rate limit). Delivery usually completes within about 2 minutes, so checking every ~3 seconds for up to about 40 checks works well. If it's still pending after that, the extension keeps trying in the background and the user can check back later with the messageId.
`;
