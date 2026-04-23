'use strict';

/**
 * Contract test suite — pods adapter slot
 *
 * Parameterised over local-jss, external, off implementation classes.
 * M1: placeholder stubs give ≥1 real passing assertion per impl.
 *
 * See ADR-005 §Contract test harness and §Service-level objectives.
 */

const { assertMethodShape, assertContractVersion, assertOffClassThrows } =
  require('./fixtures/shared-assertions');

const { PodsAdapterPlaceholder: LocalJssStub, AdapterDisabled } =
  require('../../management-api/adapters/pods/placeholder');
const { PodsAdapterPlaceholder: ExternalStub } =
  require('../../management-api/adapters/pods/placeholder');
const { PodsAdapterPlaceholder: OffStub, AdapterDisabled: OffAdapterDisabled } =
  require('../../management-api/adapters/pods/placeholder');

const REQUIRED_METHODS = ['write', 'read', 'patch', 'del', 'list'];

const IMPLS = [
  { label: 'local-jss', Factory: LocalJssStub },
  { label: 'external',  Factory: ExternalStub  },
  { label: 'off',       Factory: OffStub        },
];

for (const { label, Factory } of IMPLS) {
  describe(`pods :: ${label}`, () => {

    let adapter;
    beforeEach(() => { adapter = new Factory(); });

    // --- Passing assertions (M1) ---

    it('exposes all required interface methods', () => {
      assertMethodShape(adapter, REQUIRED_METHODS);
    });

    it('reports a CONTRACT_VERSION that is valid semver', () => {
      expect(adapter.CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('CONTRACT_VERSION matches the canonical fixture value', () => {
      assertContractVersion(adapter, 'pods');
    });

    // --- Pending: off-class discipline ---

    if (label === 'off') {
      it('raises AdapterDisabled on every method', async () => {
        await assertOffClassThrows(adapter, REQUIRED_METHODS, OffAdapterDisabled);
      });
    }

    // --- Pending: behavioural equivalence ---

    it.todo('write stores a resource and returns 201 with Location header');
    it.todo('read retrieves the stored resource with correct content-type');
    it.todo('patch applies a JSON-patch diff without full overwrite');
    it.todo('del removes the resource and subsequent read returns 404');
    it.todo('list returns container children with pagination cursor');

    // --- Pending: SLO compliance ---

    it.todo('write p95 latency is under 300 ms at 20 req/s');
    it.todo('read p95 latency is under 150 ms at 100 req/s');

    // --- Pending: error shape ---

    it.todo('read throws a typed NotFound for unknown URIs');
    it.todo('write throws a typed PermissionDenied when WAC policy is violated');
  });
}
