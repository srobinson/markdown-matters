# OpenAI-Compatible LLM Providers in 2026

## Executive Summary

As of 2026, the OpenAI SDK compatibility pattern has become the de facto standard for LLM API providers. This allows developers to use the official OpenAI SDK (`openai` package) with multiple providers by simply changing the `baseURL` and API key. This pattern significantly reduces integration complexity and enables easy provider switching.

**Recommendation: STRONGLY RECOMMENDED**

The OpenAI-compatible pattern should be the primary approach for multi-provider LLM support. It offers:
- Minimal code duplication
- Easy provider switching
- Familiar developer experience
- Broad ecosystem support
- Future-proof architecture

---

## Provider Comparison Table

| Provider | Status | Base URL | Auth Method | Key Features |
|----------|--------|----------|-------------|--------------|
| **DeepSeek** | ✅ Full | `https://api.deepseek.com/v1` | Bearer Token | Fast reasoning models, 128K context |
| **Together AI** | ✅ Full | `https://api.together.xyz/v1` | Bearer Token | 200+ open-source models |
| **Groq** | ✅ Full | `https://api.groq.com/openai/v1` | Bearer Token | Ultra-fast inference, function calling |
| **Ollama** | ✅ Full | `http://localhost:11434/v1` | None (local) | Local deployment, no API key needed |
| **Anthropic Claude** | ⚠️ Limited | `https://api.anthropic.com/v1/` | Bearer Token | Testing only, use native API for production |
| **Mistral AI** | ✅ Full | `https://api.mistral.ai/v1` | Bearer Token | Magistral reasoning models |
| **Cohere** | ✅ Full | Via Compatibility API | Bearer Token | Function calling, structured outputs |
| **Fireworks AI** | ✅ Full | `https://api.fireworks.ai/inference/v1` | Bearer Token | Fast inference, MCP support |
| **Perplexity AI** | ✅ Full | `https://api.perplexity.ai` | Bearer Token | Real-time search, citations |
| **OpenRouter** | ✅ Full | `https://openrouter.ai/api/v1` | Bearer Token | 500+ models, unified gateway |
| **Cloudflare Workers AI** | ✅ Full | Via Workers AI | CF Token | Edge deployment, 50+ models |
| **vLLM** | ✅ Full | `http://localhost:8000/v1` | None (self-hosted) | Self-hosted, multi-GPU support |
| **LiteLLM Proxy** | ✅ Gateway | `http://localhost:4000/v1` | Bearer Token | 100+ providers, cost tracking |
| **Anyscale** | ⚠️ Limited | `https://api.endpoints.anyscale.com/v1` | Bearer Token | Hosted platform only (as of Aug 2024) |

---

## Detailed Provider Information

### 1. DeepSeek API

**Status:** ✅ Fully OpenAI-Compatible

**Base URL:** `https://api.deepseek.com/v1`

**Authentication:** Bearer token via `Authorization` header or API key parameter

**Models:**
- `deepseek-chat` - Fast general-purpose model (128K context)
- `deepseek-reasoner` - Reasoning mode with chain-of-thought (64K output)
- Both powered by V3.2-Exp

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY
})

