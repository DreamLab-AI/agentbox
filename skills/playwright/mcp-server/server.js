#!/usr/bin/env node
/**
 * Playwright MCP Server - Consolidated Implementation
 *
 * Merged from three separate scripts (client, proxy, local) into single
 * @modelcontextprotocol/sdk server with direct browser control on Display :1.
 *
 * Features:
 * - Direct browser launch on VNC display (no TCP proxy needed)
 * - Screenshot capture and visual verification
 * - Page navigation and interaction
 * - Element selection and manipulation
 * - JavaScript evaluation
 * - VisionFlow integration via MCP resources
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

// Configuration from environment
const CONFIG = {
    display: process.env.DISPLAY || ':1',
    chromiumPath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
    screenshotDir: process.env.SCREENSHOT_DIR || '/tmp/playwright-screenshots',
    defaultTimeout: parseInt(process.env.PLAYWRIGHT_TIMEOUT || '30000'),
    defaultViewport: {
        width: parseInt(process.env.VIEWPORT_WIDTH || '1920'),
        height: parseInt(process.env.VIEWPORT_HEIGHT || '1080')
    }
};

// Lazy-load playwright to handle missing dependency gracefully
let playwright = null;
let browser = null;
let context = null;
let page = null;

async function ensurePlaywright() {
    if (!playwright) {
        try {
            playwright = require('playwright');
        } catch (err) {
            throw new Error('Playwright not installed. Run: npm install playwright');
        }
    }
    return playwright;
}

async function ensureBrowser() {
    await ensurePlaywright();

    if (!browser || !browser.isConnected()) {
        console.error(`[playwright-mcp] Launching browser on ${CONFIG.display}`);

        browser = await playwright.chromium.launch({
            executablePath: CONFIG.chromiumPath,
            headless: CONFIG.headless,
            args: [
                `--display=${CONFIG.display}`,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });

        context = await browser.newContext({
            viewport: CONFIG.defaultViewport,
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        page = await context.newPage();
        console.error('[playwright-mcp] Browser ready');
    }

    return { browser, context, page };
}

async function ensurePage() {
    const { page: p } = await ensureBrowser();
    return p;
}

// =============================================================================
// Tool Implementations
// =============================================================================

async function navigate(url, waitUntil = 'domcontentloaded') {
    const p = await ensurePage();
    await p.goto(url, { waitUntil, timeout: CONFIG.defaultTimeout });
    return {
        success: true,
        url: p.url(),
        title: await p.title()
    };
}

async function screenshot(options = {}) {
    const p = await ensurePage();
    const fs = require('fs');
    const path = require('path');

    // Ensure screenshot directory exists
    if (!fs.existsSync(CONFIG.screenshotDir)) {
        fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
    }

    const filename = options.filename || `screenshot-${Date.now()}.png`;
    const filepath = path.join(CONFIG.screenshotDir, filename);

    await p.screenshot({
        path: filepath,
        fullPage: options.fullPage || false,
        type: options.type || 'png'
    });

    // Read file for base64 encoding if requested
    let base64 = null;
    if (options.returnBase64) {
        base64 = fs.readFileSync(filepath).toString('base64');
    }

    return {
        success: true,
        path: filepath,
        filename,
        base64,
        viewport: CONFIG.defaultViewport
    };
}

async function click(selector, options = {}) {
    const p = await ensurePage();
    await p.click(selector, {
        timeout: options.timeout || CONFIG.defaultTimeout,
        button: options.button || 'left',
        clickCount: options.clickCount || 1
    });
    return { success: true, selector };
}

async function type(selector, text, options = {}) {
    const p = await ensurePage();
    await p.fill(selector, text, {
        timeout: options.timeout || CONFIG.defaultTimeout
    });
    return { success: true, selector, textLength: text.length };
}

async function evaluate(script) {
    const p = await ensurePage();
    const result = await p.evaluate(script);
    return { success: true, result };
}

async function waitForSelector(selector, options = {}) {
    const p = await ensurePage();
    await p.waitForSelector(selector, {
        timeout: options.timeout || CONFIG.defaultTimeout,
        state: options.state || 'visible'
    });
    return { success: true, selector };
}

async function getContent() {
    const p = await ensurePage();
    const content = await p.content();
    return { success: true, content, length: content.length };
}

async function getUrl() {
    const p = await ensurePage();
    return {
        success: true,
        url: p.url(),
        title: await p.title()
    };
}

async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
        context = null;
        page = null;
    }
    return { success: true };
}

async function healthCheck() {
    try {
        const { browser: b } = await ensureBrowser();
        return {
            success: true,
            status: 'connected',
            display: CONFIG.display,
            headless: CONFIG.headless,
            browserConnected: b.isConnected()
        };
    } catch (err) {
        return {
            success: false,
            status: 'disconnected',
            error: err.message,
            help: `Ensure Xvfb is running on ${CONFIG.display}. Check: supervisorctl status xvnc`
        };
    }
}

// =============================================================================
// Tool Schemas
// =============================================================================

const TOOL_SCHEMAS = [
    {
        name: 'navigate',
        description: 'Navigate browser to a URL. Use for opening web pages, following links, or loading applications.',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL to navigate to' },
                waitUntil: {
                    type: 'string',
                    enum: ['load', 'domcontentloaded', 'networkidle'],
                    description: 'Wait condition',
                    default: 'domcontentloaded'
                }
            },
            required: ['url']
        }
    },
    {
        name: 'screenshot',
        description: 'Capture screenshot of current page. Use for visual verification, debugging, or capturing state.',
        inputSchema: {
            type: 'object',
            properties: {
                filename: { type: 'string', description: 'Output filename' },
                fullPage: { type: 'boolean', description: 'Capture full page', default: false },
                returnBase64: { type: 'boolean', description: 'Return base64 encoded image', default: false }
            }
        }
    },
    {
        name: 'click',
        description: 'Click an element on the page. Use for button clicks, link navigation, or form interaction.',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS or XPath selector' },
                button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
                clickCount: { type: 'integer', default: 1 }
            },
            required: ['selector']
        }
    },
    {
        name: 'type',
        description: 'Type text into an input field. Use for form filling, search boxes, or text input.',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS or XPath selector for input' },
                text: { type: 'string', description: 'Text to type' }
            },
            required: ['selector', 'text']
        }
    },
    {
        name: 'evaluate',
        description: 'Execute JavaScript in the page context. Use for DOM manipulation, data extraction, or custom interactions.',
        inputSchema: {
            type: 'object',
            properties: {
                script: { type: 'string', description: 'JavaScript code to execute' }
            },
            required: ['script']
        }
    },
    {
        name: 'wait_for_selector',
        description: 'Wait for an element to appear. Use for dynamic content, AJAX responses, or animations.',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS or XPath selector' },
                state: { type: 'string', enum: ['visible', 'hidden', 'attached', 'detached'], default: 'visible' },
                timeout: { type: 'integer', description: 'Timeout in milliseconds' }
            },
            required: ['selector']
        }
    },
    {
        name: 'get_content',
        description: 'Get the full HTML content of the page.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_url',
        description: 'Get the current page URL and title.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'close_browser',
        description: 'Close the browser instance. Use when done with automation session.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'health_check',
        description: 'Check browser and display connection health.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    }
];

// =============================================================================
// MCP Server Setup
// =============================================================================

async function main() {
    const server = new Server(
        {
            name: 'playwright',
            version: '2.0.0'
        },
        {
            capabilities: {
                tools: {},
                resources: {}
            }
        }
    );

    // Handle tool listing
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools: TOOL_SCHEMAS };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        try {
            let result;

            switch (name) {
                case 'navigate':
                    result = await navigate(args.url, args.waitUntil);
                    break;
                case 'screenshot':
                    result = await screenshot(args);
                    break;
                case 'click':
                    result = await click(args.selector, args);
                    break;
                case 'type':
                    result = await type(args.selector, args.text, args);
                    break;
                case 'evaluate':
                    result = await evaluate(args.script);
                    break;
                case 'wait_for_selector':
                    result = await waitForSelector(args.selector, args);
                    break;
                case 'get_content':
                    result = await getContent();
                    break;
                case 'get_url':
                    result = await getUrl();
                    break;
                case 'close_browser':
                    result = await closeBrowser();
                    break;
                case 'health_check':
                    result = await healthCheck();
                    break;
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
            };
        } catch (err) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        error: err.message
                    }, null, 2)
                }],
                isError: true
            };
        }
    });

    // Handle resource listing (for VisionFlow discovery)
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        return {
            resources: [
                {
                    uri: 'playwright://capabilities',
                    name: 'Playwright Capabilities',
                    description: 'Playwright browser automation capabilities for VisionFlow',
                    mimeType: 'application/json'
                },
                {
                    uri: 'playwright://status',
                    name: 'Browser Status',
                    description: 'Current browser connection status',
                    mimeType: 'application/json'
                }
            ]
        };
    });

    // Handle resource reading
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const { uri } = request.params;

        if (uri === 'playwright://capabilities') {
            const capabilities = {
                name: 'playwright',
                version: '2.0.0',
                protocol: 'mcp-sdk',
                display: CONFIG.display,
                tools: TOOL_SCHEMAS.map(t => t.name),
                visionflow_compatible: true
            };
            return {
                contents: [{
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(capabilities, null, 2)
                }]
            };
        }

        if (uri === 'playwright://status') {
            const status = await healthCheck();
            return {
                contents: [{
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(status, null, 2)
                }]
            };
        }

        throw new Error(`Unknown resource: ${uri}`);
    });

    // Start server
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('[playwright-mcp] Server started');
    console.error(`[playwright-mcp] Display: ${CONFIG.display}`);
    console.error('[playwright-mcp] Visual browser access via VNC on port 5901');

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        await closeBrowser();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        await closeBrowser();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error('[playwright-mcp] Fatal error:', err);
    process.exit(1);
});
