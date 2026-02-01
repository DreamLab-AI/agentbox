/**
 * System monitoring utilities
 * Checks GPU, providers, and system health
 */

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class SystemMonitor {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Check NVIDIA GPU status
   */
  async checkGPU() {
    try {
      const { stdout } = await execAsync('nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits');

      const gpus = stdout.trim().split('\n').map(line => {
        const [index, name, utilization, memUsed, memTotal, temperature] = line.split(',').map(s => s.trim());
        return {
          index: parseInt(index),
          name,
          utilization: parseFloat(utilization),
          memory: {
            used: parseFloat(memUsed),
            total: parseFloat(memTotal),
            percentUsed: (parseFloat(memUsed) / parseFloat(memTotal) * 100).toFixed(2)
          },
          temperature: parseFloat(temperature)
        };
      });

      return {
        available: true,
        gpus
      };
    } catch (error) {
      this.logger.warn({ error: error.message }, 'GPU check failed');
      return {
        available: false,
        error: 'nvidia-smi not available or no GPU detected'
      };
    }
  }

  /**
   * Check provider API connectivity
   */
  async checkProviders() {
    const providers = {
      gemini: process.env.GOOGLE_GEMINI_API_KEY ? 'configured' : 'not_configured',
      openai: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
      claude: process.env.ANTHROPIC_API_KEY ? 'configured' : 'not_configured',
      openrouter: process.env.OPENROUTER_API_KEY ? 'configured' : 'not_configured',
      xinference: process.env.ENABLE_XINFERENCE === 'true' ? 'enabled' : 'disabled'
    };

    return providers;
  }

  /**
   * Check system resources (CPU, Memory)
   */
  async checkSystem() {
    try {
      // CPU load average
      const { stdout: loadAvg } = await execAsync('uptime | awk -F\'load average:\' \'{ print $2 }\'');
      const [load1, load5, load15] = loadAvg.trim().split(',').map(s => parseFloat(s.trim()));

      // Memory usage
      const { stdout: memInfo } = await execAsync('free -m | grep Mem');
      const memParts = memInfo.trim().split(/\s+/);
      const memTotal = parseInt(memParts[1]);
      const memUsed = parseInt(memParts[2]);
      const memFree = parseInt(memParts[3]);

      // Disk usage for workspace
      const workspaceRoot = process.env.WORKSPACE || '/home/devuser/workspace';
      const { stdout: diskInfo } = await execAsync(`df -h ${workspaceRoot} | tail -1`);
      const diskParts = diskInfo.trim().split(/\s+/);

      return {
        cpu: {
          loadAverage: { load1, load5, load15 }
        },
        memory: {
          total: memTotal,
          used: memUsed,
          free: memFree,
          percentUsed: ((memUsed / memTotal) * 100).toFixed(2)
        },
        disk: {
          size: diskParts[1],
          used: diskParts[2],
          available: diskParts[3],
          percentUsed: diskParts[4]
        }
      };
    } catch (error) {
      this.logger.error({ error: error.message }, 'System check failed');
      return {
        error: error.message
      };
    }
  }

  /**
   * Comprehensive health check
   */
  async getStatus() {
    const [gpu, providers, system] = await Promise.all([
      this.checkGPU(),
      this.checkProviders(),
      this.checkSystem()
    ]);

    return {
      timestamp: new Date().toISOString(),
      gpu,
      providers,
      system,
      uptime: process.uptime()
    };
  }
}

module.exports = SystemMonitor;