const response = await client.chat.completions.create({
  model: 'deepseek-chat',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

**Limitations:**
- None reported for OpenAI compatibility

**Sources:**
- [DeepSeek API Docs](https://api-docs.deepseek.com/)
- [How to Integrate DeepSeek with Node.js Using the OpenAI SDK](https://medium.com/@akbhuker/how-to-integrate-deepseek-with-node-js-using-the-openai-sdk-a0b7ef8ae1e4)

---

### 2. Together AI

**Status:** ✅ Fully OpenAI-Compatible

**Base URL:** `https://api.together.xyz/v1`

**Authentication:** Bearer token

**Models:** 200+ open-source models including Llama, Mixtral, and more

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://api.together.xyz/v1',
  apiKey: process.env.TOGETHER_API_KEY
})

const response = await client.chat.completions.create({
  model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

**Limitations:**
- None reported for OpenAI compatibility

**Sources:**
- [OpenAI Compatibility - Together.ai Docs](https://docs.together.ai/docs/openai-api-compatibility)

---

### 3. Groq

**Status:** ✅ Fully OpenAI-Compatible

**Base URL:** `https://api.groq.com/openai/v1`

**Authentication:** Bearer token

**Models:** Fast inference models including:
- `qwen-qwq-32b` - Reasoning model
- `deepseek-r1-distill-llama-70b` - Reasoning model
- GPT-OSS 120B - OpenAI's open-weight model

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY
})

const response = await client.chat.completions.create({
  model: 'deepseek-r1-distill-llama-70b',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

**Limitations:**
- None reported for OpenAI compatibility

**Sources:**
- [Groq Docs Overview](https://console.groq.com/docs/overview)

---

### 4. Ollama

**Status:** ✅ Fully OpenAI-Compatible

**Base URL:** `http://localhost:11434/v1` (local deployment)

**Authentication:** None required (local API). API key parameter is ignored.

**Models:** Any model supported by Ollama (Llama, Mistral, etc.)

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama' // required but ignored
})

const response = await client.chat.completions.create({
  model: 'llama3.3',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

**Limitations:**
- Local deployment only (not a cloud service)
- API key is required by OpenAI SDK but ignored by Ollama

**Added Features:**
- Tool/function calling support (added in v0.13.3)

**Sources:**
- [OpenAI compatibility - Ollama](https://docs.ollama.com/api/openai-compatibility)

---

### 5. Anthropic Claude

**Status:** ⚠️ Limited Compatibility (Testing Only)

**Base URL:** `https://api.anthropic.com/v1/`

**Authentication:** Bearer token via `x-api-key` header (but uses standard OpenAI auth in compatibility mode)

**Models:**
- `claude-sonnet-4-5`
- `claude-opus-4-5`
- All Claude models

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://api.anthropic.com/v1/',
  apiKey: process.env.ANTHROPIC_API_KEY
})

const response = await client.chat.completions.create({
  model: 'claude-sonnet-4-5',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

**Important Limitations:**
- **Not for production use** - Anthropic recommends using native Claude API
- Audio input not supported (silently stripped)
- Prompt caching not supported (available in native SDK)
- Strict parameter for function calling ignored
- PDF processing, citations, extended thinking require native API

**Recommendation:**
Use native Anthropic SDK for production. OpenAI compatibility layer is for quick testing/comparison only.

**Sources:**
- [OpenAI SDK compatibility - Claude API Docs](https://platform.claude.com/docs/en/api/openai-sdk)

---

### 6. Mistral AI

**Status:** ✅ Fully OpenAI-Compatible

**Base URL:** `https://api.mistral.ai/v1`

**Authentication:** Bearer token

**Models:**
- Magistral reasoning models (specialized reasoning, June 2025+)
- Mistral Large, Medium, Small variants

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://api.mistral.ai/v1',
  apiKey: process.env.MISTRAL_API_KEY
})

const response = await client.chat.completions.create({
  model: 'mistral-large-latest',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

**Limitations:**
- None reported for OpenAI compatibility

**Sources:**
- [API Specs - Mistral Docs](https://docs.mistral.ai/api)

---

### 7. Cohere

**Status:** ✅ Fully OpenAI-Compatible

**Base URL:** Via Compatibility API endpoint

**Authentication:** Bearer token

**Models:** Cohere Command models

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://api.cohere.ai/v1', // Compatibility API
  apiKey: process.env.COHERE_API_KEY
})

const response = await client.chat.completions.create({
  model: 'command-r-plus',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

**Features:**
- Function calling
- Structured outputs
- Text embeddings

**Limitations:**
- `reasoning_effort` only supports `none` and `high` (maps to thinking mode on/off)
- Trial keys are rate-limited (1,000 API calls/month)

**Sources:**
- [Using Cohere models via the OpenAI SDK](https://docs.cohere.com/docs/compatibility-api)

---

### 8. Fireworks AI

**Status:** ✅ Fully OpenAI-Compatible

**Base URL:** `https://api.fireworks.ai/inference/v1`

**Authentication:** Bearer token

**Models:** Wide selection of open-source models

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://api.fireworks.ai/inference/v1',
  apiKey: process.env.FIREWORKS_API_KEY
})

const response = await client.chat.completions.create({
  model: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

**New Features (2026):**
- OpenAI-compatible Responses API with MCP (Model Context Protocol) support
- Server-side agentic loop handling

**Limitations:**
- None reported for OpenAI compatibility

**Sources:**
- [OpenAI compatibility - Fireworks AI Docs](https://docs.fireworks.ai/tools-sdks/openai-compatibility)

---

### 9. Perplexity AI

**Status:** ✅ Fully OpenAI-Compatible

**Base URL:** `https://api.perplexity.ai`

**Authentication:** Bearer token

**Models:**
- `sonar-pro` - Real-time search with citations
- Other Sonar variants

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://api.perplexity.ai',
  apiKey: process.env.PERPLEXITY_API_KEY
})

const response = await client.chat.completions.create({
  model: 'sonar-pro',
  messages: [{ role: 'user', content: 'What happened today in tech?' }]
})
```

**Unique Features:**
- Real-time web search
- Automatic citation of sources
- Up-to-date information

**Important Consideration:**
- High token costs: Perplexity includes full text of cited sources in input token count
- A simple question can result in high token usage if multiple long articles are cited

**Sources:**
- [OpenAI Compatibility - Perplexity](https://docs.perplexity.ai/guides/chat-completions-guide)

---

### 10. OpenRouter

**Status:** ✅ Fully OpenAI-Compatible (API Gateway)

**Base URL:** `https://openrouter.ai/api/v1`

**Authentication:** Bearer token

**Models:** 500+ models from multiple providers

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY
})

const response = await client.chat.completions.create({
  model: 'anthropic/claude-sonnet-4-5',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

**Features:**
- Unified access to 500+ models from providers like OpenAI, Anthropic, Google, etc.
- Automatic failovers
- Prompt caching
- Intelligent routing for cost/latency optimization
- 13+ free models with daily limits

**Pricing:**
- Pass-through pricing at exact provider rates
- 5% platform fee (5.5% on credits)

**Limitations:**
- Schema normalization means slight differences from native provider APIs
- Additional latency from routing layer

**Sources:**
- [OpenRouter Quickstart Guide](https://openrouter.ai/docs/quickstart)

---

### 11. Cloudflare Workers AI

**Status:** ✅ Fully OpenAI-Compatible

**Base URL:** Via Workers AI endpoints

**Authentication:** Cloudflare token

**Models:** 50+ models including:
- `@cf/openai/gpt-oss-120b` - OpenAI's open-weight model
- `@cf/openai/gpt-oss-20b`
- Other open-source models

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
  apiKey: process.env.CLOUDFLARE_API_TOKEN
})

const response = await client.chat.completions.create({
  model: '@cf/openai/gpt-oss-120b',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

**Supported Endpoints:**
- `/v1/chat/completions` - Text generation
- `/v1/embeddings` - Text embeddings

**Features:**
- Edge deployment (200+ cities worldwide)
- Serverless pricing
- Day 0 support for OpenAI's open-weight models
- OpenAI Responses API format support

**Limitations:**
- Requires Cloudflare account and setup

**Sources:**
- [OpenAI compatible API endpoints · Cloudflare Workers AI docs](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)

---

### 12. vLLM

**Status:** ✅ Fully OpenAI-Compatible (Self-Hosted)

**Base URL:** `http://localhost:8000/v1` (default, configurable)

**Authentication:** None (self-hosted)

**Models:** Any model supported by vLLM (hundreds of open-source models)

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'http://localhost:8000/v1',
  apiKey: 'none' // required by SDK but ignored
})

const response = await client.chat.completions.create({
  model: 'meta-llama/Llama-3.3-70B-Instruct',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

**Supported APIs:**
- Chat Completions API
- Completions API
- Embeddings API

**Features:**
- Self-hosted deployment
- Multi-GPU support
- Scales from single GPU to multi-node cluster
- Multimodal support (vision and audio)
- Auto-downloads models from HuggingFace

**Recent Updates (Jan 2026):**
- Support for latest models including DeepSeek R1

**Limitations:**
- Requires infrastructure setup
- Self-managed deployment

**Sources:**
- [OpenAI-Compatible Server - vLLM](https://docs.vllm.ai/en/stable/serving/openai_compatible_server/)

---

### 13. LiteLLM Proxy

**Status:** ✅ Fully OpenAI-Compatible (Gateway/Proxy)

**Base URL:** `http://localhost:4000/v1` (default)

**Authentication:** Bearer token (managed by proxy)

**Models:** 100+ providers unified through single interface

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'http://localhost:4000',
  apiKey: process.env.LITELLM_API_KEY
})

const response = await client.chat.completions.create({
  model: 'gpt-4', // LiteLLM routes to configured provider
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

**Supported Providers:**
- OpenAI, Azure, Anthropic, Cohere, Bedrock, VertexAI, HuggingFace, NVIDIA NIM, and 100+ more

**Supported Endpoints:**
- `/chat/completions`
- `/responses`
- `/embeddings`
- `/images`
- `/audio`
- `/batches`
- `/rerank`
- `/a2a` (Agent-to-Agent)
- `/messages`

**Features (2026):**
- Cost tracking and management
- Guardrails
- Load balancing
- Logging
- JWT Authentication
- Batch API routing
- Prompt management with versioning
- Agent (A2A) Gateway support

**Use Cases:**
- Unified gateway for multiple providers
- Cost tracking across providers
- Development/testing with multiple models
- Production routing and fallbacks

**Limitations:**
- Requires running proxy server
- Additional latency from proxy layer

**Sources:**
- [OpenAI-Compatible Endpoints | liteLLM](https://docs.litellm.ai/docs/providers/openai_compatible)
- [GitHub - BerriAI/litellm](https://github.com/BerriAI/litellm)

---

### 14. Anyscale Endpoints

**Status:** ⚠️ Limited Availability

**Base URL:** `https://api.endpoints.anyscale.com/v1`

**Authentication:** Bearer token

**Models:** Various open-source models

**Example:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://api.endpoints.anyscale.com/v1',
  apiKey: process.env.ANYSCALE_API_KEY
})

const response = await client.chat.completions.create({
  model: 'meta-llama/Llama-3.3-70B-Instruct',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

**Important Note:**
- As of August 1, 2024, Anyscale Endpoints API is only available through the fully Hosted Anyscale Platform
- Multi-tenant access to LLM models was removed

**Features:**
- JSON Mode
- Function calling
- Fine-tuning API (OpenAI-compatible)

**Sources:**
- [Migrate from OpenAI | Anyscale Docs](https://docs.anyscale.com/endpoints/text-generation/migrate-from-openai/)

---

## Implementation Pattern

### TypeScript Example: Universal LLM Client

```typescript
import OpenAI from 'openai'

type Provider =
  | 'openai'
  | 'deepseek'
  | 'together'
  | 'groq'
  | 'ollama'
  | 'mistral'
  | 'fireworks'
  | 'perplexity'
  | 'openrouter'

interface ProviderConfig {
  baseURL: string
  apiKey: string
  defaultModel?: string
}

const PROVIDER_CONFIGS: Record<Provider, (apiKey: string) => ProviderConfig> = {
  openai: (apiKey) => ({
    baseURL: 'https://api.openai.com/v1',
    apiKey,
    defaultModel: 'gpt-4o'
  }),
  deepseek: (apiKey) => ({
    baseURL: 'https://api.deepseek.com/v1',
    apiKey,
    defaultModel: 'deepseek-chat'
  }),
  together: (apiKey) => ({
    baseURL: 'https://api.together.xyz/v1',
    apiKey,
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
  }),
  groq: (apiKey) => ({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey,
    defaultModel: 'deepseek-r1-distill-llama-70b'
  }),
  ollama: (apiKey) => ({
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama', // ignored but required
    defaultModel: 'llama3.3'
  }),
  mistral: (apiKey) => ({
    baseURL: 'https://api.mistral.ai/v1',
    apiKey,
    defaultModel: 'mistral-large-latest'
  }),
  fireworks: (apiKey) => ({
    baseURL: 'https://api.fireworks.ai/inference/v1',
    apiKey,
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct'
  }),
  perplexity: (apiKey) => ({
    baseURL: 'https://api.perplexity.ai',
    apiKey,
    defaultModel: 'sonar-pro'
  }),
  openrouter: (apiKey) => ({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    defaultModel: 'anthropic/claude-sonnet-4-5'
  })
}

export class UniversalLLMClient {
  private client: OpenAI
  private defaultModel: string

  constructor(provider: Provider, apiKey: string) {
    const config = PROVIDER_CONFIGS[provider](apiKey)

    this.client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey
    })

    this.defaultModel = config.defaultModel || ''
  }

  async chat(
    messages: Array<{ role: string; content: string }>,
    options?: {
      model?: string
      temperature?: number
      maxTokens?: number
    }
  ) {
    return this.client.chat.completions.create({
      model: options?.model || this.defaultModel,
      messages,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens
    })
  }

  async embed(input: string | string[], model?: string) {
    return this.client.embeddings.create({
      model: model || 'text-embedding-3-small',
      input
    })
  }
}

// Usage
const client = new UniversalLLMClient('deepseek', process.env.DEEPSEEK_API_KEY!)

const response = await client.chat([
  { role: 'user', content: 'Hello!' }
])

console.log(response.choices[0].message.content)
```

---

## Architecture Recommendations

### For Production Use

1. **Primary Pattern: OpenAI SDK with Provider Switching**
   ```typescript
   // Recommended approach
   const provider = process.env.LLM_PROVIDER || 'openai'
   const client = createLLMClient(provider)
   ```

2. **Use LiteLLM Proxy for:**
   - Cost tracking across providers
   - Load balancing and failovers
   - Unified logging and monitoring
   - Development/staging environments

3. **Use OpenRouter for:**
   - Quick access to many models
   - Model experimentation
   - Fallback/redundancy strategy

4. **Use Native SDKs When:**
   - Provider-specific features required (e.g., Claude's prompt caching, extended thinking)
   - Maximum performance needed
   - Advanced features not in OpenAI spec

### Environment Configuration

```typescript
// .env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-xxx
OPENAI_API_KEY=sk-xxx
GROQ_API_KEY=gsk-xxx
TOGETHER_API_KEY=xxx
```

### Error Handling

```typescript
class LLMError extends Error {
  constructor(
    message: string,
    public provider: string,
    public originalError: unknown
  ) {
    super(message)
  }
}

async function chatWithFallback(
  messages: Array<{ role: string; content: string }>,
  providers: Provider[] = ['deepseek', 'groq', 'openai']
) {
  const errors: LLMError[] = []

  for (const provider of providers) {
    try {
      const client = new UniversalLLMClient(
        provider,
        process.env[`${provider.toUpperCase()}_API_KEY`]!
      )
      return await client.chat(messages)
    } catch (error) {
      errors.push(new LLMError(
        `${provider} failed`,
        provider,
        error
      ))
      continue
    }
  }

  throw new Error(
    `All providers failed: ${errors.map(e => e.message).join(', ')}`
  )
}
```

---

## Provider Selection Guide

### For Cost Optimization
1. **DeepSeek** - Very competitive pricing
2. **Groq** - Fast inference at good rates
3. **Together AI** - Competitive open-source model pricing
4. **OpenRouter** - Automatic cost optimization

### For Speed
1. **Groq** - Ultra-fast inference (LPU-based)
2. **Fireworks AI** - Optimized for speed
3. **Together AI** - Fast open-source models

### For Model Variety
1. **OpenRouter** - 500+ models
2. **Together AI** - 200+ open-source models
3. **LiteLLM Proxy** - 100+ providers

### For Reasoning Tasks
1. **DeepSeek** - deepseek-reasoner with chain-of-thought
2. **Groq** - qwen-qwq-32b, deepseek-r1-distill-llama-70b
3. **Mistral** - Magistral reasoning models

### For Real-Time Information
1. **Perplexity AI** - Built-in web search with citations
2. **OpenRouter** - Access to various search-enabled models

### For Local/Private Deployment
1. **Ollama** - Easy local deployment
2. **vLLM** - High-performance self-hosted
3. **LiteLLM Proxy** - Self-hosted gateway

---

## Migration Strategy

### Phase 1: Abstraction Layer
Create a unified interface that uses OpenAI SDK internally:

```typescript
interface LLMProvider {
  chat(messages: Message[]): Promise<ChatResponse>
  embed(text: string): Promise<Embedding>
}

class OpenAICompatibleProvider implements LLMProvider {
  constructor(
    private client: OpenAI,
    private defaultModel: string
  ) {}

  async chat(messages: Message[]) {
    const response = await this.client.chat.completions.create({
      model: this.defaultModel,
      messages
    })
    return response
  }
}
```

### Phase 2: Configuration
Externalize provider configuration:

```typescript
// config/llm-providers.ts
export const LLM_PROVIDERS = {
  deepseek: {
    baseURL: 'https://api.deepseek.com/v1',
    models: {
      chat: 'deepseek-chat',
      reasoning: 'deepseek-reasoner'
    }
  },
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    models: {
      fast: 'deepseek-r1-distill-llama-70b'
    }
  }
  // ... more providers
}
```

### Phase 3: Runtime Switching
Enable dynamic provider selection:

```typescript
const provider = selectProvider({
  task: 'reasoning', // or 'chat', 'search', etc.
  priority: 'cost',  // or 'speed', 'quality'
  fallbacks: true
})
```

---

## Testing Recommendations

### Provider Compatibility Tests

```typescript
import { describe, it, expect } from 'vitest'

const PROVIDERS_TO_TEST: Provider[] = [
  'deepseek',
  'groq',
  'together',
  'mistral'
]

describe.each(PROVIDERS_TO_TEST)('Provider: %s', (provider) => {
  it('should complete chat', async () => {
    const client = new UniversalLLMClient(
      provider,
      process.env[`${provider.toUpperCase()}_API_KEY`]!
    )

    const response = await client.chat([
      { role: 'user', content: 'Say "hello"' }
    ])

    expect(response.choices[0].message.content).toBeTruthy()
  })

  it('should handle streaming', async () => {
    // ... streaming test
  })

  it('should support function calling', async () => {
    // ... function calling test
  })
})
```

---

## Conclusion

The OpenAI-compatible API pattern is the **clear winner** for multi-provider LLM integration in 2026. Key benefits:

1. **Minimal Code**: One SDK, multiple providers
2. **Easy Migration**: Change 2 lines of code to switch providers
3. **Future-Proof**: New providers adopting this standard regularly
4. **Developer Experience**: Familiar interface reduces learning curve
5. **Ecosystem**: Works with existing tools built for OpenAI SDK

### Exceptions to Use Native SDKs:

- **Anthropic Claude**: Use native SDK for production (OpenAI compat is testing-only)
- **Provider-Specific Features**: When you need features not in OpenAI spec
- **Maximum Performance**: When latency is critical and provider optimizations matter

### Recommended Stack:

```
Application Code
      ↓
Universal LLM Client (OpenAI SDK-based)
      ↓
[Optional] LiteLLM Proxy (for cost tracking, routing)
      ↓
Multiple Providers (DeepSeek, Groq, Together, etc.)
```

This architecture provides flexibility, maintainability, and future-proofing while minimizing complexity.

---

## References

### Official Documentation
- [DeepSeek API Docs](https://api-docs.deepseek.com/)
- [Together AI OpenAI Compatibility](https://docs.together.ai/docs/openai-api-compatibility)
- [Groq Docs Overview](https://console.groq.com/docs/overview)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- [Anthropic OpenAI SDK compatibility](https://platform.claude.com/docs/en/api/openai-sdk)
- [Mistral AI API Specs](https://docs.mistral.ai/api)
- [Cohere Compatibility API](https://docs.cohere.com/docs/compatibility-api)
- [Fireworks AI OpenAI compatibility](https://docs.fireworks.ai/tools-sdks/openai-compatibility)
- [Perplexity OpenAI Compatibility](https://docs.perplexity.ai/guides/chat-completions-guide)
- [OpenRouter Quickstart Guide](https://openrouter.ai/docs/quickstart)
- [Cloudflare Workers AI OpenAI endpoints](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)
- [vLLM OpenAI-Compatible Server](https://docs.vllm.ai/en/stable/serving/openai_compatible_server/)
- [LiteLLM Documentation](https://docs.litellm.ai/docs/providers/openai_compatible)

### Additional Resources
- [AI SDK Providers](https://ai-sdk.dev/providers/ai-sdk-providers/)
- [OpenAI SDK (npm)](https://www.npmjs.com/package/openai)

---

**Document Version:** 1.0
**Last Updated:** January 26, 2026
**Researched by:** Claude Sonnet 4.5
