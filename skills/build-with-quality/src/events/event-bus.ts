/**
 * Cross-Domain Event Bridge
 * Enables asynchronous communication between Claude Code V3 and Agentic QE domains
 * Supports pattern matching, event correlation, and replay
 */

import type { Event, EventHandler, EventType, AgentId } from '../core/types.js';
import type { IEventBus } from '../core/interfaces.js';

// ============================================================================
// Types
// ============================================================================

interface Subscription {
  id: string;
  pattern: string | EventType;
  handler: EventHandler;
  once: boolean;
}

interface EventRecord {
  event: Event;
  processedBy: string[];
  timestamp: Date;
}

// ============================================================================
// Event Bus Implementation
// ============================================================================

export class EventBus implements IEventBus {
  private readonly subscriptions: Map<string, Subscription[]> = new Map();
  private readonly eventHistory: EventRecord[] = [];
  private readonly maxHistorySize: number;
  private eventCounter = 0;

  constructor(options: { maxHistorySize?: number } = {}) {
    this.maxHistorySize = options.maxHistorySize ?? 1000;
  }

  /**
   * Emit an event to all matching subscribers
   */
  async emit<T>(event: Event<T>): Promise<void> {
    // Record event
    this.recordEvent(event);

    // Find matching subscriptions
    const matchingSubscriptions = this.findMatchingSubscriptions(event.type);

    // Process in parallel
    const promises = matchingSubscriptions.map(async (sub) => {
      try {
        await sub.handler(event);

        // Record that this subscription processed the event
        const record = this.eventHistory.find((r) => r.event.id === event.id);
        if (record) {
          record.processedBy.push(sub.id);
        }

        // Remove if once-only subscription
        if (sub.once) {
          this.removeSubscription(sub.pattern, sub.id);
        }
      } catch (error) {
        console.error(`Event handler error for ${event.type}:`, error);
      }
    });

    await Promise.all(promises);
  }

  /**
   * Subscribe to events matching a type or pattern
   */
  on<T>(type: EventType | string, handler: EventHandler<T>): () => void {
    const subscription = this.addSubscription(type, handler as EventHandler, false);
    return () => this.removeSubscription(type, subscription.id);
  }

  /**
   * Subscribe to a single event occurrence
   */
  once<T>(type: EventType | string, handler: EventHandler<T>): () => void {
    const subscription = this.addSubscription(type, handler as EventHandler, true);
    return () => this.removeSubscription(type, subscription.id);
  }

  /**
   * Unsubscribe a handler
   */
  off(type: EventType | string, handler: EventHandler): void {
    const subs = this.subscriptions.get(type);
    if (!subs) return;

    const filtered = subs.filter((sub) => sub.handler !== handler);
    if (filtered.length > 0) {
      this.subscriptions.set(type, filtered);
    } else {
      this.subscriptions.delete(type);
    }
  }

