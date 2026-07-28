# Coding Rules

11 rule files are bundled in the `rules/` subdirectory (relative to the skill
directory). Each rule targets a specific file path pattern and is enforced when
agents operate on matching files. The summaries below mirror those files; read
the full file in `rules/` for the authoritative version.

## gameplay-code (`src/gameplay/**`)

- All gameplay values from external config, never hardcoded
- Delta time for all time-dependent calculations
- No direct UI references; use events/signals
- State machines require explicit transition tables
- Unit tests for all gameplay logic
- Dependency injection over singletons

## shader-code (`assets/shaders/**`)

- Performance budgets per shader pass
- Document all uniforms with type and range
- Fallback shaders for lower-end hardware
- No branching in fragment shaders where avoidable
- Vertex/fragment split must be justified

## ui-code (`src/ui/**`)

- UI must never own or modify game state; display only
- Events/commands to request state changes
- All text through localisation system, never hardcoded strings
- Accessibility requirements on all interactive elements
- Responsive layout for multiple resolutions

## network-code (`src/networking/**`)

- Server authoritative for all gameplay-critical state
- Never trust client input; validate everything server-side
- Bandwidth budgets per message type
- Lag compensation documented per system
- Deterministic simulation where possible

## ai-code (`src/ai/**`)

- 2ms per frame maximum AI update budget
- Behaviour trees over state machines for complex AI
- Debug visualisation for all AI decisions
- Configurable difficulty through data, not code branches
- LOD system for off-screen AI

## engine-code (`src/core/**`)

- Zero allocations in hot paths (update, render, physics)
- Pre-allocate, pool, and reuse
- Thread safety documented on every public API
- Platform abstraction for OS-specific code
- Profiling hooks on all major subsystems

## prototype-code (`prototypes/**`)

- Relaxed standards; code is throwaway
- Every file must begin with `// PROTOTYPE - NOT FOR PRODUCTION`
- Hardcoded values permitted
- No requirement for tests or error handling
- Must never be imported from `src/`

## test-standards (`tests/**`)

- Naming: `test_[system]_[scenario]_[expected_result]`
- Arrange-Act-Assert structure
- No test interdependencies
- Mock external systems
- Performance tests with explicit budget assertions

## data-files (`assets/data/**`)

- All JSON must be valid; broken JSON blocks the build
- Schema validation for all data files
- Version field in all data schemas
- No executable logic in data files
- Human-readable formatting with comments where the format supports them

## narrative (`design/narrative/**`)

- Cross-reference all new lore against existing lore for contradictions
- Character voice consistency checks
- Branching dialogue must define all paths including dead ends
- Cultural sensitivity review for localised content

## design-docs (`design/gdd/**`)

- Every document must contain 8 required sections: Overview, Player Fantasy,
  Detailed Rules, Formulas, Edge Cases, Dependencies, Tuning Knobs,
  Acceptance Criteria
- Balance values must link to their source formula or rationale
- All mechanics in dedicated documents
- Markdown format only
