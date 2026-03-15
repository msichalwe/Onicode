/**
 * MCP Server Catalog — Browsable directory of 55+ MCP servers
 *
 * Provides:
 *   - Categorized server definitions with install commands
 *   - TF-IDF search so the AI can find relevant servers by context
 *   - One-click install definitions (command, args, env hints)
 *   - `mcp_search` AI tool: context-driven server discovery
 */

const { logger } = require('./logger');

// ══════════════════════════════════════════
//  Server Catalog (55 servers, 12 categories)
// ══════════════════════════════════════════

const MCP_CATALOG = [
    // ── Databases ──
    { id: 'postgres', name: 'PostgreSQL', category: 'Databases', description: 'PostgreSQL database operations — queries, schema inspection, migrations', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'], env: { DATABASE_URL: 'postgresql://user:pass@localhost:5432/mydb' }, tags: ['sql', 'postgres', 'database', 'query', 'migration', 'schema', 'relational'] },
    { id: 'mysql', name: 'MySQL', category: 'Databases', description: 'MySQL database access — queries, tables, schema management', command: 'npx', args: ['-y', 'mcp-server-mysql'], env: { MYSQL_HOST: 'localhost', MYSQL_USER: 'root', MYSQL_PASSWORD: '', MYSQL_DATABASE: 'mydb' }, tags: ['sql', 'mysql', 'database', 'query', 'relational'] },
    { id: 'sqlite', name: 'SQLite', category: 'Databases', description: 'SQLite operations — query, create, modify local database files', command: 'npx', args: ['-y', 'mcp-sqlite', '--db', './data.db'], tags: ['sql', 'sqlite', 'database', 'local', 'file', 'lightweight'] },
    { id: 'mongodb', name: 'MongoDB', category: 'Databases', description: 'MongoDB operations — collections, documents, aggregation pipelines', command: 'npx', args: ['-y', 'mcp-mongo-server'], env: { MONGODB_URI: 'mongodb://localhost:27017/mydb' }, tags: ['nosql', 'mongodb', 'document', 'database', 'aggregation'] },
    { id: 'redis', name: 'Redis', category: 'Databases', description: 'Redis key-value store — get, set, lists, hashes, pub/sub', command: 'npx', args: ['-y', '@modelcontextprotocol/server-redis', 'redis://localhost:6379'], tags: ['redis', 'cache', 'key-value', 'pub-sub', 'session'] },
    { id: 'supabase', name: 'Supabase', category: 'Databases', description: 'Supabase PostgreSQL — tables, RLS policies, storage, auth', command: 'npx', args: ['-y', 'supabase-mcp-server'], env: { SUPABASE_URL: '', SUPABASE_KEY: '' }, tags: ['supabase', 'postgres', 'auth', 'storage', 'realtime', 'baas'] },
    { id: 'neo4j', name: 'Neo4j', category: 'Databases', description: 'Neo4j graph database — Cypher queries, nodes, relationships', command: 'uvx', args: ['mcp-neo4j'], env: { NEO4J_URI: 'bolt://localhost:7687', NEO4J_USER: 'neo4j', NEO4J_PASSWORD: '' }, tags: ['graph', 'neo4j', 'cypher', 'knowledge-graph', 'relationships'] },
    { id: 'elasticsearch', name: 'Elasticsearch', category: 'Databases', description: 'Elasticsearch — full-text search, aggregations, index management', command: 'uvx', args: ['elasticsearch-mcp-server'], env: { ES_URL: 'http://localhost:9200' }, tags: ['search', 'elasticsearch', 'full-text', 'analytics', 'logging'] },
    { id: 'duckdb', name: 'DuckDB', category: 'Databases', description: 'DuckDB analytics — fast SQL analytics on CSV, Parquet, JSON files', command: 'uvx', args: ['mcp-server-duckdb', '--db', './analytics.duckdb'], tags: ['analytics', 'sql', 'parquet', 'csv', 'olap', 'data-science'] },
    { id: 'bigquery', name: 'BigQuery', category: 'Databases', description: 'Google BigQuery — query massive datasets, manage tables', command: 'uvx', args: ['mcp-server-bigquery'], env: { GOOGLE_PROJECT_ID: '' }, tags: ['bigquery', 'google', 'analytics', 'data-warehouse', 'sql'] },
    { id: 'snowflake', name: 'Snowflake', category: 'Databases', description: 'Snowflake data warehouse — queries, warehouses, stages', command: 'uvx', args: ['snowflake-mcp-server'], env: { SNOWFLAKE_ACCOUNT: '', SNOWFLAKE_USER: '', SNOWFLAKE_PASSWORD: '' }, tags: ['snowflake', 'data-warehouse', 'sql', 'analytics', 'cloud'] },
    { id: 'clickhouse', name: 'ClickHouse', category: 'Databases', description: 'ClickHouse OLAP — fast analytics queries on columnar data', command: 'uvx', args: ['mcp-clickhouse'], env: { CLICKHOUSE_URL: 'http://localhost:8123' }, tags: ['clickhouse', 'analytics', 'olap', 'columnar', 'time-series'] },
    { id: 'chroma', name: 'Chroma', category: 'Databases', description: 'Chroma vector database — embeddings, similarity search, RAG', command: 'uvx', args: ['chroma-mcp'], tags: ['vector', 'embeddings', 'rag', 'similarity', 'ai', 'semantic-search'] },
    { id: 'influxdb', name: 'InfluxDB', category: 'Databases', description: 'InfluxDB time-series — metrics, IoT data, Flux queries', command: 'npx', args: ['-y', 'influxdb3-mcp-server'], env: { INFLUX_URL: 'http://localhost:8086', INFLUX_TOKEN: '' }, tags: ['time-series', 'metrics', 'iot', 'monitoring', 'influxdb'] },

    // ── Browser & Web Automation ──
    { id: 'playwright', name: 'Playwright (Microsoft)', category: 'Browser & Web', description: 'Official Microsoft Playwright — browser automation, testing, scraping', command: 'npx', args: ['-y', '@playwright/mcp@latest'], tags: ['browser', 'automation', 'testing', 'scraping', 'playwright', 'headless'] },
    { id: 'puppeteer', name: 'Puppeteer', category: 'Browser & Web', description: 'Puppeteer browser automation — navigate, screenshot, interact with pages', command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'], tags: ['browser', 'puppeteer', 'screenshot', 'scraping', 'automation'] },
    { id: 'browserbase', name: 'Browserbase', category: 'Browser & Web', description: 'Cloud browser automation — scalable headless browsers in the cloud', command: 'npx', args: ['-y', '@browserbasehq/mcp-server-browserbase'], env: { BROWSERBASE_API_KEY: '' }, tags: ['browser', 'cloud', 'headless', 'automation', 'scale'] },
    { id: 'web-search', name: 'Web Search', category: 'Browser & Web', description: 'DuckDuckGo/Brave web search — find information, research topics', command: 'npx', args: ['-y', '@nicepkg/mcp-server-duckduckgo'], tags: ['search', 'web', 'duckduckgo', 'research', 'information'] },

    // ── Communication ──
    { id: 'slack', name: 'Slack', category: 'Communication', description: 'Slack workspace — send messages, read channels, manage threads', command: 'npx', args: ['-y', '@anthropics/mcp-server-slack'], env: { SLACK_BOT_TOKEN: '' }, tags: ['slack', 'messaging', 'channels', 'team', 'chat', 'notifications'] },
    { id: 'discord', name: 'Discord', category: 'Communication', description: 'Discord bot — send messages, manage channels, read history', command: 'npx', args: ['-y', 'discord-mcp'], env: { DISCORD_TOKEN: '' }, tags: ['discord', 'bot', 'messaging', 'community', 'chat'] },
    { id: 'email', name: 'Email (Multi-provider)', category: 'Communication', description: 'Email operations — send, read, search across Gmail, Outlook, IMAP', command: 'npx', args: ['-y', '@codefuturist/email-mcp'], tags: ['email', 'gmail', 'outlook', 'imap', 'send', 'inbox'] },
    { id: 'telegram', name: 'Telegram Bot', category: 'Communication', description: 'Telegram Bot API — 174 tools, send/receive messages, media, groups', command: 'npx', args: ['-y', 'telegram-bot-mcp'], env: { TELEGRAM_BOT_TOKEN: '' }, tags: ['telegram', 'bot', 'messaging', 'chat', 'media'] },
    { id: 'whatsapp', name: 'WhatsApp', category: 'Communication', description: 'WhatsApp messaging — send, receive, media sharing', command: 'uvx', args: ['whatsapp-mcp'], tags: ['whatsapp', 'messaging', 'chat', 'media'] },
    { id: 'ntfy', name: 'Ntfy Notifications', category: 'Communication', description: 'Self-hosted push notifications — send alerts to phone/desktop', command: 'npx', args: ['-y', 'ntfy-mcp'], env: { NTFY_URL: 'https://ntfy.sh' }, tags: ['notifications', 'push', 'alerts', 'mobile', 'self-hosted'] },

    // ── DevOps & Cloud ──
    { id: 'docker', name: 'Docker', category: 'DevOps & Cloud', description: 'Docker container management — images, containers, compose, logs', command: 'npx', args: ['-y', 'mcp-server-docker'], tags: ['docker', 'containers', 'images', 'compose', 'devops'] },
    { id: 'kubernetes', name: 'Kubernetes', category: 'DevOps & Cloud', description: 'Kubernetes operations — pods, services, deployments, logs, scaling', command: 'uvx', args: ['k8s-mcp-server'], tags: ['kubernetes', 'k8s', 'pods', 'deployment', 'orchestration', 'devops'] },
    { id: 'aws', name: 'AWS', category: 'DevOps & Cloud', description: 'AWS CLI wrapper — S3, EC2, Lambda, CloudFormation, IAM', command: 'uvx', args: ['aws-mcp-server'], env: { AWS_PROFILE: 'default' }, tags: ['aws', 'cloud', 's3', 'ec2', 'lambda', 'infrastructure'] },
    { id: 'vercel', name: 'Vercel', category: 'DevOps & Cloud', description: 'Vercel deployments — deploy, manage projects, environment variables', command: 'npx', args: ['-y', '@vercel/mcp'], env: { VERCEL_TOKEN: '' }, tags: ['vercel', 'deploy', 'hosting', 'serverless', 'nextjs'] },
    { id: 'cloudflare', name: 'Cloudflare', category: 'DevOps & Cloud', description: 'Cloudflare Workers, Pages, DNS, R2 storage management', command: 'npx', args: ['-y', '@cloudflare/mcp-server-cloudflare'], env: { CLOUDFLARE_API_TOKEN: '' }, tags: ['cloudflare', 'workers', 'dns', 'cdn', 'edge', 'r2'] },
    { id: 'prometheus', name: 'Prometheus', category: 'DevOps & Cloud', description: 'Prometheus metrics — query, alerts, dashboards, monitoring', command: 'uvx', args: ['prometheus-mcp-server'], env: { PROMETHEUS_URL: 'http://localhost:9090' }, tags: ['prometheus', 'monitoring', 'metrics', 'alerts', 'grafana'] },
    { id: 'sentry', name: 'Sentry', category: 'DevOps & Cloud', description: 'Sentry error tracking — issues, events, releases, performance', command: 'npx', args: ['-y', '@sentry/mcp-server-sentry'], env: { SENTRY_TOKEN: '' }, tags: ['sentry', 'errors', 'monitoring', 'performance', 'debugging'] },

    // ── File Systems & Storage ──
    { id: 'filesystem', name: 'Filesystem', category: 'File Systems', description: 'Safe file operations — read, write, search, move with path restrictions', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/dir'], tags: ['files', 'filesystem', 'read', 'write', 'directory', 'local'] },
    { id: 's3', name: 'AWS S3', category: 'File Systems', description: 'AWS S3 file operations — upload, download, list buckets and objects', command: 'npx', args: ['-y', '@modelcontextprotocol/server-s3'], env: { AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', AWS_REGION: 'us-east-1' }, tags: ['s3', 'aws', 'storage', 'upload', 'download', 'cloud'] },
    { id: 'google-drive', name: 'Google Drive', category: 'File Systems', description: 'Google Drive — read, search, list, create files and folders', command: 'npx', args: ['-y', '@anthropics/mcp-server-google-drive'], env: { GOOGLE_CREDENTIALS: '' }, tags: ['google', 'drive', 'cloud-storage', 'documents', 'sharing'] },

    // ── Version Control ──
    { id: 'github', name: 'GitHub', category: 'Version Control', description: 'GitHub API — repos, issues, PRs, actions, code search, reviews', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: '' }, tags: ['github', 'git', 'issues', 'pull-requests', 'actions', 'code-review'] },
    { id: 'gitlab', name: 'GitLab', category: 'Version Control', description: 'GitLab API — repos, merge requests, CI/CD pipelines, issues', command: 'npx', args: ['-y', '@modelcontextprotocol/server-gitlab'], env: { GITLAB_TOKEN: '', GITLAB_URL: 'https://gitlab.com' }, tags: ['gitlab', 'git', 'merge-requests', 'ci-cd', 'pipelines'] },
    { id: 'linear', name: 'Linear', category: 'Version Control', description: 'Linear project management — issues, projects, cycles, teams', command: 'npx', args: ['-y', 'mcp-linear'], env: { LINEAR_API_KEY: '' }, tags: ['linear', 'issues', 'project-management', 'agile', 'tracking'] },
    { id: 'jira', name: 'Jira', category: 'Version Control', description: 'Jira — issues, sprints, boards, projects, transitions', command: 'npx', args: ['-y', 'mcp-jira'], env: { JIRA_URL: '', JIRA_EMAIL: '', JIRA_API_TOKEN: '' }, tags: ['jira', 'issues', 'agile', 'sprints', 'project-management'] },

    // ── AI & LLM ──
    { id: 'openai', name: 'OpenAI', category: 'AI & LLM', description: 'OpenAI API — GPT completions, embeddings, DALL-E, Whisper', command: 'npx', args: ['-y', 'mcp-openai'], env: { OPENAI_API_KEY: '' }, tags: ['openai', 'gpt', 'embeddings', 'dall-e', 'whisper', 'ai'] },
    { id: 'huggingface', name: 'Hugging Face', category: 'AI & LLM', description: 'Hugging Face Hub — models, datasets, spaces, inference API', command: 'uvx', args: ['mcp-huggingface'], env: { HF_TOKEN: '' }, tags: ['huggingface', 'models', 'datasets', 'inference', 'ml'] },
    { id: 'ollama', name: 'Ollama', category: 'AI & LLM', description: 'Ollama local models — run LLMs locally, manage models, generate', command: 'npx', args: ['-y', 'mcp-ollama'], tags: ['ollama', 'local', 'llm', 'models', 'inference', 'private'] },

    // ── Data & Analytics ──
    { id: 'google-sheets', name: 'Google Sheets', category: 'Data & Analytics', description: 'Google Sheets — 25 tools for reading, writing, formatting spreadsheets', command: 'uvx', args: ['google-sheets-mcp'], env: { GOOGLE_CREDENTIALS: '' }, tags: ['google', 'sheets', 'spreadsheet', 'data', 'csv', 'reporting'] },
    { id: 'notion', name: 'Notion', category: 'Data & Analytics', description: 'Notion API — pages, databases, blocks, search, comments', command: 'npx', args: ['-y', '@anthropics/mcp-server-notion'], env: { NOTION_API_KEY: '' }, tags: ['notion', 'notes', 'database', 'wiki', 'documentation', 'project'] },
    { id: 'airtable', name: 'Airtable', category: 'Data & Analytics', description: 'Airtable — records, tables, views, formulas, automations', command: 'npx', args: ['-y', 'mcp-airtable'], env: { AIRTABLE_API_KEY: '' }, tags: ['airtable', 'spreadsheet', 'database', 'records', 'crm'] },

    // ── Design & Media ──
    { id: 'figma', name: 'Figma', category: 'Design & Media', description: 'Figma — read designs, extract components, inspect layouts and styles', command: 'npx', args: ['-y', '@anthropics/mcp-server-figma'], env: { FIGMA_ACCESS_TOKEN: '' }, tags: ['figma', 'design', 'ui', 'components', 'styles', 'layout'] },
    { id: 'image-gen', name: 'Image Generation', category: 'Design & Media', description: 'Google Imagen 3.0 — generate, edit, and transform images with AI', command: 'npx', args: ['-y', 'imagen3-mcp'], env: { GOOGLE_API_KEY: '' }, tags: ['image', 'generation', 'ai', 'dalle', 'creative', 'design'] },

    // ── Security ──
    { id: 'vault', name: 'HashiCorp Vault', category: 'Security', description: 'HashiCorp Vault — secrets management, encryption, access control', command: 'npx', args: ['-y', 'mcp-vault'], env: { VAULT_ADDR: 'http://localhost:8200', VAULT_TOKEN: '' }, tags: ['vault', 'secrets', 'encryption', 'security', 'credentials'] },

    // ── Finance ──
    { id: 'stripe', name: 'Stripe', category: 'Finance', description: 'Stripe payments — customers, charges, subscriptions, invoices', command: 'npx', args: ['-y', '@stripe/mcp'], env: { STRIPE_SECRET_KEY: '' }, tags: ['stripe', 'payments', 'billing', 'subscriptions', 'invoices', 'finance'] },
    { id: 'plaid', name: 'Plaid', category: 'Finance', description: 'Plaid banking — accounts, transactions, balances, identity', command: 'npx', args: ['-y', 'mcp-plaid'], env: { PLAID_CLIENT_ID: '', PLAID_SECRET: '' }, tags: ['plaid', 'banking', 'transactions', 'accounts', 'finance'] },

    // ── Productivity ──
    { id: 'google-calendar', name: 'Google Calendar', category: 'Productivity', description: 'Google Calendar — events, scheduling, reminders, availability', command: 'npx', args: ['-y', '@anthropics/mcp-server-google-calendar'], env: { GOOGLE_CREDENTIALS: '' }, tags: ['calendar', 'google', 'scheduling', 'events', 'reminders'] },
    { id: 'todoist', name: 'Todoist', category: 'Productivity', description: 'Todoist — tasks, projects, labels, filters, completions', command: 'npx', args: ['-y', 'mcp-todoist'], env: { TODOIST_API_TOKEN: '' }, tags: ['todoist', 'tasks', 'todo', 'productivity', 'project-management'] },
    { id: 'apple-reminders', name: 'Apple Reminders', category: 'Productivity', description: 'macOS Reminders — create, list, complete, manage reminder lists', command: 'npx', args: ['-y', 'mcp-server-apple-reminders'], tags: ['apple', 'reminders', 'macos', 'tasks', 'todo'] },
    { id: 'google-tasks', name: 'Google Tasks', category: 'Productivity', description: 'Google Tasks — task lists, create, update, complete tasks', command: 'npx', args: ['-y', 'mcp-googletasks'], env: { GOOGLE_CREDENTIALS: '' }, tags: ['google', 'tasks', 'todo', 'productivity'] },

    // ── Code Execution ──
    { id: 'code-sandbox', name: 'Code Sandbox', category: 'Code Execution', description: 'Docker-sandboxed JavaScript execution — safe code running', command: 'npx', args: ['-y', 'node-code-sandbox-mcp'], tags: ['sandbox', 'javascript', 'docker', 'execution', 'safe', 'isolated'] },
    { id: 'e2b', name: 'E2B Sandbox', category: 'Code Execution', description: 'Cloud sandboxed code execution — Python, JS, any language', command: 'npx', args: ['-y', '@e2b/mcp-server'], env: { E2B_API_KEY: '' }, tags: ['sandbox', 'cloud', 'execution', 'python', 'javascript', 'safe'] },
];

// ══════════════════════════════════════════
//  Categories (derived from catalog)
// ══════════════════════════════════════════

function getCategories() {
    const cats = new Map();
    for (const s of MCP_CATALOG) {
        if (!cats.has(s.category)) cats.set(s.category, 0);
        cats.set(s.category, cats.get(s.category) + 1);
    }
    return Array.from(cats.entries()).map(([name, count]) => ({ name, count }));
}

// ══════════════════════════════════════════
//  Search Index (TF-IDF-lite)
// ══════════════════════════════════════════

const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'and', 'or', 'for', 'to', 'in', 'of', 'on', 'with', 'by', 'from', 'at', 'as', 'it', 'be', 'this', 'that']);

function tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9\-]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

// Pre-computed token sets per server
const _searchIndex = MCP_CATALOG.map(s => {
    const textBlob = `${s.name} ${s.category} ${s.description} ${s.tags.join(' ')}`;
    const tokens = tokenize(textBlob);
    const tokenSet = new Set(tokens);
    return { id: s.id, tokens, tokenSet };
});

// IDF across the catalog
const _docCount = MCP_CATALOG.length;
const _df = {};
for (const entry of _searchIndex) {
    for (const t of entry.tokenSet) {
        _df[t] = (_df[t] || 0) + 1;
    }
}

/**
 * Search the catalog by query. Returns ranked results.
 * Used by the mcp_search AI tool and the UI search bar.
 */
function searchCatalog(query, maxResults = 10) {
    if (!query || !query.trim()) return MCP_CATALOG.slice(0, maxResults);

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return MCP_CATALOG.slice(0, maxResults);

    const scored = [];

    for (let i = 0; i < _searchIndex.length; i++) {
        const entry = _searchIndex[i];
        let score = 0;

        for (const qt of queryTokens) {
            // Exact match
            if (entry.tokenSet.has(qt)) {
                const tf = entry.tokens.filter(t => t === qt).length / entry.tokens.length;
                const idf = Math.log(_docCount / (_df[qt] || 1));
                score += tf * idf * 10;
            }
            // Prefix match
            for (const t of entry.tokenSet) {
                if (t.startsWith(qt) || qt.startsWith(t)) {
                    score += 2;
                }
            }
            // Tag exact match bonus
            const server = MCP_CATALOG[i];
            if (server.tags.includes(qt)) {
                score += 5;
            }
            // Category match bonus
            if (server.category.toLowerCase().includes(qt)) {
                score += 3;
            }
        }

        if (score > 0) {
            scored.push({ server: MCP_CATALOG[i], score });
        }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map(s => s.server);
}

/**
 * Get full catalog, optionally filtered by category.
 */
function getCatalog(category) {
    if (category) {
        return MCP_CATALOG.filter(s => s.category.toLowerCase() === category.toLowerCase());
    }
    return MCP_CATALOG;
}

/**
 * Get a single server definition by ID.
 */
function getCatalogEntry(id) {
    return MCP_CATALOG.find(s => s.id === id) || null;
}

// ══════════════════════════════════════════
//  AI Tool Definition
// ══════════════════════════════════════════

const MCP_SEARCH_TOOL = {
    type: 'function',
    function: {
        name: 'mcp_search',
        description: 'Search the MCP server catalog to find external tools/integrations that match what you need. Use this BEFORE telling the user "I cannot do X" — there may be an MCP server for it. Returns server names, descriptions, install commands, and required env vars. The user can then install the server from Settings > MCP.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Natural language search query describing what capability you need. Examples: "database postgres", "send slack messages", "deploy to vercel", "kubernetes pods", "payment processing"',
                },
                category: {
                    type: 'string',
                    description: 'Optional category filter. One of: Databases, Browser & Web, Communication, DevOps & Cloud, File Systems, Version Control, AI & LLM, Data & Analytics, Design & Media, Security, Finance, Productivity, Code Execution',
                },
                max_results: {
                    type: 'number',
                    description: 'Max results to return (default 5)',
                },
            },
            required: ['query'],
        },
    },
};

