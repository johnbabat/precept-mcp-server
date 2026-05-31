#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import dotenv from "dotenv";
import crypto from "crypto";
import axios from "axios";
import { registerAllTools } from "./tools.js";
import { apiKeyStorage } from "./context.js";
import {
  MemoryTokenStore,
  RedisTokenStore,
  verifyJwt,
  signJwt,
  encrypt,
  decrypt,
  generateCodeChallenge,
  escapeHtml,
  generateCsrfToken,
  verifyCsrfToken,
} from "./auth.js";

dotenv.config();

const server = new McpServer({
  name: "precept-mcp-server",
  version: "1.0.0",
});

// Register all Precept tools
registerAllTools(server);

const transportType = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();

// ──────────────────────────────────────────
// Helper: resolve base URL from request
// ──────────────────────────────────────────
function getBaseUrl(req: express.Request): string {
  const host = req.headers.host || "localhost";
  const protocol =
    req.secure || req.headers["x-forwarded-proto"] === "https"
      ? "https"
      : "http";
  return `${protocol}://${host}`;
}

// ──────────────────────────────────────────
// Redirect URI Validation (prevents open redirect)
// ──────────────────────────────────────────
function isRedirectUriAllowed(redirectUri: string): boolean {
  // Parse allowed patterns from env (comma-separated domain prefixes)
  // Defaults to known MCP client callback domains + localhost for dev
  const allowedPatternsRaw =
    process.env.ALLOWED_REDIRECT_DOMAINS ||
    "claude.ai,chatgpt.com,localhost,127.0.0.1";
  const allowedDomains = allowedPatternsRaw.split(",").map((d) => d.trim().toLowerCase());

  try {
    const parsed = new URL(redirectUri);
    const hostname = parsed.hostname.toLowerCase();

    // Enforce HTTPS in production (allow HTTP only for localhost/127.0.0.1)
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
    if (!isLocal && parsed.protocol !== "https:") {
      return false;
    }

    // Check if the hostname matches any allowed domain (exact or subdomain)
    return allowedDomains.some((domain) => {
      return hostname === domain || hostname.endsWith(`.${domain}`);
    });
  } catch {
    return false;
  }
}

