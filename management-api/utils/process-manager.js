/**
 * Process Manager for spawning and tracking agentic-flow tasks
 * Implements isolated task execution with dedicated directories
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

class ProcessManager {
  constructor(logger) {
    this.logger = logger;
    this.processes = new Map(); // taskId -> process info
    this.workspaceRoot = process.env.WORKSPACE || path.join(process.env.HOME || '/home/devuser', 'workspace');
    this.logsRoot = path.join(process.env.HOME || '/home/devuser', 'logs', 'tasks');

    // Ensure directories exist
    [this.workspaceRoot, this.logsRoot].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Spawn a new agentic-flow task with isolation
   */
  spawnTask(agent, task, provider = 'gemini') {
    const taskId = uuidv4();
    const taskDir = path.join(this.workspaceRoot, 'tasks', taskId);
    const logFile = path.join(this.logsRoot, `${taskId}.log`);

    // Create isolated task directory
    fs.mkdirSync(taskDir, { recursive: true });

    this.logger.info({ taskId, agent, provider }, 'Spawning new task');

    let command, args, taskEnv;

    // Use Claude CLI directly for claude-flow provider (accesses MCP servers)
    if (provider === 'claude-flow') {
      command = 'claude';
      // Prepend task directory instruction to the prompt
      const enhancedTask = `Working directory: ${taskDir}\n\n${task}\n\nWrite all files to the working directory specified above.`;
      args = [
        '--dangerously-skip-permissions',
        enhancedTask
      ];
      // Pass through all API keys for MCP servers (matching dsp script)
      taskEnv = {
        ...process.env,
        TASK_ID: taskId,
        CONTEXT7_API_KEY: process.env.CONTEXT7_API_KEY || '',
        BRAVE_API_KEY: process.env.BRAVE_API_KEY || '',
        GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
        GOOGLE_GEMINI_API_KEY: process.env.GOOGLE_GEMINI_API_KEY || '',
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
        ZAI_CONTAINER_URL: 'http://claude-zai-service:9600'
      };
      this.logger.info({ taskId, workDir: taskDir }, 'Using Claude CLI with dangerously-skip-permissions for automated task');
    } else {
      // Use agentic-flow for other providers
      command = 'agentic-flow';
      args = [
        '--agent', agent,
        '--task', task,
        '--provider', provider
      ];
      taskEnv = { ...process.env, TASK_ID: taskId };
    }

    // Spawn process in isolated directory
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    const childProcess = spawn(command, args, {
      cwd: taskDir,
      env: taskEnv,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Pipe output to log file
    childProcess.stdout.pipe(logStream);
    childProcess.stderr.pipe(logStream);

    // Store process info
    const processInfo = {
      pid: childProcess.pid,
      taskId,
      agent,
      task,
      provider,
      startTime: Date.now(),
      status: 'running',
      exitCode: null,
      taskDir,
      logFile
    };

    this.processes.set(taskId, processInfo);

    // Handle process exit
    childProcess.on('exit', (code, signal) => {
      this.logger.info({ taskId, code, signal }, 'Task process exited');
      processInfo.status = code === 0 ? 'completed' : 'failed';
      processInfo.exitCode = code;
      processInfo.exitTime = Date.now();
      logStream.end();
    });

    childProcess.on('error', (error) => {
      this.logger.error({ taskId, error: error.message }, 'Task process error');
      processInfo.status = 'failed';
      processInfo.error = error.message;
      logStream.end();
    });

    // Unref to allow parent to exit
    childProcess.unref();

    return processInfo;
  }

  /**
   * Get status of a task
   */
  getTaskStatus(taskId) {
    const processInfo = this.processes.get(taskId);

    if (!processInfo) {
      return null;
    }

    // Read last 50 lines of log
    let logTail = '';
    try {
      const logContent = fs.readFileSync(processInfo.logFile, 'utf-8');
      const lines = logContent.split('\n').filter(l => l.trim());
      logTail = lines.slice(-50).join('\n');
    } catch (error) {
      this.logger.warn({ taskId, error: error.message }, 'Failed to read log file');
    }

    return {
      taskId: processInfo.taskId,
      agent: processInfo.agent,
      task: processInfo.task,
      provider: processInfo.provider,
      status: processInfo.status,
      startTime: processInfo.startTime,
      exitTime: processInfo.exitTime,
      exitCode: processInfo.exitCode,
      duration: processInfo.exitTime ? processInfo.exitTime - processInfo.startTime : Date.now() - processInfo.startTime,
      logTail,
      error: processInfo.error
    };
  }

  /**
   * Get all active tasks
   */
  getActiveTasks() {
    const active = [];
    for (const [taskId, info] of this.processes.entries()) {
      if (info.status === 'running') {
        active.push({
          taskId,
          agent: info.agent,
          startTime: info.startTime,
          duration: Date.now() - info.startTime
        });
      }
    }
    return active;
  }

  /**
   * Stop a running task
   * @param {string} taskId - The UUID of the task to stop
   * @returns {boolean} - True if task was found and stop signal sent, false otherwise
   */
  stopTask(taskId) {
    const processInfo = this.processes.get(taskId);

    if (!processInfo) {
      this.logger.warn({ taskId }, 'Task not found for stopping');
      return false;
    }

    if (processInfo.status !== 'running') {
      this.logger.info({ taskId, status: processInfo.status }, 'Task already stopped');
      return false;
    }

    try {
      // Send SIGTERM to the process
      this.logger.info({ taskId, pid: processInfo.pid }, 'Sending SIGTERM to task process');
      process.kill(processInfo.pid, 'SIGTERM');

      // Update status
      processInfo.status = 'stopped';
      processInfo.exitTime = Date.now();
      processInfo.exitCode = null;

      // Schedule SIGKILL if process doesn't exit within 10 seconds
      setTimeout(() => {
        const info = this.processes.get(taskId);
        if (info && info.status === 'stopped' && info.exitTime === processInfo.exitTime) {
          try {
            this.logger.warn({ taskId, pid: processInfo.pid }, 'Process did not respond to SIGTERM, sending SIGKILL');
            process.kill(processInfo.pid, 'SIGKILL');
          } catch (error) {
            // Process already exited
            this.logger.debug({ taskId, error: error.message }, 'Process already exited');
          }
        }
      }, 10000);

      return true;
    } catch (error) {
      this.logger.error({ taskId, error: error.message }, 'Failed to stop task');

      // Process might already be dead
      if (error.code === 'ESRCH') {
        processInfo.status = 'stopped';
        processInfo.exitTime = Date.now();
        return true;
      }

      return false;
    }
  }

  /**
   * Get log stream for a task (for SSE streaming)
   * @param {string} taskId - The UUID of the task
   * @returns {ReadStream|null} - Read stream for the log file or null if not found
   */
  getLogStream(taskId) {
    const processInfo = this.processes.get(taskId);

    if (!processInfo) {
      return null;
    }

    if (!fs.existsSync(processInfo.logFile)) {
      this.logger.warn({ taskId, logFile: processInfo.logFile }, 'Log file not found');
      return null;
    }

    return fs.createReadStream(processInfo.logFile, { encoding: 'utf-8' });
  }

  /**
   * Watch log file for changes (for real-time streaming)
   * @param {string} taskId - The UUID of the task
   * @param {Function} callback - Called with new log lines
   * @returns {FSWatcher|null} - File watcher or null if not found
   */
  watchLogFile(taskId, callback) {
    const processInfo = this.processes.get(taskId);

    if (!processInfo) {
      return null;
    }

    if (!fs.existsSync(processInfo.logFile)) {
      this.logger.warn({ taskId, logFile: processInfo.logFile }, 'Log file not found for watching');
      return null;
    }

    let fileSize = fs.statSync(processInfo.logFile).size;

    const watcher = fs.watch(processInfo.logFile, (eventType) => {
      if (eventType === 'change') {
        const newSize = fs.statSync(processInfo.logFile).size;

        if (newSize > fileSize) {
          const stream = fs.createReadStream(processInfo.logFile, {
            encoding: 'utf-8',
            start: fileSize,
            end: newSize
          });

          let chunk = '';
          stream.on('data', (data) => {
            chunk += data;
          });

          stream.on('end', () => {
            if (chunk) {
              callback(chunk);
            }
          });

          fileSize = newSize;
        }
      }
    });

    return watcher;
  }

  /**
   * Cleanup old completed/failed tasks from memory
   */
  cleanup(maxAge = 3600000) { // 1 hour default
    const now = Date.now();
    for (const [taskId, info] of this.processes.entries()) {
      if (info.status !== 'running' && info.exitTime && (now - info.exitTime) > maxAge) {
        this.logger.debug({ taskId }, 'Cleaning up old task from memory');
        this.processes.delete(taskId);
      }
    }
  }
}

module.exports = ProcessManager;
