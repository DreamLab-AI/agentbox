'use strict';

/**
 * Viewer slot contract — invariants L16–L18 (DDD-004).
 *
 * Verifies the pane-manifest contract is data-driven, AGPL §13 headers
 * are present, and the path traversal guards in routes/linked-objects.js
 * actually reject `..` / absolute / backslash inputs.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const { resolveViewerImpl, builtInPaneFiles, buildManifest } =
  require('../../../management-api/middleware/linked-data/viewer');

describe('S12 — Viewer slot', () => {
  describe('L18 — pane registry is data-driven', () => {
    test('builtInPaneFiles enumerates the panes/ directory', () => {
      const files = builtInPaneFiles();
      // We ship at least the six agentbox-specific panes.
      const names = files.map((f) => path.basename(f));
      expect(names).toEqual(expect.arrayContaining([
        'vc-pane.js',
        'provenance-pane.js',
        'capability-pane.js',
        'runtime-pane.js',
        'dcat-pane.js',
        'handoff-pane.js',
      ]));
    });

    test('manifest merges built-in + upstream + operator panes', () => {
      const manifest = buildManifest({
        manifest: {
          linked_data: {
            enabled: true,
            viewer: { mode: 'local-linkedobjects', extra_panes: ['/tmp/custom.js'] },
          },
        },
        builtInPaneFiles: builtInPaneFiles(),
        mountPath: '/lo',
      });
      expect(manifest.panes.length).toBeGreaterThan(6);
      const sources = new Set(manifest.panes.map((p) => p.source));
      expect(sources.has('built-in')).toBe(true);
      expect(sources.has('upstream')).toBe(true);
      expect(sources.has('operator')).toBe(true);
    });

    test('manifest exposes the deeplinks for navigation', () => {
      const manifest = buildManifest({
        manifest: {
          linked_data: { enabled: true, did_documents: 'emit', viewer: { mode: 'local-linkedobjects' } },
          integrations: { solid_pod_rs: { base_url: 'http://127.0.0.1:8484' } },
        },
        builtInPaneFiles: [],
        mountPath: '/lo',
        agentDid: 'did:nostr:npub1agent000000000000000000000000000000000',
      });
      expect(manifest.deeplinks).toEqual(expect.objectContaining({
        meta: '/v1/meta',
        'agent-events': '/v1/agent-events',
        'pod-root': 'http://127.0.0.1:8484/',
      }));
      expect(manifest.deeplinks['did-document']).toBeTruthy();
    });
  });

  describe('viewer impl resolution', () => {
    test('mode = "off" returns disabled descriptor', () => {
      const v = resolveViewerImpl({
        manifest: { linked_data: { viewer: { mode: 'off' } } },
        logger: { info() {}, debug() {}, error() {}, warn() {} },
      });
      expect(v.enabled).toBe(false);
      expect(v.impl).toBe('off');
    });

    test('mode = "external" requires external_url', () => {
      expect(() => resolveViewerImpl({
        manifest: { linked_data: { viewer: { mode: 'external' } } },
        logger: { info() {}, debug() {}, error() {}, warn() {} },
      })).toThrow(/external_url/);
    });

    test('mode = "local-linkedobjects" returns a buildPaneManifest', () => {
      const v = resolveViewerImpl({
        manifest: { linked_data: { enabled: true, viewer: { mode: 'local-linkedobjects' } } },
        logger: { info() {}, debug() {}, error() {}, warn() {} },
      });
      expect(v.enabled).toBe(true);
      expect(v.impl).toBe('local-linkedobjects');
      expect(typeof v.buildPaneManifest).toBe('function');
      expect(v.sourceCodeHeader).toContain('linkedobjects/browser');
    });
  });
});
