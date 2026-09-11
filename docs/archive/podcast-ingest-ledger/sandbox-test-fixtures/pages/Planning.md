public:: true

# Planning
```json-ld
{
  "@context": "https://narrativegoldmine.com/context/v1.jsonld",
  "@id": "urn:visionflow:page:235f0b65a00ae6c7b3f519a593e60a246f70b015a2d29112320362d5953df23b",
  "@type": "Page",
  "vc:slug": "planning",
  "title": "Planning",
  "vc:public": true,
  "vc:outboundWikilinks": [
    {
      "@id": "urn:visionflow:linked:search-algorithm",
      "vc:label": "Search Algorithm"
    },
    {
      "@id": "urn:visionflow:linked:autonomous-agent",
      "vc:label": "Autonomous Agent"
    },
    {
      "@id": "urn:visionflow:linked:automated-planning",
      "vc:label": "Automated Planning"
    },
    {
      "@id": "urn:visionflow:linked:artificial-intelligence",
      "vc:label": "Artificial Intelligence"
    }
  ],
  "vc:schemaVersion": 2,
  "vc:legacyProperties": [
    {
      "vc:key": "preferred-term",
      "vc:value": "Planning"
    }
  ],
  "prov:wasAttributedTo": {
    "@id": "did:nostr:jjohare"
  },
  "prov:generatedAtTime": {
    "@value": "2026-05-29T00:00:00Z",
    "@type": "xsd:dateTime"
  }
}
```

```json-ld
{
  "@context": "https://narrativegoldmine.com/ns/v2.jsonld",
  "@id": "urn:ngm:class:planning",
  "@type": "Class",
  "label": "Planning",
  "definition": "Planning is the cognitive and computational process of deliberating over a set of possible actions and selecting a sequence that transforms an initial state into a desired goal state, given a model of how actions change the world. In artificial intelligence, automated planning formalises this problem using state representations, action schemas with preconditions and effects, and search or optimisation algorithms to synthesise executable plans. Planning encompasses both classical deterministic formulations (e.g. STRIPS, PDDL) and richer variants that handle uncertainty, partial observability, continuous time, resources, and preferences. It underpins autonomous agents, robotics, supply-chain management, and any system that must reason prospectively about future action consequences.",
  "domain": "artificial-intelligence",
  "maturity": "mature",
  "qualityScore": 0.7,
  "subClassOf": [
    {
      "@id": "urn:ngm:class:automated-planning",
      "label": "Automated Planning"
    }
  ],
  "relations": {
    "requires": [
      {
        "@id": "urn:ngm:class:search-algorithm",
        "label": "Search Algorithm"
      },
      {
        "@id": "urn:ngm:class:state-space-representation",
        "label": "State Space Representation"
      }
    ],
    "enables": [
      {
        "@id": "urn:ngm:class:autonomous-agent",
        "label": "Autonomous Agent"
      },
      {
        "@id": "urn:ngm:class:motion-planning",
        "label": "Robot Motion Planning"
      },
      {
        "@id": "urn:ngm:class:decision-making",
        "label": "Decision Making"
      }
    ],
    "hasPart": [
      {
        "@id": "urn:ngm:class:hierarchical-task-network",
        "label": "Hierarchical Task Network"
      }
    ],
    "uses": [
      {
        "@id": "urn:ngm:class:heuristic-function",
        "label": "Heuristic Function"
      },
      {
        "@id": "urn:ngm:class:constraint-satisfaction",
        "label": "Constraint Satisfaction"
      },
      {
        "@id": "urn:ngm:class:markov-decision-process",
        "label": "Markov Decision Process"
      }
    ],
    "dependsOn": [
      {
        "@id": "urn:ngm:class:knowledge-representation",
        "label": "Knowledge Representation"
      },
      {
        "@id": "urn:ngm:class:reasoning",
        "label": "Reasoning"
      }
    ],
    "contrastsWith": [
      {
        "@id": "urn:ngm:class:reactive-control",
        "label": "Reactive Control"
      },
      {
        "@id": "urn:ngm:class:reinforcement-learning",
        "label": "Reinforcement Learning"
      }
    ],
    "relatedTo": [
      {
        "@id": "urn:ngm:class:planning-and-scheduling",
        "label": "Scheduling"
      },
      {
        "@id": "urn:ngm:class:optimisation",
        "label": "Optimisation"
      },
      {
        "@id": "urn:ngm:class:temporal-reasoning",
        "label": "Temporal Reasoning"
      }
    ],
    "bridgesTo": [
      {
        "@id": "urn:ngm:class:supply-chain-management",
        "label": "Supply Chain Management"
      },
      {
        "@id": "urn:ngm:class:multi-agent-system",
        "label": "Multi-Agent System"
      }
    ]
  },
  "sameAs": [
    {
      "@id": "urn:ngm:class:automated-planning-and-scheduling",
      "label": "Automated Planning and Scheduling"
    },
    {
      "@id": "urn:ngm:class:ai-planning",
      "label": "AI Planning"
    }
  ],
  "quality": 0.74,
  "provenance": {
    "attributedTo": "did:nostr:ontology-mesh",
    "generatedAt": "2026-06-13T00:00:00Z",
    "inferenceRule": "ManualEnrichment"
  }
}
```