// Premium HTML Consent / Authorization Template
const AUTHORIZE_HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Precept to Claude / ChatGPT</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-color: #080710;
      --card-bg: rgba(15, 10, 32, 0.65);
      --card-border: rgba(255, 255, 255, 0.08);
      --primary-glow: rgba(99, 102, 241, 0.15);
      --secondary-glow: rgba(168, 85, 247, 0.15);
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --accent: #a855f7;
      --input-bg: rgba(255, 255, 255, 0.03);
      --input-border: rgba(255, 255, 255, 0.1);
      --error-color: #f87171;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      background-color: var(--bg-color);
      color: var(--text-main);
      font-family: 'Outfit', sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow-x: hidden;
      position: relative;
    }
    
    /* Radial Glow Effects */
    body::before {
      content: '';
      position: absolute;
      width: 400px;
      height: 400px;
      border-radius: 50%;
      background: radial-gradient(circle, var(--primary-glow) 0%, transparent 70%);
      top: -100px;
      right: -100px;
      z-index: 0;
    }
    
    body::after {
      content: '';
      position: absolute;
      width: 500px;
      height: 500px;
      border-radius: 50%;
      background: radial-gradient(circle, var(--secondary-glow) 0%, transparent 70%);
      bottom: -150px;
      left: -150px;
      z-index: 0;
    }
    
    .container {
      width: 100%;
      max-width: 480px;
      padding: 24px;
      z-index: 10;
    }
    
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid var(--card-border);
      border-radius: 28px;
      padding: 40px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      animation: fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    
    .logo-container {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }
    
    .logo-badge {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      display: flex;
      justify-content: center;
      align-items: center;
      font-weight: 800;
      font-size: 22px;
      box-shadow: 0 8px 20px rgba(168, 85, 247, 0.3);
    }
    
    .logo-connection {
      color: var(--text-muted);
      font-size: 20px;
      animation: pulse 2s infinite ease-in-out;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
    
    .logo-claude {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      justify-content: center;
      align-items: center;
    }
    
    .logo-claude svg {
      width: 28px;
      height: 28px;
    }
    
    h1 {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 8px;
      letter-spacing: -0.5px;
    }
    
    .subtitle {
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.5;
    }
    
    .permissions {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 16px;
      padding: 16px 20px;
      margin-bottom: 28px;
    }
    
    .permissions-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--text-muted);
      margin-bottom: 12px;
    }
    
    .permission-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      font-size: 13px;
      line-height: 1.5;
      margin-bottom: 8px;
      color: #d1d5db;
    }
    
    .permission-item:last-child {
      margin-bottom: 0;
    }
    
    .permission-icon {
      color: #34d399;
      margin-top: 2px;
      flex-shrink: 0;
    }
    
    .form-group {
      margin-bottom: 24px;
      position: relative;
    }
    
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #d1d5db;
      margin-bottom: 8px;
    }
    
    input[type="password"] {
      width: 100%;
      padding: 14px 16px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 12px;
      color: var(--text-main);
      font-family: monospace;
      font-size: 14px;
      transition: all 0.2s ease;
      outline: none;
    }
    
    input[type="password"]:focus {
      border-color: #a855f7;
      box-shadow: 0 0 0 4px rgba(168, 85, 247, 0.15);
      background: rgba(255, 255, 255, 0.05);
    }
    
    .error-msg {
      color: var(--error-color);
      font-size: 13px;
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .btn-submit {
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 14px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      color: white;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.25s ease;
      box-shadow: 0 8px 24px rgba(168, 85, 247, 0.25);
    }
    
    .btn-submit:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 30px rgba(168, 85, 247, 0.4);
      filter: brightness(1.05);
    }
    
    .btn-submit:active {
      transform: translateY(0);
    }
    
    .footer-text {
      text-align: center;
      font-size: 11px;
      color: #6b7280;
      margin-top: 24px;
      line-height: 1.5;
    }
    
    .footer-text a {
      color: var(--text-muted);
      text-decoration: none;
      transition: color 0.2s;
    }
    
    .footer-text a:hover {
      color: var(--text-main);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <div class="logo-container">
          <div class="logo-badge">P</div>
          <div class="logo-connection">⚡</div>
          <div class="logo-claude">
            <svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
              <path d="M22 12H2"/>
            </svg>
          </div>
        </div>
        <h1>Connect Precept AI</h1>
        <p class="subtitle">Grant your AI assistant permissions to query Precept B2B intelligence tools.</p>
      </div>
      
      <div class="permissions">
        <div class="permissions-title">Requested Access</div>
        <div class="permission-item">
          <span class="permission-icon">✓</span>
          <span>Search and discover leads/contacts</span>
        </div>
        <div class="permission-item">
          <span class="permission-icon">✓</span>
          <span>Retrieve verified emails and phone numbers</span>
        </div>
        <div class="permission-item">
          <span class="permission-icon">✓</span>
          <span>Analyze company technology stacks, funding, and revenue</span>
        </div>
      </div>
      
      <form method="POST" action="/authorize">
        <input type="hidden" name="client_id" value="{{client_id}}">
        <input type="hidden" name="redirect_uri" value="{{redirect_uri}}">
        <input type="hidden" name="state" value="{{state}}">
        <input type="hidden" name="code_challenge" value="{{code_challenge}}">
        <input type="hidden" name="code_challenge_method" value="{{code_challenge_method}}">
        <input type="hidden" name="_csrf" value="{{csrf_token}}">
        
        <div class="form-group">
          <label for="apiKey">PRECEPT API KEY</label>
          <input type="password" id="apiKey" name="apiKey" required placeholder="pt_..." value="{{apiKey}}">
          {{error}}
        </div>
        
        <button type="submit" class="btn-submit">Authorize Connector</button>
      </form>
      
      <div class="footer-text">
        Find your API key on the <a href="https://app.preceptai.co.uk/developer" target="_blank" rel="noopener noreferrer">Precept Developer Dashboard</a>.<br>
        Your credentials are encrypted in-transit and stored securely.
      </div>
    </div>
  </div>
</body>
</html>
`;

function renderAuthorizeHtml(params: {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  csrf_token: string;
  apiKey?: string;
  error?: string;
}) {
  let errorHtml = "";
  if (params.error) {
    errorHtml = `
      <div class="error-msg">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        ${escapeHtml(params.error)}
      </div>
    `;
  }

  // All user-controlled values are HTML-escaped to prevent XSS
  return AUTHORIZE_HTML_TEMPLATE
    .replace("{{client_id}}", escapeHtml(params.client_id || ""))
    .replace("{{redirect_uri}}", escapeHtml(params.redirect_uri || ""))
    .replace("{{state}}", escapeHtml(params.state || ""))
    .replace("{{code_challenge}}", escapeHtml(params.code_challenge || ""))
    .replace("{{code_challenge_method}}", escapeHtml(params.code_challenge_method || ""))
    .replace("{{csrf_token}}", escapeHtml(params.csrf_token || ""))
    .replace("{{apiKey}}", escapeHtml(params.apiKey || ""))
    .replace("{{error}}", errorHtml);
}

// Validate API Key using Precept API endpoint
async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const preceptApiUrl = process.env.PRECEPT_API_URL || "https://api.preceptai.co.uk";
    await axios.get(`${preceptApiUrl}/v1/jobs`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      params: { limit: 1 },
    });
    return true;
  } catch (error: any) {
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      return false;
    }
    // For other connection issues, allow proceeding so that temporary downtime doesn't brick setup
    return true;
  }
}

async function main() {
  if (transportType === "http") {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const allowedHostsRaw = process.env.ALLOWED_HOSTS || "localhost,127.0.0.1";
    const allowedHosts = allowedHostsRaw.split(",").map((h) => h.trim());

    // JWT key setup
    const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
    if (!process.env.JWT_SECRET) {
      console.warn(
        "WARNING: JWT_SECRET environment variable is not set. A random secret has been generated, but active tokens will be invalidated upon server restart."
      );
    }

    // NO_SECURITY guard — refuse to start in production mode
    const noSecurity = process.env.NO_SECURITY === "true";
    if (noSecurity) {
      if (process.env.NODE_ENV === "production") {
        console.error(
          "FATAL: NO_SECURITY=true is not allowed in production. Refusing to start."
        );
        process.exit(1);
      }
      console.warn(
        "⚠️  WARNING: NO_SECURITY=true — OAuth is DISABLED. " +
        "All /mcp requests will use the server-level PRECEPT_API_KEY. " +
        "This should ONLY be used for local development."
      );
    }

    // Provision stateful/stateless code store
    const tokenStore = process.env.REDIS_URL
      ? new RedisTokenStore(process.env.REDIS_URL)
      : new MemoryTokenStore();

    // Token lifetimes
    const ACCESS_TOKEN_TTL = 60 * 60;           // 1 hour
    const REFRESH_TOKEN_TTL = 90 * 24 * 60 * 60; // 90 days

    // ──────────────────────────────────────────
    // OAuth Metadata Discovery Endpoints
    // ──────────────────────────────────────────
    app.get("/.well-known/oauth-protected-resource", (req, res) => {
      const baseUrl = getBaseUrl(req);
      res.json({
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
        scopes_supported: ["precept"],
        bearer_methods_supported: ["header"],
        resource_name: "Precept MCP Server",
      });
    });

    app.get(["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"], (req, res) => {
      const baseUrl = getBaseUrl(req);
      res.json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      });
    });

    // ──────────────────────────────────────────
    // GET /authorize (Render UI)
    // ──────────────────────────────────────────
    app.get("/authorize", (req, res) => {
      const {
        client_id,
        redirect_uri,
        response_type,
        state,
        code_challenge,
        code_challenge_method,
      } = req.query;

      if (!client_id || !redirect_uri || !state || !code_challenge) {
        res.status(400).send("Bad Request: Missing OAuth parameters client_id, redirect_uri, state, or code_challenge");
        return;
      }

      if (response_type !== "code") {
        res.status(400).send("Bad Request: Only response_type='code' is supported");
        return;
      }

      if (code_challenge_method && code_challenge_method !== "S256") {
        res.status(400).send("Bad Request: Only S256 code challenge method is supported");
        return;
      }

      // Validate redirect_uri against allowlist
      const redirectUriStr = String(redirect_uri);
      if (!isRedirectUriAllowed(redirectUriStr)) {
        res.status(400).send("Bad Request: redirect_uri is not allowed. Check ALLOWED_REDIRECT_DOMAINS configuration.");
        return;
      }

      // Generate a CSRF token for the form submission
      const csrfToken = generateCsrfToken(jwtSecret);

      res.send(
        renderAuthorizeHtml({
          client_id: String(client_id),
          redirect_uri: redirectUriStr,
          state: String(state),
          code_challenge: String(code_challenge),
          code_challenge_method: String(code_challenge_method || "S256"),
          csrf_token: csrfToken,
        })
      );
    });

    // ──────────────────────────────────────────
    // POST /authorize (Submit API Key)
    // ──────────────────────────────────────────
    app.post("/authorize", async (req, res) => {
      const {
        client_id,
        redirect_uri,
        state,
        code_challenge,
        code_challenge_method,
        apiKey,
        _csrf,
      } = req.body;

      if (!client_id || !redirect_uri || !state || !code_challenge || !apiKey) {
        res.status(400).send("Bad Request: Missing required form parameters");
        return;
      }

      // Verify CSRF token
      if (!_csrf || !verifyCsrfToken(_csrf, jwtSecret)) {
        res.status(403).send("Forbidden: Invalid or expired CSRF token. Please reload the page and try again.");
        return;
      }

      // Re-validate redirect_uri on the POST side too
      if (!isRedirectUriAllowed(redirect_uri)) {
        res.status(400).send("Bad Request: redirect_uri is not allowed.");
        return;
      }

      const isValid = await validateApiKey(apiKey);
      if (!isValid) {
        // Re-generate CSRF token for the retry form
        const csrfToken = generateCsrfToken(jwtSecret);
        res.send(
          renderAuthorizeHtml({
            client_id,
            redirect_uri,
            state,
            code_challenge,
            code_challenge_method,
            csrf_token: csrfToken,
            apiKey,
            error: "Invalid Precept API Key. Please double check and try again.",
          })
        );
        return;
      }

      // Generate a temporary auth code (short-lived)
      const authCode = crypto.randomBytes(24).toString("hex");

      // Encrypt the API key before storing (so it's never plaintext in Redis/memory)
      const encryptedApiKey = encrypt(apiKey, jwtSecret);

      // Save credentials state in Redis or Memory
      await tokenStore.setAuthCode(
        authCode,
        {
          encryptedApiKey,
          codeChallenge: code_challenge,
          clientId: client_id,
          redirectUri: redirect_uri,
        },
        300 // 5 minutes TTL
      );

      // Redirect the user back to the client callback URL
      // Note: redirect_uri has already been validated against the allowlist above
      const safeRedirectUri = new URL(redirect_uri);
      safeRedirectUri.searchParams.set("code", authCode);
      safeRedirectUri.searchParams.set("state", state);
      res.redirect(safeRedirectUri.toString());
    });

    // ──────────────────────────────────────────
    // POST /token (Token Exchange)
    // ──────────────────────────────────────────
    app.post("/token", async (req, res) => {
      const grantType = req.body.grant_type || req.query.grant_type;

      if (grantType === "authorization_code") {
        const { client_id, redirect_uri, code, code_verifier } = req.body;

        if (!code || !code_verifier) {
          res.status(400).json({ error: "invalid_request", error_description: "Missing code or code_verifier" });
          return;
        }

        const data = await tokenStore.getAndRemoveAuthCode(code);
        if (!data) {
          res.status(400).json({ error: "invalid_grant", error_description: "Invalid or expired authorization code" });
          return;
        }

        // client_id and redirect_uri are MANDATORY checks (OAuth 2.1 spec)
        if (!client_id || data.clientId !== client_id) {
          res.status(400).json({ error: "invalid_grant", error_description: "Missing or mismatched client_id" });
          return;
        }

        if (!redirect_uri || data.redirectUri !== redirect_uri) {
          res.status(400).json({ error: "invalid_grant", error_description: "Missing or mismatched redirect_uri" });
          return;
        }

        // Verify PKCE
        const calculatedChallenge = generateCodeChallenge(code_verifier);
        if (calculatedChallenge !== data.codeChallenge) {
          res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
          return;
        }

        // The API key is already encrypted in the token store — carry it forward into the JWT
        const accessToken = signJwt(
          {
            sub: data.clientId,
            apiKey: data.encryptedApiKey,
            client_id: data.clientId,
            exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL,
          },
          jwtSecret
        );

        const refreshToken = signJwt(
          {
            sub: data.clientId,
            apiKey: data.encryptedApiKey,
            client_id: data.clientId,
            exp: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_TTL,
          },
          jwtSecret
        );

        res.json({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL,
          refresh_token: refreshToken,
        });
      } else if (grantType === "refresh_token") {
        const { refresh_token } = req.body;

        if (!refresh_token) {
          res.status(400).json({ error: "invalid_request", error_description: "Missing refresh_token" });
          return;
        }

        const payload = verifyJwt(refresh_token, jwtSecret);
        if (!payload || !payload.apiKey) {
          res.status(400).json({ error: "invalid_grant", error_description: "Invalid or expired refresh token" });
          return;
        }

        // Issue new tokens (carry forward the encrypted API key)
        const newAccessToken = signJwt(
          {
            sub: payload.client_id,
            apiKey: payload.apiKey,
            client_id: payload.client_id,
            exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL,
          },
          jwtSecret
        );

        const newRefreshToken = signJwt(
          {
            sub: payload.client_id,
            apiKey: payload.apiKey,
            client_id: payload.client_id,
            exp: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_TTL,
          },
          jwtSecret
        );

        res.json({
          access_token: newAccessToken,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL,
          refresh_token: newRefreshToken,
        });
      } else {
        res.status(400).json({ error: "unsupported_grant_type", error_description: "Only authorization_code and refresh_token are supported" });
      }
    });

    // Initialize streamable HTTP transport
    // NOTE: Using a single stateless transport (sessionIdGenerator = undefined).
    // API key isolation is handled by AsyncLocalStorage at the request level.
    // If stateful MCP features (sampling, notifications) are needed in the future,
    // a per-session transport architecture should be adopted instead.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless server
    });

    // Connect server to transport
    await server.connect(transport);

    // Expose MCP endpoint (protected by Bearer OAuth checks)
    app.post("/mcp", async (req, res) => {
      // DNS Rebinding / Host validation
      const hostHeader = req.headers.host;
      if (hostHeader) {
        const host = hostHeader.split(":")[0];
        if (!allowedHosts.includes(host) && !allowedHosts.includes("*")) {
          res.status(403).send("Forbidden: Invalid host header");
          return;
        }
      }

      let apiKey: string | undefined;

      if (!noSecurity) {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          const baseUrl = getBaseUrl(req);
          res.setHeader("WWW-Authenticate", `Bearer error="invalid_token", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`);
          res.status(401).json({ error: "invalid_token", error_description: "Missing or invalid authorization token" });
          return;
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
          res.status(401).json({ error: "invalid_token", error_description: "Malformed Bearer token" });
          return;
        }

        const payload = verifyJwt(token, jwtSecret);
        if (!payload || !payload.apiKey) {
          const baseUrl = getBaseUrl(req);
          res.setHeader("WWW-Authenticate", `Bearer error="invalid_token", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`);
          res.status(401).json({ error: "invalid_token", error_description: "Invalid or expired authorization token" });
          return;
        }

        try {
          apiKey = decrypt(payload.apiKey, jwtSecret);
        } catch (err) {
          res.status(401).json({ error: "invalid_token", error_description: "Failed to decrypt API Key" });
          return;
        }
      }

      // Ensure the Accept header includes text/event-stream to prevent 406 Not Acceptable
      // errors from strict validation in StreamableHTTPServerTransport
      const acceptHeader = req.headers.accept || "";
      if (!acceptHeader.includes("text/event-stream")) {
        req.headers.accept = acceptHeader
          ? `${acceptHeader}, text/event-stream`
          : "application/json, text/event-stream";
      }

      try {
        // Wrap request in AsyncLocalStorage context so tools can access user's individual API key
        await apiKeyStorage.run(apiKey, async () => {
          await transport.handleRequest(req, res, req.body);
        });
      } catch (error) {
        console.error("Error handling MCP request:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    const port = parseInt(process.env.PORT || "3000", 10);
    app.listen(port, () => {
      console.error(`Precept MCP Server listening over HTTP on port ${port}`);
      console.error(`Endpoint: http://localhost:${port}/mcp`);
    });
  } else {
    // Stdio Server Transport (default)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Precept MCP Server running over stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
