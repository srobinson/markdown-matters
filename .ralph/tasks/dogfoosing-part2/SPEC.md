# Task: dogfoosing-part2

## Goal

Synthesize the HumanWork specification by incorporating all feedback, architectural refinements, and evolution insights from multiple documentation sources into a coherent, updated specification document.

## Context

Three documentation sources represent an evolution timeline:
1. **Initial Spec** (`/Users/alphab/Dev/LLM/DEV/TMP/memory/docs`) - Original comprehensive schema proposal
2. **Amorphic Evaluation** (`/Users/alphab/Dev/LLM/DEV/TMP/memory.02/docs.amorphic`) - Schema review discussions proposing paradigm shift
3. **Evolution Docs** (`HumanWork-Evolution.md`, `LETTA_INTEGRATION_PLAN.md`) - Further refinements and positioning

## Success Criteria

- [ ] Create unified spec document incorporating all terminology changes
- [ ] Replace "Agent" with "Actor" (type: Human | Machine) throughout
- [ ] Replace "Artifact" with "Deliverable" throughout
- [ ] Replace "Event Memory" with "The Ledger" throughout
- [ ] Add "Correction Event" as new primitive
- [ ] Add "Authority Gradient" concept (replacing binary control)
- [ ] Add "Pattern Crystallization" section to Memory Model
- [ ] Incorporate "choreography over orchestration" language
- [ ] Include the "hw as missing runtime for Labor" positioning
- [ ] Integrate Letta memory block concepts where appropriate
- [ ] Preserve all original architecture (5-layer stack, 3-tier memory)

## Key Changes to Incorporate

### Terminology Updates
| Original | Updated |
|----------|---------|
| Agent | Actor |
| Artifact | Deliverable |
| Event Memory | The Ledger |
| Orchestration | Choreography |

### New Primitives

**Actor** (replaces Agent):
```yaml
actor:
  id: string
  type: enum (Human, Machine)
  role: role.name
  cost_model: unified ($/hour or $/token)
```

**Correction Event**:
```yaml
correction_event:
  id: string
  correcting_actor: actor_id (human)
  target_deliverable_id: string
  diff: object
  pattern_type: enum (tone, facts, structure, logic, style)
```

**Authority Level**:
```yaml
authority_level:
  mode: enum (instructional, consultative, supervisory, exploratory)
```

### Philosophical Reframings
- FROM: "Humans remain continuously in control"
- TO: "Humans define boundaries of autonomy that expand as organizational intelligence accumulates"

- FROM: "Workflows provide guidance, not execution"
- TO: "Workflows provide choreography - emergent collaboration patterns"

## Constraints

- Use mdtldr tool for reading source documents
- Preserve all existing architecture guarantees
- Output as single comprehensive markdown spec
- Follow existing document structure/style from initial spec

## Notes

The synthesis should position HumanWork as:
> "The missing `hw` primitive - infrastructure for Labor alongside compute, storage, and network"

Key insight: The Ledger becomes the primary asset - capturing organizational intelligence through correction events that crystallize into reusable patterns.

The paradox to acknowledge: "The better HumanWork works, the less humans are needed. But that's the point."
