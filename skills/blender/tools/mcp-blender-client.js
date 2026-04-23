#!/usr/bin/env node
/**
 * MCP stdio Bridge for Blender
 * Reads JSON requests from stdin, sends them to Blender via TCP, and prints JSON responses to stdout.
 */
const net = require('net');

const BLENDER_HOST = process.env.BLENDER_HOST || 'localhost';
const BLENDER_PORT = parseInt(process.env.BLENDER_PORT || 9876);
const CONNECTION_TIMEOUT = 10000; // 10 seconds
const RESPONSE_TIMEOUT = 60000; // 60 seconds

async function sendToBlender(command) {
    return new Promise((resolve, reject) => {
        const client = new net.Socket();
        let responseData = '';
        let connectionTimeout, responseTimeout;

        const cleanup = () => {
            clearTimeout(connectionTimeout);
            clearTimeout(responseTimeout);
            client.destroy();
        };

        connectionTimeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Connection timeout to Blender at ${BLENDER_HOST}:${BLENDER_PORT}`));
        }, CONNECTION_TIMEOUT);

        client.connect(BLENDER_PORT, BLENDER_HOST, () => {
            clearTimeout(connectionTimeout); // Connected successfully
            // The Blender plugin expects a raw JSON object, no newline
            client.write(JSON.stringify(command));

            responseTimeout = setTimeout(() => {
                cleanup();
                reject(new Error('Response timeout from Blender'));
            }, RESPONSE_TIMEOUT);
        });

        client.on('data', (data) => {
            responseData += data.toString();
            // The Blender plugin sends a single JSON response. Try to parse it.
            try {
                const response = JSON.parse(responseData);
                cleanup();
                resolve(response);
            } catch (e) {
                // Incomplete data, wait for more.
            }
        });

        client.on('error', (err) => {
            cleanup();
            reject(new Error(`TCP connection error: ${err.message}`));
        });

        client.on('close', () => {
            cleanup();
            // If we have partial data, try to parse it, otherwise reject.
            if (responseData) {
                try {
                    resolve(JSON.parse(responseData));
                } catch (e) {
                    reject(new Error(`Connection closed with incomplete JSON response: ${responseData}`));
                }
            } else {
                // This case is handled by timeouts or error events, but as a fallback.
                reject(new Error('Connection closed without a response.'));
            }
        });
    });
}

async function main() {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    for await (const line of rl) {
        let response;
        try {
            const request = JSON.parse(line);
            // The Blender plugin expects a 'type' and 'params' structure.
            // The MCP request has 'tool' and 'params'. We map them.
            const blenderCommand = {
                type: request.tool,
                params: request.params || {}
            };
            const result = await sendToBlender(blenderCommand);
            response = { result };
        } catch (e) {
            response = { error: `Blender tool bridge failed: ${e.message}` };
        }
        // Write the response back to stdout for claude-flow
        process.stdout.write(JSON.stringify(response) + '\n');
    }
}

main().catch(err => {
    process.stderr.write(`Unhandled error in Blender bridge: ${err.message}\n`);
    process.exit(1);
});