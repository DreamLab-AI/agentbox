#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile, readdir, unlink } from "fs/promises";
import { join, resolve } from "path";
import { spawn } from "child_process";

const server = new Server(
  {
    name: "jupyter-notebooks",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Default notebook directory
const NOTEBOOK_DIR = process.env.JUPYTER_NOTEBOOK_DIR || process.cwd();

// Helper: Execute Python code
async function executePython(code) {
  return new Promise((resolve, reject) => {
    const python = spawn("/opt/venv/bin/python", ["-c", code]);
    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (data) => (stdout += data));
    python.stderr.on("data", (data) => (stderr += data));

    python.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || "Python execution failed"));
      } else {
        resolve(stdout);
      }
    });
  });
}

// Tool implementations
const tools = {
  create_notebook: async ({ path, cells = [] }) => {
    const notebook = {
      cells: cells.map((cell) => ({
        cell_type: cell.cell_type || "code",
        metadata: {},
        source: Array.isArray(cell.source) ? cell.source : [cell.source],
        ...(cell.cell_type === "code"
          ? { outputs: [], execution_count: null }
          : {}),
      })),
      metadata: {
        kernelspec: {
          display_name: "Python 3",
          language: "python",
          name: "python3",
        },
        language_info: {
          name: "python",
          version: "3.11.0",
        },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };

    const fullPath = resolve(NOTEBOOK_DIR, path);
    await writeFile(fullPath, JSON.stringify(notebook, null, 2));
    return { success: true, path: fullPath };
  },

  list_notebooks: async ({ directory = NOTEBOOK_DIR }) => {
    const files = await readdir(directory);
    const notebooks = files.filter((f) => f.endsWith(".ipynb"));
    return { notebooks, count: notebooks.length };
  },

  get_notebook: async ({ path }) => {
    const fullPath = resolve(NOTEBOOK_DIR, path);
    const content = await readFile(fullPath, "utf-8");
    const notebook = JSON.parse(content);
    return {
      cellCount: notebook.cells.length,
      cells: notebook.cells.map((cell, idx) => ({
        index: idx,
        type: cell.cell_type,
        source: cell.source.join(""),
        outputs: cell.outputs || [],
      })),
    };
  },

  add_cell: async ({ path, cellType = "code", source, index }) => {
    const fullPath = resolve(NOTEBOOK_DIR, path);
    const content = await readFile(fullPath, "utf-8");
    const notebook = JSON.parse(content);

    const newCell = {
      cell_type: cellType,
      metadata: {},
      source: Array.isArray(source) ? source : [source],
      ...(cellType === "code" ? { outputs: [], execution_count: null } : {}),
    };

    if (index !== undefined) {
      notebook.cells.splice(index, 0, newCell);
    } else {
      notebook.cells.push(newCell);
    }

    await writeFile(fullPath, JSON.stringify(notebook, null, 2));
    return { success: true, cellCount: notebook.cells.length };
  },

  execute_cell: async ({ path, index }) => {
    const fullPath = resolve(NOTEBOOK_DIR, path);
    const content = await readFile(fullPath, "utf-8");
    const notebook = JSON.parse(content);

    if (index >= notebook.cells.length) {
      throw new Error(`Cell index ${index} out of range`);
    }

    const cell = notebook.cells[index];
    if (cell.cell_type !== "code") {
      return { success: false, error: "Cell is not a code cell" };
    }

    const code = cell.source.join("");
    try {
      const output = await executePython(code);
      cell.outputs = [
        {
          output_type: "execute_result",
          data: { "text/plain": output.trim() },
          execution_count: 1,
        },
      ];
      cell.execution_count = 1;

      await writeFile(fullPath, JSON.stringify(notebook, null, 2));
      return { success: true, output: output.trim() };
    } catch (error) {
      cell.outputs = [
        {
          output_type: "error",
          ename: "ExecutionError",
          evalue: error.message,
          traceback: [error.message],
        },
      ];

      await writeFile(fullPath, JSON.stringify(notebook, null, 2));
      return { success: false, error: error.message };
    }
  },

  delete_cell: async ({ path, index }) => {
    const fullPath = resolve(NOTEBOOK_DIR, path);
    const content = await readFile(fullPath, "utf-8");
    const notebook = JSON.parse(content);

    if (index >= notebook.cells.length) {
      throw new Error(`Cell index ${index} out of range`);
    }

    notebook.cells.splice(index, 1);
    await writeFile(fullPath, JSON.stringify(notebook, null, 2));
    return { success: true, cellCount: notebook.cells.length };
  },

  clear_outputs: async ({ path }) => {
    const fullPath = resolve(NOTEBOOK_DIR, path);
    const content = await readFile(fullPath, "utf-8");
    const notebook = JSON.parse(content);

    notebook.cells.forEach((cell) => {
      if (cell.cell_type === "code") {
        cell.outputs = [];
        cell.execution_count = null;
      }
    });

    await writeFile(fullPath, JSON.stringify(notebook, null, 2));
    return { success: true };
  },

  delete_notebook: async ({ path }) => {
    const fullPath = resolve(NOTEBOOK_DIR, path);
    await unlink(fullPath);
    return { success: true, deleted: fullPath };
  },
};

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_notebook",
      description: "Create a new Jupyter notebook",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Notebook file path" },
          cells: {
            type: "array",
            description: "Initial cells",
            items: {
              type: "object",
              properties: {
                cell_type: { type: "string", enum: ["code", "markdown"] },
                source: { type: "string", description: "Cell content" },
              },
            },
          },
        },
        required: ["path"],
      },
    },
    {
      name: "list_notebooks",
      description: "List all notebooks in directory",
      inputSchema: {
        type: "object",
        properties: {
          directory: { type: "string", description: "Directory path" },
        },
      },
    },
    {
      name: "get_notebook",
      description: "Read notebook contents",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Notebook file path" },
        },
        required: ["path"],
      },
    },
    {
      name: "add_cell",
      description: "Add cell to notebook",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          cellType: { type: "string", enum: ["code", "markdown"] },
          source: { type: "string", description: "Cell content" },
          index: { type: "number", description: "Insert position" },
        },
        required: ["path", "source"],
      },
    },
    {
      name: "execute_cell",
      description: "Execute a code cell",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          index: { type: "number", description: "Cell index" },
        },
        required: ["path", "index"],
      },
    },
    {
      name: "delete_cell",
      description: "Remove cell from notebook",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          index: { type: "number" },
        },
        required: ["path", "index"],
      },
    },
    {
      name: "clear_outputs",
      description: "Clear all cell outputs",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
    {
      name: "delete_notebook",
      description: "Delete notebook file",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!tools[name]) {
    throw new Error(`Unknown tool: ${name}`);
  }

  try {
    const result = await tools[name](args || {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: error.message }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Jupyter Notebooks MCP server running on stdio");
