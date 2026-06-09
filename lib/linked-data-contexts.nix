# lib/linked-data-contexts.nix
#
# Build-time-pinned JSON-LD @context catalogue. Materialises every external
# vocabulary document agentbox depends on into a single read-only directory
# under /opt/agentbox/contexts/, with content-addressed integrity.
#
# This is the runtime closure for the Linked-Data Interchange domain
# (DDD-004). The encoder middleware loads the index at boot and never
# performs network I/O thereafter — see ADR-012 §Decision and PRD-006 §5
# for the rationale, and DDD-004 §L09 for the runtime invariant this
# enforces.
#
# Hash-resolution procedure (matches lib/npm-cli.nix and lib/solid-pod-rs.nix):
#
#   1. Set every entry's `sha256` field to `lib.fakeHash` on first install
#      or when bumping a vocabulary version.
#   2. Run `./scripts/prefetch-hashes.sh --linked-data` — the helper walks
#      this catalogue, fetches each URL via `nix-prefetch-url`, converts
#      the base32 output to SRI, and patches this file in place. Up to
#      20 iterations to converge on the steady state.
#   3. Commit the resolved hashes.
#
# To add a vocabulary:
#
#   1. Append a new attrset to `catalogue` below.
#   2. Set `sha256 = lib.fakeHash`.
#   3. Run the prefetch helper as above.
#
# To override a context document at deploy time:
#
#   The manifest's [linked_data.contexts] section lets an operator point a
#   prefix at a different IRI. The new IRI must still be in this catalogue
#   at build time; the validator (E045) refuses to evaluate otherwise.

{ lib, pkgs }:

let
  # ---- Catalogue entries -----------------------------------------------------
  #
  # Each entry pins a single external @context document. `name` becomes the
  # filename under /opt/agentbox/contexts/<name>; the `index.json` aggregator
  # below maps the IRI to that filename so the runtime resolver can do an
  # O(1) lookup.

  catalogue = [
    # ── ActivityStreams 2.0 — S2 (Nostr envelopes), S5 (PROV-O cross-ref) ─────
    {
      name = "activitystreams.context.jsonld";
      iri  = "https://www.w3.org/ns/activitystreams";
      url  = "https://www.w3.org/ns/activitystreams";
      sha256 = "sha256-WO4vSsOj1wCj1+F1/VJE2/BlD0JrweVBThw2/UPMpjQ=";
      vocabulary = "ActivityStreams 2.0";
      authors = "James M Snell, Evan Prodromou";
      status = "W3C Recommendation 2017-05-23";
      surfaces = [ "S1" "S2" "S5" ];
    }

    # ── W3C Verifiable Credentials 2.0 — S3 (credentials), S8 (payments) ─────
    {
      name = "credentials-v2.context.jsonld";
      iri  = "https://www.w3.org/ns/credentials/v2";
      url  = "https://www.w3.org/ns/credentials/v2";
      sha256 = "sha256-WZVc7WaX1h4D8rJVb+vlMIqxaEKEb1tYbX8fet7JJzQ=";
      vocabulary = "Verifiable Credentials Data Model 2.0";
      authors = "Manu Sporny, Dave Longley, Markus Sabadello, Orie Steele, Christopher Allen";
      status = "W3C Recommendation 2025-05-15";
      surfaces = [ "S3" "S8" ];
    }

    # ── W3C DID Core 1.0 — S4 (DID Documents) ────────────────────────────────
    {
      name = "did-v1.context.jsonld";
      iri  = "https://www.w3.org/ns/did/v1";
      url  = "https://www.w3.org/ns/did/v1";
      sha256 = "sha256-Tz6uVWjJxfA2oIIIj54ZIBnuBvqniXPIf/kdVCG4ja0=";
      vocabulary = "DID Core 1.0";
      authors = "Drummond Reed, Manu Sporny, Dave Longley, Christopher Allen, Ryan Grant, Markus Sabadello";
      status = "W3C Recommendation 2022-07-19";
      surfaces = [ "S4" ];
    }

    # ── Schema.org — S1, S6, S7, S8, S11 (general semantic markup) ───────────
    {
      name = "schema-org.context.jsonld";
      iri  = "http://schema.org/";
      url  = "https://schema.org/docs/jsonldcontext.jsonld";
      sha256 = "sha256-WPcJQIku9O3WbpSCuf/FBVnKzAghx0rdjN3AhFGi6wM=";
      vocabulary = "Schema.org";
      authors = "Ramanathan V. Guha and the schema.org community";
      status = "Living standard, multi-vendor";
      surfaces = [ "S1" "S6" "S7" "S8" "S11" ];
    }

    # ── W3C Web of Things TD 1.1 — S6 (MCP capability descriptors) ───────────
    {
      name = "wot-td.context.jsonld";
      iri  = "https://www.w3.org/2022/wot/td/v1.1";
      url  = "https://www.w3.org/2022/wot/td/v1.1";
      sha256 = "sha256-kpjdrM4dAj5YTc1LDmObqiKPufqHQ9ytbZycKdtsoGk=";
      vocabulary = "Web of Things Thing Description 1.1";
      authors = "Sebastian Käbisch, Victor Charpenay, Matthias Kovatsch, Daniel Peintner";
      status = "W3C Recommendation 2023-12-05";
      surfaces = [ "S6" ];
    }

    # ── PROV-O — S5 (provenance receipts), S11 (HTTP meta) ───────────────────
    {
      name = "prov-o.context.jsonld";
      iri  = "http://www.w3.org/ns/prov-o#";
      url  = "https://openprovenance.org/prov-jsonld/context.jsonld";
      sha256 = "sha256-6wJWjYVlygFsH7MPijfgxow3CvkQiJfpvrZHEh4YRmw=";
      vocabulary = "PROV-O";
      authors = "Timothy Lebo, Satya Sahoo, Deborah McGuinness";
      status = "W3C Recommendation 2013-04-30";
      surfaces = [ "S5" "S11" ];
    }

    # ── DCAT-3 — S9 (memory namespace catalogues) ────────────────────────────
    {
      name = "dcat-3.context.jsonld";
      iri  = "https://www.w3.org/ns/dcat#";
      url  = "https://www.w3.org/ns/dcat3.jsonld";
      sha256 = "sha256-SLvVOw8/67Xna7FWmGjym4FVeQBiGLh/b4u/6eGWlh0=";
      vocabulary = "DCAT-3";
      authors = "Riccardo Albertoni, David Browning, Simon Cox, Alejandra Gonzalez Beltran, Andrea Perego, Peter Winstanley";
      status = "W3C Recommendation 2024-08-22";
      surfaces = [ "S9" ];
    }

    # ── ODRL 2.2 — S8 (agentic-payment policies) ─────────────────────────────
    {
      name = "odrl-2.context.jsonld";
      iri  = "http://www.w3.org/ns/odrl/2/";
      url  = "https://www.w3.org/ns/odrl.jsonld";
      sha256 = "sha256-u1WrMrxgQcbvcjy86JUQEopN+5vsYCR3ckB5GxEsi2w=";
      vocabulary = "ODRL Information Model 2.2";
      authors = "Renato Iannella, Serena Villata";
      status = "W3C Recommendation 2018-02-15";
      surfaces = [ "S8" ];
    }

    # ── SKOS — S10 (architecture documentation) ──────────────────────────────
    {
      name = "skos.context.jsonld";
      iri  = "http://www.w3.org/2004/02/skos/core#";
      url  = "https://www.w3.org/2009/08/skos-reference/skos.rdf";
      sha256 = "sha256-55YzuNBWSBbO6KmfXJrPmg5vxyV8cgms1oTsrVOondY=";
      vocabulary = "SKOS Reference";
      authors = "Alistair Miles, Sean Bechhofer";
      status = "W3C Recommendation 2009-08-18";
      surfaces = [ "S10" ];
    }

    # ── Dublin Core Terms — S10 (architecture documentation) ─────────────────
    {
      name = "dcterms.context.jsonld";
      iri  = "http://purl.org/dc/terms/";
      url  = "https://www.dublincore.org/specifications/dublin-core/dcmi-terms/dublin_core_terms.ttl";
      sha256 = "sha256-E99AEHLdcBW/nXUWLz5ByBOAdTBLe5zBqh6cFtuXZ5c=";
      vocabulary = "Dublin Core Terms";
      authors = "DCMI Usage Board";
      status = "DCMI Specification 2020-01-20";
      surfaces = [ "S10" ];
    }

    # ── agentbox extension vocabulary — every surface that needs agbx: terms ─
    #
    # The `agbx:` namespace covers terms with no upstream W3C / IETF /
    # Schema.org equivalent. Each term has a documented rationale in
    # docs/reference/_vocab/agbx.md. The published context document lives
    # at docs/reference/_vocab/agentbox-v1.context.jsonld and ships with
    # the image at /opt/agentbox/contexts/agentbox-v1.context.jsonld.
    #
    # The repo-local path under `path` is materialised by `pkgs.runCommand`
    # below — there is no network fetch for this entry because the vocabulary
    # is first-party and tracked in-tree.
    {
      name = "agentbox-v1.context.jsonld";
      iri  = "https://agentbox.dreamlab-ai.systems/ns/v1#";
      path = ../docs/reference/_vocab/agentbox-v1.context.jsonld;
      vocabulary = "agentbox extension vocabulary v1";
      authors = "DreamLab-AI agentbox team";
      status = "Draft 2026-04-25";
      surfaces = [ "S1" "S2" "S5" "S6" "S7" "S8" "S10" "S11" ];
    }
  ];

  # ---- Per-entry derivations -------------------------------------------------

  # Fetch a remote context document via fetchurl (FOD; sandbox-permitted
  # because outputHash is declared via sha256).
  fetchRemote = entry: pkgs.fetchurl {
    inherit (entry) url sha256;
    name = entry.name;
  };

  # Materialise an in-tree context document (no network).
  materialiseLocal = entry: pkgs.runCommand entry.name { } ''
    cp ${entry.path} $out
  '';

  resolveEntry = entry:
    if entry ? path
    then materialiseLocal entry
    else fetchRemote entry;

  # ---- Index.json ------------------------------------------------------------
  #
  # Produced as a sibling of the catalogue, mapping IRI → filename + metadata
  # so the runtime resolver can do an O(1) lookup. This file is what the
  # encoder loads at boot via context-resolver.js.

  indexContent = builtins.toJSON {
    schemaVersion = 1;
    generatedBy = "lib/linked-data-contexts.nix";
    pinnedAt = "2026-04-25";
    entries = map (e: {
      iri = e.iri;
      name = e.name;
      vocabulary = e.vocabulary;
      authors = e.authors;
      status = e.status;
      surfaces = e.surfaces;
    }) catalogue;
  };

  indexFile = pkgs.writeText "linked-data-contexts-index.json" indexContent;

in
  pkgs.runCommand "agentbox-linked-data-contexts" {
    passthru = {
      inherit catalogue;
      catalogueIris = map (e: e.iri) catalogue;
      catalogueSurfaces = lib.unique (lib.concatLists (map (e: e.surfaces) catalogue));
    };

    meta = {
      description = "JSON-LD context catalogue pinned at build time (PRD-006 / ADR-012 / DDD-004)";
      longDescription = ''
        Build-time-pinned set of W3C / IETF / Schema.org / agentbox @context
        documents. Materialises into /opt/agentbox/contexts/ at runtime, with
        an index.json mapping each PinnedContextIRI to its on-disk file and
        provenance metadata. The runtime encoder loads the index once at boot
        and never performs network I/O thereafter (DDD-004 §L09).
      '';
    };
  } ''
    mkdir -p "$out"

    ${lib.concatMapStringsSep "\n" (entry: ''
      cp ${resolveEntry entry} "$out/${entry.name}"
    '') catalogue}

    cp ${indexFile} "$out/index.json"
  ''