```json-ld
{
  "@context": "https://narrativegoldmine.com/context/v1.jsonld",
  "@id": "urn:visionflow:annotation:link-resolutions:planning:423614833cbd",
  "@type": "vc:LinkResolutionsAnnotation",
  "vc:appliesTo": {
    "@id": "urn:visionflow:page:235f0b65a00ae6c7b3f519a593e60a246f70b015a2d29112320362d5953df23b"
  },
  "vc:resolutions": [
    {
      "raw": "[[Search Algorithm]]",
      "resolved": "urn:visionflow:linked:search-algorithm",
      "kind": "ResolvedLink"
    },
    {
      "raw": "[[Autonomous Agent]]",
      "resolved": "urn:visionflow:linked:autonomous-agent",
      "kind": "ResolvedLink"
    },
    {
      "raw": "[[Automated Planning]]",
      "resolved": "urn:visionflow:linked:automated-planning",
      "kind": "ResolvedLink"
    },
    {
      "raw": "[[Artificial Intelligence]]",
      "resolved": "urn:visionflow:linked:artificial-intelligence",
      "kind": "ResolvedLink"
    }
  ],
  "prov:wasAttributedTo": {
    "@id": "did:nostr:lcr-swarm"
  },
  "prov:generatedAtTime": {
    "@value": "2026-05-29T00:00:00Z",
    "@type": "xsd:dateTime"
  }
}
```

- ### Definition
  - Planning is the cognitive and computational process of deliberately selecting a sequence of actions to transform an initial state into a desired goal state, given a model of how actions change the world. In [[Artificial Intelligence]], it encompasses [[Automated Planning]] — the formal, algorithmic counterpart of human forethought — and spans deterministic classical approaches, probabilistic models such as the [[Markov Decision Process]], and modern neuro-symbolic hybrids. Planning is foundational to [[Autonomous Agent]] systems, [[Robotics]], and any domain requiring prospective reasoning about future action consequences.

- ### Overview
  - Planning occupies the deliberative layer of an agent's cognitive architecture, sitting between perception and execution. Unlike purely reactive systems that map percepts directly to actions, a planning system constructs and evaluates candidate courses of action before committing to them.
  - The core planning problem is stated as: given an initial state S₀, a goal condition G, and a set of action schemas A (each with preconditions and effects), find a sequence π = ⟨a₁, a₂, …, aₙ⟩ such that executing π from S₀ satisfies G.
  - Planning matters because it allows systems to anticipate consequences, avoid irreversible mistakes, coordinate complex multi-step tasks, and exploit resources efficiently — capabilities essential for reliable autonomous behaviour.
  - The field draws on [[Search Algorithm|search algorithms]], [[Logic]] and [[Knowledge Representation]], [[Optimisation]], [[Constraint Satisfaction]], and increasingly on [[Machine Learning]] to scale to realistic problem sizes.

- ### Key Components
  - **State Representation** — the world model, often using [[State Space Representation]] such as propositional or first-order logic, numeric fluents, or factored vector encodings.
  - **Goal Representation** — [[Goal Representation]] specifies the desired end-condition; may be a conjunction of facts, a utility function, a temporal specification, or a preference ordering.
  - **Action Model** — actions are described by preconditions (conditions that must hold before the action is applicable) and effects (changes to the world state post-execution). [[PDDL]] (Planning Domain Definition Language) is the standard modelling language.
  - **Plan Synthesis** — generating a candidate plan via forward-search, backward-search, partial-order planning, or [[Constraint Satisfaction]].
  - **Heuristic Guidance** — [[Heuristic Function|heuristic functions]] such as relaxed-plan heuristics (FF, FastDownward) and landmark-based heuristics dramatically prune the [[Search Algorithm|search space]].
  - **Plan Validation** — verifying that the synthesised plan is executable and achieves the goal, often via simulation or formal proof.
  - **Plan Execution and Monitoring** — [[Plan Execution]] bridges planning and acting; a monitoring component detects deviations and triggers replanning.
  - **[[Plan Recognition]]** — inferring another agent's plan from observed behaviour; inverse of plan generation.

