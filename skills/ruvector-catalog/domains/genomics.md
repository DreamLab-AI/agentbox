# RuVector for Genomics

> For genetics researchers, clinical genomicists, and bioinformatics teams. Source: examples/dna (rvDNA module).

## Pharmacogenomics
**What it does**: Calls CYP2D6 and CYP2C19 star alleles from genotyping data (23andMe format supported) and maps to CPIC dosing guidelines. Identifies poor, intermediate, extensive, and ultra-rapid metabolizer phenotypes.
**Technologies**: rvDNA, CYP2D6/CYP2C19 star allele calling, CPIC guideline mapping
**Use cases**: Ultra-rapid CYP2D6 metabolizer flagged for codeine alternative per CPIC; CYP2C19 poor metabolizer triggers clopidogrel avoidance; biobank batch processing produces pharmacogenomic profiles for pre-emptive prescribing.
**Performance**: Full pharmacogenomic analysis in 12ms per sample.

## Biomarker Scoring
**What it does**: Computes composite risk scores from 20-SNP panels (cancer, cardiovascular, neurological). Produces 64-dimensional profile vectors for population clustering and risk stratification.
**Technologies**: rvDNA (20-SNP scoring, 64-dim vectors), ruvector-core (HNSW similarity search)
**Use cases**: Cardiovascular panel stratifies patients into risk quintiles; cancer biomarker vectors enable sub-ms clinical trial matching via HNSW; longitudinal score tracking detects disease progression.

## Variant Calling
**What it does**: Processes ref/alt alleles, translates to protein sequences, predicts functional impact. Handles VCF and 23andMe formats.
**Technologies**: rvDNA (codon translation, functional prediction, NCBI RefSeq validation)
**Validation**: 172 tests against NCBI RefSeq covering frameshifts, stop gains, and splice site mutations.
**Use cases**: Whole-exome annotation flags predicted loss-of-function variants; protein translation identifies amino acid changes with conservation-based functional predictions.

## Streaming Anomaly Detection
**What it does**: CUSUM change-point detection on biomarker time series. Identifies statistically significant shifts before clinical thresholds are crossed.
**Technologies**: neural-trader-coherence (CUSUM), ruvector-delta-core (change tracking, windowed aggregation), ruvector-temporal-tensor (time-series compression)
**Use cases**: PSA monitoring detects upward shift before absolute threshold; tumor marker trends reveal treatment resistance earlier than scheduled assessments; population surveillance detects environmental biomarker effects.

## Privacy
**What it does**: Genomic analysis runs entirely on-device via WASM. Raw genetic data never leaves the facility. Multi-site collaboration uses federated learning.
**Technologies**: ruvector-wasm, ruvector-learning-wasm (MicroLoRA), rvf-federation (PII stripping, differential privacy), rvf-crypto
**Regulatory**: Genetic data protected under GINA, GDPR Article 9, and HIPAA. WASM provides data minimization by architecture.

## Performance
- 12ms full pipeline (genotype to clinical recommendation)
- 172 tests against NCBI RefSeq
- 20-SNP panels (cancer, cardiovascular, neurological)
- 64-dim profile vectors for population-scale similarity search
- CYP2D6/CYP2C19 with CPIC mapping
- Full pipeline runs in browser via WASM