  /**
   * Wait for a specific event type with timeout
   */
  waitFor<T>(type: EventType | string, timeout = 30000): Promise<Event<T>> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout waiting for event: ${type}`));
      }, timeout);

      const unsubscribe = this.once<T>(type, async (event) => {
        clearTimeout(timeoutId);
        resolve(event);
      });
    });
  }

  // ============================================================================
  // Cross-Domain Bridge
  // ============================================================================

  /**
   * Create a bridge subscription that forwards events between domains
   */
  bridge(
    sourcePattern: string,
    targetType: EventType,
    transform?: (event: Event) => Event
  ): () => void {
    return this.on(sourcePattern, async (event) => {
      const transformed = transform ? transform(event) : event;
      const bridgedEvent: Event = {
        ...transformed,
        id: `bridged_${event.id}`,
        type: targetType,
        correlationId: event.id,
      };
      await this.emit(bridgedEvent);
    });
  }

  /**
   * Create correlation-based event chains
   */
  correlate(
    events: EventType[],
    handler: (events: Event[]) => Promise<void>,
    timeout = 60000
  ): () => void {
    const correlationMap = new Map<string, { events: Event[]; timeout: ReturnType<typeof setTimeout> }>();

    const unsubscribes = events.map((eventType) =>
      this.on(eventType, async (event) => {
        const correlationId = event.correlationId ?? event.id;

        let correlation = correlationMap.get(correlationId);
        if (!correlation) {
          correlation = {
            events: [],
            timeout: setTimeout(() => {
              correlationMap.delete(correlationId);
            }, timeout),
          };
          correlationMap.set(correlationId, correlation);
        }

        correlation.events.push(event);

        // Check if all events received
        const receivedTypes = new Set(correlation.events.map((e) => e.type));
        const allReceived = events.every((type) => receivedTypes.has(type));

        if (allReceived) {
          clearTimeout(correlation.timeout);
          correlationMap.delete(correlationId);
          await handler(correlation.events);
        }
      })
    );

    return () => {
      unsubscribes.forEach((unsub) => unsub());
      for (const [, correlation] of correlationMap) {
        clearTimeout(correlation.timeout);
      }
      correlationMap.clear();
    };
  }

  // ============================================================================
  // Event History & Replay
  // ============================================================================

  /**
   * Get recent events matching a pattern
   */
  getHistory(
    filter?: { type?: EventType | string; source?: AgentId; limit?: number }
  ): Event[] {
    let events = this.eventHistory.map((r) => r.event);

    if (filter?.type) {
      events = events.filter((e) => this.matchPattern(e.type, filter.type!));
    }

    if (filter?.source) {
      events = events.filter((e) => e.source === filter.source);
    }

    const limit = filter?.limit ?? 100;
    return events.slice(-limit);
  }

  /**
   * Replay events from history
   */
  async replay(
    filter?: { type?: EventType | string; source?: AgentId; limit?: number }
  ): Promise<number> {
    const events = this.getHistory(filter);

    for (const event of events) {
      await this.emit(event);
    }

    return events.length;
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory.length = 0;
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  getStats(): {
    subscriptionCount: number;
    historySize: number;
    eventsByType: Record<string, number>;
  } {
    const eventsByType: Record<string, number> = {};
    for (const record of this.eventHistory) {
      const type = record.event.type;
      eventsByType[type] = (eventsByType[type] ?? 0) + 1;
    }

    let subscriptionCount = 0;
    for (const subs of this.subscriptions.values()) {
      subscriptionCount += subs.length;
    }

    return {
      subscriptionCount,
      historySize: this.eventHistory.length,
      eventsByType,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private addSubscription(
    pattern: string | EventType,
    handler: EventHandler,
    once: boolean
  ): Subscription {
    const subscription: Subscription = {
      id: `sub_${++this.eventCounter}`,
      pattern,
      handler,
      once,
    };

    const subs = this.subscriptions.get(pattern) ?? [];
    subs.push(subscription);
    this.subscriptions.set(pattern, subs);

    return subscription;
  }

  private removeSubscription(pattern: string | EventType, subscriptionId: string): void {
    const subs = this.subscriptions.get(pattern);
    if (!subs) return;

    const filtered = subs.filter((sub) => sub.id !== subscriptionId);
    if (filtered.length > 0) {
      this.subscriptions.set(pattern, filtered);
    } else {
      this.subscriptions.delete(pattern);
    }
  }

  private findMatchingSubscriptions(eventType: EventType | string): Subscription[] {
    const matching: Subscription[] = [];

    for (const [pattern, subs] of this.subscriptions) {
      if (this.matchPattern(eventType, pattern)) {
        matching.push(...subs);
      }
    }

    return matching;
  }

  private matchPattern(eventType: string, pattern: string): boolean {
    // Exact match
    if (eventType === pattern) return true;

    // Wildcard pattern matching (e.g., "task:*" matches "task:created")
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(eventType);
    }

    return false;
  }

  private recordEvent(event: Event): void {
    const record: EventRecord = {
      event,
      processedBy: [],
      timestamp: new Date(),
    };

    this.eventHistory.push(record);

    // Trim history if needed
    while (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }
}

// ============================================================================
// Helper: Create typed events
// ============================================================================

export function createEvent<T>(
  type: EventType,
  payload: T,
  source: AgentId | 'system',
  correlationId?: string
): Event<T> {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type,
    payload,
    source,
    timestamp: new Date(),
    correlationId,
  };
}
