/**
 * Tests for Prometheus metrics instrumentation
 */

const { wrapDispatch, adapterDispatchTotal, adapterDurationSeconds, register } = require('../../management-api/observability/metrics');

describe('Observability Metrics', () => {
  describe('Registry', () => {
    it('should have registered Prometheus instruments', () => {
      const metrics = register.metrics();
      expect(metrics).toContain('agentbox_adapter_dispatch_total');
      expect(metrics).toContain('agentbox_adapter_duration_seconds');
      expect(metrics).toContain('agentbox_adapter_health');
      expect(metrics).toContain('agentbox_build_info');
    });

    it('should collect default Node metrics', () => {
      const metrics = register.metrics();
      expect(metrics).toContain('nodejs_');
    });
  });

  describe('wrapDispatch', () => {
    beforeEach(() => {
      // Reset counters before each test
      register.resetMetrics();
    });

    it('should increment counter on success', async () => {
      const mockFn = jest.fn().mockResolvedValue({ data: 'test' });
      const wrapped = wrapDispatch('beads', 'local-sqlite', 'createEpic', mockFn);

      const result = await wrapped({ title: 'Test' });

      expect(result).toEqual({ data: 'test' });
      expect(mockFn).toHaveBeenCalledWith({ title: 'Test' });

      // Verify counter was incremented
      const metrics = register.metrics();
      expect(metrics).toContain('agentbox_adapter_dispatch_total{slot="beads",method="createEpic",impl="local-sqlite",outcome="success"} 1');
    });

    it('should record histogram on success', async () => {
      const mockFn = jest.fn().mockResolvedValue({ id: 'epic-123' });
      const wrapped = wrapDispatch('beads', 'local-sqlite', 'createEpic', mockFn);

      await wrapped({ title: 'Test' });

      const metrics = register.metrics();
      expect(metrics).toContain('agentbox_adapter_duration_seconds_bucket{slot="beads",method="createEpic",impl="local-sqlite"');
    });

    it('should increment error counter on failure', async () => {
      const error = new Error('Connection failed');
      const mockFn = jest.fn().mockRejectedValue(error);
      const wrapped = wrapDispatch('memory', 'external-pg', 'store', mockFn);

      await expect(wrapped({ key: 'test', value: 'data' })).rejects.toThrow('Connection failed');

      const metrics = register.metrics();
      expect(metrics).toContain('agentbox_adapter_dispatch_total{slot="memory",method="store",impl="external-pg",outcome="error"} 1');
    });

    it('should record latency histogram even on error', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('Failed'));
      const wrapped = wrapDispatch('pods', 'external', 'write', mockFn);

      await expect(wrapped({})).rejects.toThrow();

      const metrics = register.metrics();
      expect(metrics).toContain('agentbox_adapter_duration_seconds_bucket{slot="pods",method="write",impl="external"');
    });

    it('should pass through function arguments correctly', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      const wrapped = wrapDispatch('events', 'local-jsonl', 'emit', mockFn);

      const arg1 = { type: 'agent:start' };
      const arg2 = { timestamp: 123 };

      await wrapped(arg1, arg2);

      expect(mockFn).toHaveBeenCalledWith(arg1, arg2);
    });

    it('should work with multiple concurrent calls', async () => {
      const mockFn = jest.fn().mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({}), 10))
      );
      const wrapped = wrapDispatch('orchestrator', 'local-process-manager', 'spawn', mockFn);

      const promises = [
        wrapped({ id: '1' }),
        wrapped({ id: '2' }),
        wrapped({ id: '3' })
      ];

      await Promise.all(promises);

      expect(mockFn).toHaveBeenCalledTimes(3);

      const metrics = register.metrics();
      expect(metrics).toContain('agentbox_adapter_dispatch_total{slot="orchestrator",method="spawn",impl="local-process-manager",outcome="success"} 3');
    });
  });

  describe('Console logging', () => {
    let consoleLogSpy;
    let consoleErrorSpy;

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should log success as JSON', async () => {
      const mockFn = jest.fn().mockResolvedValue({});
      const wrapped = wrapDispatch('beads', 'local-sqlite', 'createEpic', mockFn);

      await wrapped();

      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = consoleLogSpy.mock.calls[0][0];
      const logJson = JSON.parse(logCall);

      expect(logJson).toHaveProperty('ts');
      expect(logJson.level).toBe('info');
      expect(logJson.msg).toBe('adapter_dispatch');
      expect(logJson.slot).toBe('beads');
      expect(logJson.method).toBe('createEpic');
      expect(logJson.impl).toBe('local-sqlite');
      expect(logJson.outcome).toBe('success');
      expect(logJson).toHaveProperty('duration_ms');
      expect(logJson).toHaveProperty('execution_id');
    });

    it('should log error as JSON with error message', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('Test error'));
      const wrapped = wrapDispatch('memory', 'external-pg', 'search', mockFn);

      await expect(wrapped()).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalled();
      const logCall = consoleErrorSpy.mock.calls[0][0];
      const logJson = JSON.parse(logCall);

      expect(logJson.level).toBe('error');
      expect(logJson.msg).toBe('adapter_dispatch_error');
      expect(logJson.outcome).toBe('error');
      expect(logJson.error).toBe('Test error');
      expect(logJson).toHaveProperty('stack');
    });
  });
});
