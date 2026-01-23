# Task: dogfood-updates

## Goal

Document the current semantic search implementation and research 2026 best practices for embedding models and vector search to identify concrete improvement opportunities. Focus on alternatives to traditional RAG patterns which perform poorly for semantic search.

## Execution Model

This task uses **subagents** with sequential phases:

```
PHASE 1 (Sequential)
└── Subagent: Implementation Documentation

PHASE 2 (Parallel - after Phase 1 completes)
├── Subagent 2A: Embedding Models Research
├── Subagent 2B: Vector Search Patterns Research
└── Subagent 2C: RAG Alternatives Research
```

Phase 2 subagents receive Phase 1 output as context.

---

## Success Criteria

### Phase 1: Implementation Documentation (Single Subagent)

**Subagent**: `implementation-doc`

- [x] Document embedding system architecture (provider, model, dimensions)
- [x] Document vector store implementation (HNSW config, storage format)
- [x] Document search flow (query → embed → search → rank → return)
- [x] Document current limitations and gaps
- [x] **Output**: `docs/current-implementation.md`

**Key Files to Read**:
- `src/embeddings/types.ts` - Provider interface
- `src/embeddings/openai-provider.ts` - Current provider
- `src/embeddings/semantic-search.ts` - Search logic
- `src/embeddings/vector-store.ts` - HNSW index
- `src/cli/commands/search.ts` - CLI interface

---

### Phase 2: 2026 Research (Parallel Subagents)

**IMPORTANT**: All Phase 2 subagents must read `docs/current-implementation.md` first to understand the current system before researching improvements.

#### Subagent 2A: `embedding-models-research`

Research latest embedding models with benchmarks and recommendations.

- [x] Compare OpenAI text-embedding-3-small/large vs alternatives
- [x] Research local models: Ollama embeddings, sentence-transformers, nomic-embed
- [x] Research API models: Anthropic, Cohere, Voyage AI
- [x] Include MTEB benchmark comparisons where available
- [x] Identify best options for md-tldr (cost, quality, offline capability)
- [x] **Output**: `docs/research-embedding-models.md`

#### Subagent 2B: `vector-search-research`

Research vector search patterns and retrieval techniques.

- [x] Research hybrid search (BM25 + semantic fusion)
- [x] Research re-ranking approaches (cross-encoders, ColBERT)
- [x] Research vector index alternatives (HNSW vs IVF vs graph-based)
- [x] Research filtering and metadata-aware search
- [x] Identify best patterns for md-tldr's use case
- [x] **Output**: `docs/research-vector-search.md`

#### Subagent 2C: `rag-alternatives-research`

Research alternatives to traditional RAG that improve semantic search quality.

- [x] Research why RAG performs poorly for semantic search
- [x] Research dense retrieval improvements (contrastive learning, hard negatives)
- [x] Research learned sparse retrieval (SPLADE, neural BM25)
- [x] Research late interaction models (ColBERT, PLAID)
- [x] Research query expansion and reformulation techniques
- [x] Identify practical alternatives for md-tldr
- [x] **Output**: `docs/research-rag-alternatives.md`

---

## Constraints

- Phase 2 must not start until Phase 1 completes
- All Phase 2 subagents run in parallel
- Each subagent writes its own output document
- Research should be comprehensive but always tie back to practical md-tldr improvements
- Prioritize local/offline-capable solutions where possible
- Include benchmarks and comparisons to support recommendations

## Notes

Each research subagent should conclude with:
1. **Top 3 Recommendations** for md-tldr
2. **Effort/Impact Analysis** for each recommendation
3. **Quick Wins** - low-effort improvements that could be implemented soon