- ### Mechanisms and Approaches
  - **Classical Planning (STRIPS / PDDL)** — deterministic, fully observable, discrete state-space. Solved by heuristic forward-search planners (FastDownward, Lama) or SAT/LP encodings.
  - **Hierarchical Task Network (HTN)** — [[Hierarchical Task Network]] decomposes high-level tasks into sub-tasks recursively; more expressive and often computationally tractable for structured domains.
  - **Probabilistic Planning** — models uncertainty via [[Markov Decision Process]] (MDP) or Partially Observable MDP (POMDP); solved by value iteration, policy-gradient methods, or [[Reinforcement Learning]] for large state spaces.
  - **Temporal and Numeric Planning** — extends PDDL with durative actions, numeric fluents, and resource constraints; used in spacecraft operations and industrial scheduling.
  - **Partial-Order Planning** — constructs plans with partial ordering constraints between steps, allowing parallel execution; useful in multi-agent coordination.
  - **Monte Carlo Tree Search (MCTS)** — anytime planning approach combining tree-structured lookahead with random rollouts; backbone of AlphaGo/AlphaZero and game-playing agents.
  - **Neuro-Symbolic Planning** — integrates [[Neural Network]] perception/heuristic learning with symbolic plan synthesis; addresses scalability to raw sensory input.
  - **LLM-Driven Planning** — [[Large Language Model|large language models]] are increasingly used to generate, critique, and refine plans in natural language, bridging informal task specification and formal executors.

- ### Applications and Use Cases
  - **[[Robotics]]** — motion planning ([[Robot Motion Planning]]), task planning for manipulation, assembly, and navigation; used in autonomous vehicles, industrial robots, and drone swarms.
  - **[[Autonomous Agent]] Systems** — deliberative AI agents (game NPCs, personal assistants, software agents) use planning to select and sequence complex goal-directed behaviours.
  - **[[Supply Chain Management]]** — production scheduling, logistics route planning, warehouse automation; planning under resource and temporal constraints.
  - **Space Mission Operations** — NASA's MAPGEN and ASPEN systems use PDDL-based planners to schedule daily activities for Mars rovers.
  - **Healthcare** — treatment protocol selection, surgical workflow planning, clinical pathway management.
  - **Natural Language Processing** — discourse planning for text generation; dialogue management in conversational agents.
  - **Game AI** — real-time strategy game agents, board-game solvers (chess, Go), narrative planning for interactive fiction.
  - **[[Multi-Agent System]] Coordination** — distributed planning in multi-agent settings where agents share goals or must avoid conflicts.

- ### Relationships
  - partOf:: [[Artificial Intelligence]]
  - uses:: [[Search Algorithm]]
  - uses:: [[Heuristic Function]]
  - uses:: [[Constraint Satisfaction]]
  - uses:: [[Markov Decision Process]]
  - requires:: [[State Space Representation]]
  - requires:: [[Goal Representation]]
  - requires:: [[Knowledge Representation]]
  - dependsOn:: [[Reasoning]]
  - enables:: [[Autonomous Agent]]
  - enables:: [[Robot Motion Planning]]
  - enables:: [[Decision Making]]
  - hasPart:: [[Hierarchical Task Network]]
  - hasPart:: [[Plan Recognition]]
  - hasPart:: [[Plan Execution]]
  - contrastsWith:: [[Reactive Control]]
  - contrastsWith:: [[Reinforcement Learning]]
  - relatedTo:: [[Scheduling]]
  - relatedTo:: [[Optimisation]]
  - relatedTo:: [[Temporal Reasoning]]
  - bridges-to:: [[Supply Chain Management]]
  - bridges-to:: [[Multi-Agent System]]
  - sameAs:: [[Automated Planning]]
  - sameAs:: [[AI Planning]]

- ### Standards and Context
  - **[[PDDL]]** (Planning Domain Definition Language) — the de facto standard for specifying classical planning problems; versions PDDL 1.0 through PDDL 3.1 progressively add temporal, numeric, preference, and modular features. Maintained by the International Planning Competition (IPC) community.
  - **International Planning Competition (IPC)** — biennial benchmark competition that evaluates planners against standardised PDDL domains; a key driver of algorithmic progress since 1998.
  - **RDDL** (Relational Dynamic influence Diagram Language) — standard for probabilistic planning problems used in IPPC (International Probabilistic Planning Competition).
  - **OWL-S / WSMO** — semantic web service description languages that incorporate planning concepts for automated service composition.
  - **ROS MoveIt** — the dominant open-source motion planning framework for [[Robotics]], integrating planners such as OMPL into the Robot Operating System.
  - Relevant standards bodies include AAAI, IJCAI, and IEEE RAS, which publish foundational research. ISO/IEC work on autonomous system safety increasingly references planning as a critical module requiring formal verification.

- ### Provenance
  - sources:: Russell & Norvig, "Artificial Intelligence: A Modern Approach" (4th ed.); Ghallab, Nau & Traverso, "Automated Planning: Theory and Practice"; IPC benchmark archives; AAAI/IJCAI planning track proceedings
  - updated:: 2026-06-13
