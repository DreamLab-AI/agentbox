// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector

import type { IndustryVertical, VerticalMapping } from '../types/index.js';

// ───────────────────────────────────────────────────────────
// Industry vertical mappings
// ───────────────────────────────────────────────────────────

export const VERTICALS: Record<IndustryVertical, VerticalMapping> = {
  // ─── Healthcare (fully populated) ───
  healthcare: {
    vertical: 'healthcare',
    capabilities: [
      {
        label: 'Patient Safety & AI Verification',
        technologyIds: ['prime-radiant', 'coherence-gate', 'verified', 'cusum-drift'],
        plainDescription: 'Ensure clinical decision support systems give consistent, non-contradictory advice. Detect hallucinations in medical AI before they reach patients.',
        useCases: [
          'Verify that a diagnostic AI does not contradict itself across patient encounters',
          'Detect drift in a clinical risk scoring model over time',
          'Formally verify safety properties of drug interaction checkers',
          'Audit AI-generated clinical notes for factual consistency',
        ],
      },
      {
        label: 'Medical Knowledge Graphs',
        technologyIds: ['hypergraph-db', 'gnn', 'causal-dag'],
        plainDescription: 'Model relationships between diseases, drugs, genes, and treatments. Discover new connections through graph neural networks.',
        useCases: [
          'Build a drug interaction knowledge graph from FDA data',
          'Predict adverse drug reactions from molecular graph structure',
          'Estimate causal treatment effects from observational EHR data',
          'Map comorbidity networks to identify high-risk patient clusters',
        ],
      },
      {
        label: 'Genomics & Biomarker Search',
        technologyIds: ['hnsw', 'hyperbolic-hnsw', 'persistent-homology'],
        plainDescription: 'Search genomic databases for similar sequences, score biomarker panels, and analyze topological features in omics data.',
        useCases: [
          'Find patients with similar genomic profiles for precision medicine',
          'Score 20-SNP biomarker panels for pharmacogenomic dosing',
          'Detect topological features in single-cell RNA-seq data',
        ],
      },
      {
        label: 'Clinical NLP & Retrieval',
        technologyIds: ['hybrid-search', 'colbert', 'flash-attention'],
        plainDescription: 'Search clinical notes, retrieve relevant medical literature, and process long patient histories with efficient attention.',
        useCases: [
          'Build a RAG pipeline over clinical notes for decision support',
          'Retrieve relevant medical literature from PubMed embeddings',
          'Process 100K-token patient histories with memory-efficient attention',
        ],
      },
      {
        label: 'Edge & Embedded Medical Devices',
        technologyIds: ['micro-hnsw', 'micro-lora-wasm', 'spiking-nn', 'predictive-coding'],
        plainDescription: 'Deploy AI on medical devices and wearables with tight memory and power constraints.',
        useCases: [
          'Run anomaly detection on a wearable ECG monitor',
          'Adapt a diagnostic model on-device as patient data accumulates',
          'Reduce telemetry bandwidth from implanted sensors by 90%',
        ],
      },
    ],
    regulatoryContext: [
      'FDA 21 CFR Part 11 (electronic records)',
      'HIPAA (patient data privacy)',
      'EU MDR (medical device regulation)',
      'IEC 62304 (medical device software lifecycle)',
    ],
    referenceDocuments: [
      'docs/verticals/healthcare.md',
      'examples/dna',
      'examples/causal-health',
      'examples/verified-applications',
    ],
  },

  // ─── Finance (partially populated) ───
  finance: {
    vertical: 'finance',
    capabilities: [
      {
        label: 'Trading Signal Verification',
        technologyIds: ['neural-trader', 'prime-radiant', 'cusum-drift'],
        plainDescription: 'AI trading signals fact-checked by coherence gates before execution.',
        useCases: [
          'Gate trading decisions through coherence verification',
          'Detect model drift in real-time market conditions',
        ],
      },
      {
        label: 'Risk Network Analysis',
        technologyIds: ['hypergraph-db', 'dynamic-mincut', 'gnn'],
        plainDescription: 'Map and analyze risk propagation through financial networks.',
        useCases: [
          'Model counterparty risk networks',
          'Detect communities of correlated assets',
        ],
      },
    ],
    regulatoryContext: [
      'SEC Rule 15c3-5 (market access risk controls)',
      'MiFID II (algorithmic trading requirements)',
      'SOX (audit trail requirements)',
    ],
    referenceDocuments: [
      'examples/neural-trader',
    ],
  },

  // ─── Robotics (partially populated) ───
  robotics: {
    vertical: 'robotics',
    capabilities: [
      {
        label: 'Cognitive Robotics',
        technologyIds: ['agentic-robotics', 'spiking-nn', 'predictive-coding'],
        plainDescription: 'Build autonomous robots with perception, planning, and brain-inspired processing.',
        useCases: [
          'Build a ROS3 robot with cognitive perception pipeline',
          'Use spiking networks for energy-efficient motor control',
        ],
      },
    ],
    regulatoryContext: [
      'ISO 10218 (robot safety)',
      'IEC 61508 (functional safety)',
    ],
    referenceDocuments: [
      'examples/robotics',
      'examples/spiking-network',
    ],
  },

  // ─── Edge IoT (partially populated) ───
  'edge-iot': {
    vertical: 'edge-iot',
    capabilities: [
      {
        label: 'Ultra-Lightweight AI',
        technologyIds: ['micro-hnsw', 'micro-lora-wasm', 'hdc', 'neural-hashing', 'predictive-coding'],
        plainDescription: 'AI that fits on microcontrollers and tiny devices.',
        useCases: [
          'Deploy vector search on a 11.8KB WASM runtime',
          'Run classification in nanoseconds on embedded hardware',
          'Reduce sensor data bandwidth by 90-99%',
        ],
      },
    ],
    regulatoryContext: [],
    referenceDocuments: [
      'examples/edge',
      'examples/spiking-network',
    ],
  },

  // ─── Genomics (partially populated) ───
  genomics: {
    vertical: 'genomics',
    capabilities: [
      {
        label: 'Sequence & Variant Analysis',
        technologyIds: ['hnsw', 'hyperbolic-hnsw', 'persistent-homology', 'gnn'],
        plainDescription: 'Search and analyze genomic sequences, variants, and molecular structures.',
        useCases: [
          'Find patients with similar SNP profiles for cohort studies',
          'Analyze topological features of protein folding landscapes',
          'Predict molecular properties from graph neural network embeddings',
        ],
      },
    ],
    regulatoryContext: [
      'GINA (Genetic Information Nondiscrimination Act)',
      'EU GDPR Article 9 (genetic data as special category)',
    ],
    referenceDocuments: [
      'examples/dna',
      'examples/gnn-molecules',
    ],
  },
};