/**
 * Execute the mcp_search tool — called by the AI.
 */
function executeMcpSearch(args) {
    const { query, category, max_results } = args;
    let results = searchCatalog(query, max_results || 5);

    if (category) {
        results = results.filter(s => s.category.toLowerCase().includes(category.toLowerCase()));
    }

    if (results.length === 0) {
        return {
            found: 0,
            message: `No MCP servers found for "${query}". The user can browse the full catalog in Settings > MCP, or add a custom server manually.`,
        };
    }

    return {
        found: results.length,
        servers: results.map(s => ({
            id: s.id,
            name: s.name,
            category: s.category,
            description: s.description,
            install: { command: s.command, args: s.args },
            env_required: s.env ? Object.keys(s.env) : [],
            tags: s.tags,
        })),
        hint: 'Tell the user they can install any of these from Settings > MCP tab, or ask them to configure it. Do NOT attempt to install servers yourself.',
    };
}

// ══════════════════════════════════════════
//  IPC Registration
// ══════════════════════════════════════════

function registerCatalogIPC(ipcMain) {
    ipcMain.handle('mcp-catalog-list', async (_event, category) => {
        return { servers: getCatalog(category), categories: getCategories() };
    });

    ipcMain.handle('mcp-catalog-search', async (_event, query, maxResults) => {
        return { servers: searchCatalog(query, maxResults || 20) };
    });

    ipcMain.handle('mcp-catalog-entry', async (_event, id) => {
        return { server: getCatalogEntry(id) };
    });
}

module.exports = {
    registerCatalogIPC,
    MCP_SEARCH_TOOL,
    executeMcpSearch,
    searchCatalog,
    getCatalog,
    getCatalogEntry,
    getCategories,
    MCP_CATALOG,
};
