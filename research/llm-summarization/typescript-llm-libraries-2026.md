# TypeScript LLM Libraries: Comprehensive Research (2026)

**Research Date:** January 26, 2026
**Purpose:** Evaluate TypeScript alternatives to Python's LiteLLM for unified LLM provider access
**Use Case:** Code summarization API with multi-provider support

---

## Executive Summary

This research evaluates TypeScript/JavaScript libraries that provide unified interfaces to multiple LLM providers (similar to Python's LiteLLM). After comprehensive analysis, **Vercel AI SDK** emerges as the top recommendation for mdcontext's API provider abstraction, with **OpenRouter** as a compelling alternative for maximum flexibility.

### Top Recommendations

1. **Vercel AI SDK** - Best overall for production TypeScript applications
2. **OpenRouter** - Best for maximum provider choice with minimal code
3. **Instructor-js** - Best for structured output-focused applications
4. **LiteLLM Proxy** - Best when Python infrastructure is available

---

## 1. Vercel AI SDK

**GitHub:** [vercel/ai](https://github.com/vercel/ai)
**NPM:** `ai` (20M+ monthly downloads)
**License:** MIT
**Maintenance:** Extremely Active (2026)

### Overview

The Vercel AI SDK is the leading TypeScript toolkit for building AI applications, created by the Next.js team. It provides a provider-agnostic architecture with 25+ official integrations and 30+ community providers.

### Provider Support

**Official First-Party Providers (25+):**
- OpenAI (`@ai-sdk/openai`) - GPT series
- Anthropic (`@ai-sdk/anthropic`) - Claude models
- Google (`@ai-sdk/google`) - Gemini models
- Mistral (`@ai-sdk/mistral`)
- Amazon Bedrock (`@ai-sdk/amazon-bedrock`)
- Azure OpenAI (`@ai-sdk/azure`)
- Groq (`@ai-sdk/groq`)
- DeepSeek (via OpenAI-compatible provider)

**Community Providers (30+):**
- Ollama
- OpenRouter (`@openrouter/ai-sdk-provider`)
- Cloudflare Workers AI
- Together AI
- Fireworks AI
- And many more

**OpenAI-Compatible Support:**
Any self-hosted provider supporting OpenAI specification works via the OpenAI Compatible Provider (LM Studio, Heroku, etc.)

### Key Features

#### Unified API
Switch providers by changing a single line - the model string:
```typescript
import { generateText } from 'ai';

// OpenAI
const result = await generateText({
  model: 'openai/gpt-4o',
  prompt: 'Summarize this code...'
});

// Anthropic - just change the model string
const result = await generateText({
  model: 'anthropic/claude-opus-4.5',
  prompt: 'Summarize this code...'
});

// Google Gemini
const result = await generateText({
  model: 'google/gemini-2.0-flash',
  prompt: 'Summarize this code...'
});
```

#### Streaming Support
First-class streaming with Server-Sent Events (SSE):
```typescript
import { streamText } from 'ai';

const result = await streamText({
  model: 'anthropic/claude-opus-4.5',
  prompt: 'Summarize this codebase...'
});

for await (const chunk of result.textStream) {
  console.log(chunk);
}
```

#### Structured Outputs
Generate typed JSON with schema validation:
```typescript
import { generateObject } from 'ai';
import { z } from 'zod';

const CodeSummarySchema = z.object({
  summary: z.string(),
  keyFunctions: z.array(z.string()),
  complexity: z.enum(['low', 'medium', 'high']),
  suggestedImprovements: z.array(z.string())
});

const result = await generateObject({
  model: 'openai/gpt-4o',
  schema: CodeSummarySchema,
  prompt: 'Analyze this code: ...'
});

// result.object is fully typed
console.log(result.object.complexity); // TypeScript knows this is 'low' | 'medium' | 'high'
```

#### AI SDK 6 Features (Latest - 2026)

**Unified Tool Calling + Structured Outputs:**
```typescript
// Multi-step tool calling with structured output at the end
const result = await generateText({
  model: 'anthropic/claude-opus-4.5',
  tools: {
    analyzeDependencies: {
      description: 'Analyze package dependencies',
      parameters: z.object({ packageJson: z.string() })
    }
  },
  output: {
    type: 'object',
    schema: CodeAnalysisSchema
  },
  prompt: 'Analyze this codebase and provide structured insights'
});
```

**Agent Abstraction:**
```typescript
// Define reusable agents
const codeAnalyzer = createAgent({
  model: 'anthropic/claude-opus-4.5',
  instructions: 'You are an expert code analyzer',
  tools: { analyzeDependencies, detectPatterns }
});

// Use across application with type-safe streaming
const result = await codeAnalyzer.run(userPrompt);
```

**Schema Library Flexibility:**
Supports any schema library implementing Standard JSON Schema V1:
- Zod
- Valibot
- JSON Schema
- Custom implementations

### TypeScript Support

**Quality:** Excellent - TypeScript-first design
**Type Inference:** Full type inference from schemas to outputs
**Codebase:** 75.3% TypeScript

### API Design & Ergonomics

**Pros:**
- Intuitive function names (`generateText`, `streamText`, `generateObject`)
- Minimal boilerplate
- Consistent API across all providers
- Excellent documentation at [ai-sdk.dev](https://ai-sdk.dev/)
- Clear error messages

**Cons:**
- Retry logic doesn't respect provider-specific `retry-after` headers (uses exponential backoff)
- Default maxRetries is only 2
- Some advanced features require understanding Vercel ecosystem

### Maintenance Status (2026)

- **GitHub Stars:** 21,000+
- **Forks:** Active development
- **Contributors:** Large team
- **Dependencies:** 89,000+ projects
- **Recent Updates:** AI SDK 6 released with major improvements
- **NPM Downloads:** 20M+ monthly
- **Last Update:** Continuously updated (multiple releases in Jan 2026)

### Provider-Specific Quirks Handling

**Rate Limiting:**
- Built-in exponential backoff
- Default 2 retries (configurable with `maxRetries`)
- **Issue:** Doesn't respect `retry-after` headers from providers
- **Workaround:** Set `maxRetries: 0` and implement custom retry logic

**Authentication:**
- Provider-specific auth handled per provider package
- Environment variables or direct API key configuration

**Retries:**
```typescript
const result = await generateText({
  model: 'openai/gpt-4o',
  maxRetries: 5, // Override default
  prompt: 'Summarize...'
});
```

### Production Readiness

**Strengths:**
- Battle-tested by major companies
- Used in production by thousands of applications
- Comprehensive error handling
- Monitoring integration with Vercel platform

**Considerations:**
- Best when paired with Vercel infrastructure
- Some features optimized for Next.js (but works standalone)

### Code Example: Code Summarization

```typescript
import { generateText, streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

// Simple generation
async function summarizeCode(code: string, provider: 'openai' | 'anthropic') {
  const modelMap = {
    openai: 'gpt-4o',
    anthropic: 'claude-opus-4.5'
  };

  const result = await generateText({
    model: `${provider}/${modelMap[provider]}`,
    maxRetries: 3,
    prompt: `Analyze and summarize this code:\n\n${code}`
  });

  return result.text;
}

// Structured output
import { z } from 'zod';

const SummarySchema = z.object({
  overview: z.string(),
  functions: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
    complexity: z.enum(['low', 'medium', 'high'])
  })),
  dependencies: z.array(z.string()),
  recommendations: z.array(z.string())
});

async function structuredCodeSummary(code: string) {
  const result = await generateObject({
    model: 'anthropic/claude-opus-4.5',
    schema: SummarySchema,
    prompt: `Provide detailed analysis: ${code}`
  });

  return result.object; // Fully typed
}

// Streaming for real-time feedback
async function streamingSummary(code: string) {
  const result = await streamText({
    model: 'openai/gpt-4o',
    prompt: `Summarize: ${code}`
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
}
```

### Pros for mdcontext

✅ Industry-leading TypeScript support
✅ 20M+ monthly downloads - proven stability
✅ Unified API - change providers with one line
✅ Excellent structured output with Zod
✅ First-class streaming support
✅ Active development (AI SDK 6 just released)
✅ Comprehensive documentation
✅ Works standalone (Node.js, not just Next.js)

### Cons for mdcontext

❌ Retry logic doesn't respect provider retry-after headers
❌ Requires installing separate packages per provider
❌ Some features optimized for Vercel platform
❌ More opinionated than pure client libraries

### Recommendation for mdcontext

**Rating: 9.5/10 - HIGHLY RECOMMENDED**

**Best for:** Production TypeScript applications requiring multi-provider LLM access with excellent developer experience.

**Use when:** You want industry-standard tooling with great TypeScript support, structured outputs, and streaming capabilities.

---

## 2. LangChain.js

**GitHub:** [langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs)
**NPM:** `langchain`
**License:** MIT
**Maintenance:** Active (2026)

### Overview

LangChain.js is the JavaScript/TypeScript counterpart to the popular Python LangChain framework. It provides a comprehensive framework for building LLM-powered applications with emphasis on chaining operations and RAG patterns.

### Provider Support

**Major Providers:**
- OpenAI (GPT series)
- Anthropic (Claude)
- Google (Gemini)
- Cohere
- Azure OpenAI
- Hugging Face
- Ollama (local models)
- 50+ total integrations

**Unique Features:**
- Document loaders (PDF, web, databases)
- Vector store integrations (Pinecone, Weaviate, Chroma, etc.)
- Memory systems for conversational agents

### Key Features

#### Model Abstraction
```typescript
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";

// OpenAI
const openaiModel = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.7
});

// Anthropic - similar interface
const claudeModel = new ChatAnthropic({
  modelName: "claude-opus-4.5",
  temperature: 0.7
});

// Use with same API
const response = await openaiModel.invoke([
  { role: "user", content: "Summarize this code..." }
]);
```

#### Chains and Agents
```typescript
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { LLMChain } from "langchain/chains";

const template = "Summarize this code with focus on {aspect}:\n\n{code}";
const prompt = new PromptTemplate({
  template,
  inputVariables: ["aspect", "code"]
});

const chain = new LLMChain({
  llm: new ChatOpenAI({ modelName: "gpt-4o" }),
  prompt
});

const result = await chain.call({
  aspect: "performance implications",
  code: sourceCode
});
```

#### Streaming
```typescript
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({ streaming: true });

const stream = await model.stream("Summarize this code...");

for await (const chunk of stream) {
  console.log(chunk.content);
}
```

#### Structured Output
```typescript
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

const SummarySchema = z.object({
  overview: z.string(),
  complexity: z.enum(["low", "medium", "high"])
});

const model = new ChatOpenAI({ modelName: "gpt-4o" });
const structured = model.withStructuredOutput(SummarySchema);

const result = await structured.invoke("Analyze this code...");
// result is typed according to schema
```

### TypeScript Support

**Quality:** Good - Full TypeScript rewrite
**Type Inference:** Good, improving with recent versions
**Codebase:** 95.6% TypeScript

### API Design & Ergonomics

**Pros:**
- Comprehensive framework with many utilities
- Strong RAG and document processing capabilities
- Extensive ecosystem of integrations
- Familiar for Python LangChain users

**Cons:**
- More verbose than AI SDK
- Requires understanding LangChain concepts (chains, agents, prompts)
- More boilerplate code for simple tasks
- Tool calling more complex (requires `createReactAgent`)

### Maintenance Status (2026)

- **GitHub Stars:** 16,800+
- **Forks:** 3,000+
- **Contributors:** 1,065+
- **Dependencies:** 49,100+ projects
- **Recent Updates:** Active releases in 2026
- **Compatibility:** Node.js 20.x/22.x/24.x, Cloudflare Workers, Deno, Bun, browsers

### Provider-Specific Quirks Handling

**Rate Limiting:**
- Provider-specific implementations
- Configurable retry logic per model

**Authentication:**
- Environment variables
- Direct API key configuration
- Azure AD integration for Azure OpenAI

**Retries:**
```typescript
const model = new ChatOpenAI({
  maxRetries: 3,
  timeout: 60000
});
```

### Production Readiness

**Strengths:**
- Battle-tested framework
- Used by LinkedIn, Uber, Klarna, GitLab (via LangGraph)
- LangSmith integration for monitoring
- Comprehensive error handling

**Considerations:**
- Larger bundle size than simpler alternatives
- Learning curve for framework concepts
- May be overkill for simple LLM calls

### Code Example: Code Summarization

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { PromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";

// Simple summarization with provider switching
class CodeSummarizer {
  private models = {
    openai: new ChatOpenAI({ modelName: "gpt-4o" }),
    anthropic: new ChatAnthropic({ modelName: "claude-opus-4.5" })
  };

  async summarize(code: string, provider: 'openai' | 'anthropic') {
    const model = this.models[provider];

    const result = await model.invoke([
      {
        role: "system",
        content: "You are an expert code analyst."
      },
      {
        role: "user",
        content: `Summarize this code:\n\n${code}`
      }
    ]);

    return result.content;
  }
}

// Structured output
const SummarySchema = z.object({
  overview: z.string(),
  functions: z.array(z.object({
    name: z.string(),
    purpose: z.string()
  })),
  complexity: z.enum(["low", "medium", "high"])
});

async function structuredSummary(code: string) {
  const model = new ChatOpenAI({ modelName: "gpt-4o" });
  const structured = model.withStructuredOutput(SummarySchema);

  const result = await structured.invoke(
    `Analyze this code: ${code}`
  );

  return result; // Fully typed
}

// Chain-based approach
import { LLMChain } from "langchain/chains";

const summaryTemplate = `
You are analyzing code. Focus on {aspect}.

Code:
{code}

Provide a detailed summary.
`;

const prompt = new PromptTemplate({
  template: summaryTemplate,
  inputVariables: ["aspect", "code"]
});

const chain = new LLMChain({
  llm: new ChatOpenAI({ modelName: "gpt-4o" }),
  prompt
});

const result = await chain.call({
  aspect: "performance and scalability",
  code: sourceCode
});
```

### Pros for mdcontext

✅ Comprehensive framework with RAG capabilities
✅ 16.8k stars - proven reliability
✅ Extensive provider support
✅ Strong document processing features
✅ LangSmith monitoring integration
✅ Large community (1,065+ contributors)

### Cons for mdcontext

❌ More verbose than alternatives
❌ Steeper learning curve
❌ Heavier bundle size
❌ Tool calling requires additional setup
❌ May be overkill for simple summarization

### Recommendation for mdcontext

**Rating: 7/10 - GOOD BUT HEAVYWEIGHT**

**Best for:** Complex applications requiring RAG, document processing, or multi-step agent workflows.

**Use when:** You need comprehensive LLM orchestration capabilities beyond simple API calls, or plan to build complex agent systems.

**Skip when:** You just need clean multi-provider LLM access without the framework overhead.

---

## 3. Instructor-js

**GitHub:** [instructor-ai/instructor-js](https://github.com/instructor-ai/instructor-js)
**NPM:** `@instructor-ai/instructor`
**License:** MIT
**Maintenance:** Active (2026)

### Overview

Instructor is a specialized library focused on structured data extraction from LLMs using TypeScript and Zod schemas. It's lightweight, fast, and purpose-built for reliable structured outputs.

### Provider Support

**Primary:** OpenAI API
**Extended via llm-polyglot:**
- Anthropic
- Azure OpenAI
- Cohere
- Any OpenAI-compatible API

**Focus:** Provider support via OpenAI-compatible interfaces rather than native integrations.

### Key Features

#### Type-Safe Structured Extraction
```typescript
import Instructor from "@instructor-ai/instructor";
import OpenAI from "openai";
import { z } from "zod";

const client = Instructor({
  client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  mode: "TOOLS" // or "FUNCTIONS", "JSON", "MD_JSON"
});

const CodeSummarySchema = z.object({
  overview: z.string().describe("High-level summary of the code"),
  functions: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
    complexity: z.enum(["low", "medium", "high"])
  })),
  dependencies: z.array(z.string()),
  technicalDebt: z.array(z.string()).optional()
});

const summary = await client.chat.completions.create({
  messages: [
    {
      role: "user",
      content: `Analyze this code:\n\n${sourceCode}`
    }
  ],
  model: "gpt-4o",
  response_model: {
    schema: CodeSummarySchema,
    name: "CodeSummary"
  }
});

// summary is fully typed from the Zod schema
console.log(summary.overview);
console.log(summary.functions[0].complexity); // Type-safe!
```

#### Response Modes

**TOOLS Mode (Recommended):**
```typescript
const client = Instructor({
  client: new OpenAI(),
  mode: "TOOLS" // Uses OpenAI's tool specification
});
```

**JSON Mode:**
```typescript
const client = Instructor({
  client: new OpenAI(),
  mode: "JSON" // Sets response_format to json_object
});
```

**MD_JSON Mode:**
```typescript
const client = Instructor({
  client: new OpenAI(),
  mode: "MD_JSON" // JSON embedded in Markdown code blocks
});
```

#### Partial Streaming
```typescript
import { z } from "zod";

const ProgressSchema = z.object({
  currentStep: z.string(),
  progress: z.number(),
  summary: z.string().optional()
});

const stream = await client.chat.completions.create({
  messages: [{ role: "user", content: "Analyze large codebase..." }],
  model: "gpt-4o",
  response_model: { schema: ProgressSchema, name: "Progress" },
  stream: true
});

for await (const partial of stream) {
  console.log(`Step: ${partial.currentStep} - ${partial.progress}%`);
}
```

#### Validation and Retries
```typescript
const EmailSchema = z.object({
  email: z.string().email(), // Built-in validation
  verified: z.boolean()
});

// Automatic retry on validation failure
const result = await client.chat.completions.create({
  messages: [{ role: "user", content: "Extract email..." }],
  model: "gpt-4o",
  response_model: { schema: EmailSchema, name: "Email" },
  max_retries: 3 // Retry if Zod validation fails
});
```

### TypeScript Support

**Quality:** Excellent - TypeScript-first design
**Type Inference:** Full type inference from Zod schemas
**Zod Integration:** First-class (24M+ monthly downloads ecosystem)

### API Design & Ergonomics

**Pros:**
- Extremely simple API - wraps OpenAI client
- Automatic type inference from schemas
- Minimal boilerplate
- Transparent - easy to debug
- Focused on one thing (structured extraction) and does it excellently

**Cons:**
- Provider switching less elegant than AI SDK
- Requires OpenAI-compatible APIs (not native Anthropic, etc.)
- No built-in agent/chain capabilities
- Limited to structured output use case

### Maintenance Status (2026)

- **GitHub Stars:** Growing (part of instructor ecosystem)
- **Python Version:** 3M+ monthly downloads, 11k+ stars, 100+ contributors
- **TypeScript Version:** Active development
- **Community:** Strong support across languages (Python, TypeScript, Go, Ruby, Elixir, Rust)

### Provider-Specific Quirks Handling

**Rate Limiting:**
- Inherits from underlying OpenAI client
- Custom retry logic for validation failures

**Authentication:**
- Pass through OpenAI client configuration

**Provider Switching:**
```typescript
// Using Anthropic via llm-polyglot
import { createAnthropic } from 'llm-polyglot';

const anthropicClient = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const client = Instructor({
  client: anthropicClient,
  mode: "TOOLS"
});

// Same API as OpenAI
const result = await client.chat.completions.create({
  messages: [{ role: "user", content: "..." }],
  model: "claude-opus-4.5",
  response_model: { schema: MySchema, name: "Response" }
});
```

### Production Readiness

**Strengths:**
- Lightweight and fast
- Focused scope reduces bug surface
- Battle-tested (Python version widely used)
- Easy to debug due to transparency

**Considerations:**
- Less comprehensive than full frameworks
- Provider support requires compatibility layers
- Single-purpose tool (not full LLM orchestration)

### Code Example: Code Summarization

```typescript
import Instructor from "@instructor-ai/instructor";
import OpenAI from "openai";
import { z } from "zod";

// Define comprehensive schema
const CodeAnalysisSchema = z.object({
  summary: z.string().describe("High-level overview in 2-3 sentences"),

  functions: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
    parameters: z.array(z.string()),
    complexity: z.enum(["low", "medium", "high"]),
    testCoverage: z.enum(["none", "partial", "complete"])
  })),

  architecture: z.object({
    pattern: z.enum(["mvc", "microservices", "monolith", "serverless", "other"]),
    description: z.string()
  }),

  dependencies: z.array(z.object({
    name: z.string(),
    version: z.string().optional(),
    purpose: z.string()
  })),

  codeQuality: z.object({
    maintainability: z.number().min(1).max(10),
    technicalDebt: z.array(z.string()),
    strengths: z.array(z.string()),
    improvements: z.array(z.string())
  }),

  security: z.object({
    concerns: z.array(z.string()),
    recommendations: z.array(z.string())
  }).optional()
});

// Multi-provider wrapper
class StructuredCodeAnalyzer {
  private clients: Map<string, any> = new Map();

  constructor() {
    // OpenAI
    this.clients.set('openai', Instructor({
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      mode: "TOOLS"
    }));

    // Can add other OpenAI-compatible providers
  }

  async analyze(
    code: string,
    provider: string = 'openai',
    model: string = 'gpt-4o'
  ) {
    const client = this.clients.get(provider);
    if (!client) throw new Error(`Provider ${provider} not configured`);

    const analysis = await client.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are an expert code analyst. Provide comprehensive, accurate analysis."
        },
        {
          role: "user",
          content: `Analyze this code:\n\n\`\`\`\n${code}\n\`\`\``
        }
      ],
      model,
      response_model: {
        schema: CodeAnalysisSchema,
        name: "CodeAnalysis"
      },
      max_retries: 2
    });

    return analysis; // Fully typed!
  }

  // Streaming version
  async analyzeStreaming(code: string) {
    const client = this.clients.get('openai')!;

    const stream = await client.chat.completions.create({
      messages: [
        { role: "user", content: `Analyze: ${code}` }
      ],
      model: "gpt-4o",
      response_model: {
        schema: CodeAnalysisSchema,
        name: "CodeAnalysis"
      },
      stream: true
    });

    for await (const partial of stream) {
      // Partial results as they're generated
      if (partial.summary) {
        console.log("Summary:", partial.summary);
      }
    }
  }
}

// Usage
const analyzer = new StructuredCodeAnalyzer();
const result = await analyzer.analyze(sourceCode);

// TypeScript knows all these fields exist and their types
console.log(result.summary);
console.log(result.codeQuality.maintainability); // number
console.log(result.functions[0].complexity); // "low" | "medium" | "high"
```

### Pros for mdcontext

✅ Best-in-class structured outputs
✅ Excellent TypeScript type inference
✅ Minimal boilerplate
✅ Lightweight and fast
✅ Easy to debug (transparent wrapper)
✅ Zod ecosystem (24M+ downloads)
✅ Perfect for code analysis schemas

### Cons for mdcontext

❌ Provider switching less elegant
❌ Requires OpenAI-compatible APIs
❌ Single-purpose (structured extraction only)
❌ No built-in RAG or agent features

### Recommendation for mdcontext

**Rating: 8.5/10 - EXCELLENT FOR STRUCTURED USE CASES**

**Best for:** Applications where structured, type-safe outputs are critical (like code analysis).

**Use when:** Your primary need is reliable structured data extraction with excellent TypeScript types.

**Skip when:** You need native support for many providers or complex agent orchestration.

---

## 4. LlamaIndex.TS

**GitHub:** [run-llama/LlamaIndexTS](https://github.com/run-llama/LlamaIndexTS)
**NPM:** `llamaindex`
**License:** MIT
**Maintenance:** Active (2026)

### Overview

LlamaIndex.TS is a TypeScript data framework for LLM applications, focusing on RAG (Retrieval-Augmented Generation) and document-centric workflows. It's the TypeScript port of the popular Python LlamaIndex library.

### Provider Support

**Modular Architecture:**
- OpenAI (`@llamaindex/openai`)
- Anthropic (via provider packages)
- Google (via provider packages)
- Azure OpenAI
- Ollama (local models)
- Provider packages installed separately

**Core Focus:** Document ingestion, vector stores, and RAG patterns.

### Key Features

#### RAG Workflows
```typescript
import { VectorStoreIndex, SimpleDirectoryReader } from "llamaindex";

// Load documents
const documents = await new SimpleDirectoryReader().loadData({
  directoryPath: "./codebase"
});

// Create index
const index = await VectorStoreIndex.fromDocuments(documents);

// Query with any LLM
const queryEngine = index.asQueryEngine();
const response = await queryEngine.query(
  "Summarize the authentication implementation"
);
```

#### Multi-Provider LLM Support
```typescript
import { OpenAI } from "@llamaindex/openai";
import { Settings } from "llamaindex";

// Configure global LLM
Settings.llm = new OpenAI({
  model: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY
});

// Use in queries
const response = await queryEngine.query("...");
```

#### Document Agents
```typescript
import { OpenAIAgent } from "llamaindex/agent/openai";
import { QueryEngineTool } from "llamaindex";

const agent = new OpenAIAgent({
  tools: [
    new QueryEngineTool({
      queryEngine: codebaseQueryEngine,
      metadata: {
        name: "codebase_search",
        description: "Search the codebase for relevant code"
      }
    })
  ]
});

const response = await agent.chat({
  message: "Find all authentication-related code and summarize"
});
```

### TypeScript Support

**Quality:** Good
**Type Inference:** Improving
**Focus:** Server-side TypeScript solutions

### API Design & Ergonomics

**Pros:**
- Excellent for RAG use cases
- Document processing out of the box
- Pre-built agent templates
- MCP server integration (2026)

**Cons:**
- More complex than simple LLM clients
- Heavier dependency footprint
- Learning curve for LlamaIndex concepts
- Provider switching less straightforward

### Maintenance Status (2026)

- **GitHub Stars:** ~3,000
- **Forks:** 507
- **NPM Version:** 0.12.0 (updated Dec 2025)
- **Dependent Projects:** 51
- **Recent Updates:** Agent workflows with ACP integration, native MCP search

### Provider-Specific Quirks Handling

Provider-specific handling delegated to provider packages. Less unified than AI SDK.

### Production Readiness

**Strengths:**
- Strong RAG capabilities
- Document agent templates
- Active 2026 development

**Considerations:**
- Smaller community than LangChain
- More experimental features
- Less mature than Python version

### Code Example: Code Summarization

```typescript
import {
  VectorStoreIndex,
  Document,
  OpenAI,
  Settings
} from "llamaindex";

// Configure LLM
Settings.llm = new OpenAI({
  model: "gpt-4o",
  apiKey: process.env.OPENAI_API_KEY
});

// Load codebase files
const codeFiles = [
  new Document({ text: file1Content, id_: "file1.ts" }),
  new Document({ text: file2Content, id_: "file2.ts" })
];

// Create vector index
const index = await VectorStoreIndex.fromDocuments(codeFiles);

// Query
const queryEngine = index.asQueryEngine();
const summary = await queryEngine.query(
  "Provide a comprehensive summary of this codebase's architecture"
);

console.log(summary.response);
```

### Pros for mdcontext

✅ Excellent RAG capabilities
✅ Document processing built-in
✅ Agent templates
✅ MCP integration (2026)

### Cons for mdcontext

❌ Smaller community than alternatives
❌ More complex for simple use cases
❌ Heavier than lightweight clients
❌ Provider support less comprehensive

### Recommendation for mdcontext

**Rating: 6.5/10 - GOOD FOR RAG-FOCUSED USE CASES**

**Best for:** Document-heavy applications requiring semantic search and RAG.

**Use when:** You need to analyze large codebases with vector search capabilities.

**Skip when:** Simple LLM API calls without RAG suffice.

---

## 5. OpenRouter

**Website:** [openrouter.ai](https://openrouter.ai)
**GitHub SDK:** [OpenRouterTeam/typescript-sdk](https://github.com/OpenRouterTeam/typescript-sdk)
**Community Kit:** [openrouter-kit](https://github.com/mmeerrkkaa/openrouter-kit)
**NPM:** `@openrouter/ai-sdk-provider` (for AI SDK integration)
**License:** Varies by SDK

### Overview

OpenRouter is a unified API gateway providing access to 300+ AI models from 60+ providers through a single endpoint. It's not a library but a service - a LiteLLM-like proxy as a hosted solution.

### Provider Support

**300+ Models from 60+ Providers:**
- OpenAI (GPT-4o, GPT-4, GPT-3.5)
- Anthropic (Claude Opus, Sonnet, Haiku)
- Google (Gemini Pro, Flash)
- Meta (Llama models)
- Mistral
- DeepSeek
- Cohere
- Together AI
- Fireworks
- And 50+ more

**Key Advantage:** Change models without changing code or managing multiple API keys.

### Key Features

#### Single API for All Providers
```typescript
import OpenAI from "openai";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://mdcontext.app", // Optional
    "X-Title": "mdcontext" // Optional
  }
});

// Use OpenAI
const response1 = await openrouter.chat.completions.create({
  model: "openai/gpt-4o",
  messages: [{ role: "user", content: "Summarize this code..." }]
});

// Switch to Claude - just change model string
const response2 = await openrouter.chat.completions.create({
  model: "anthropic/claude-opus-4.5",
  messages: [{ role: "user", content: "Summarize this code..." }]
});

// Try DeepSeek
const response3 = await openrouter.chat.completions.create({
  model: "deepseek/deepseek-chat",
  messages: [{ role: "user", content: "Summarize this code..." }]
});
```

#### Streaming
```typescript
const stream = await openrouter.chat.completions.create({
  model: "anthropic/claude-opus-4.5",
  messages: [{ role: "user", content: "Analyze..." }],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
```

#### Integration with Vercel AI SDK
```typescript
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY
});

// Use with AI SDK
const result = await streamText({
  model: openrouter('anthropic/claude-opus-4.5'),
  prompt: 'Summarize this code...'
});
```

#### OpenRouter Kit (Community Library)
```typescript
import { OpenRouterKit } from 'openrouter-kit';

const client = new OpenRouterKit({
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultModel: 'anthropic/claude-opus-4.5'
});

// Easy chat
const response = await client.chat({
  messages: [{ role: 'user', content: 'Analyze this code...' }]
});

// Streaming
const stream = await client.chatStream({
  messages: [{ role: 'user', content: 'Analyze...' }]
});

for await (const chunk of stream) {
  console.log(chunk);
}

// Cost tracking
const cost = client.getTotalCost();
console.log(`Total cost: $${cost}`);
```

#### Automatic Routing & Fallbacks
```typescript
// OpenRouter can automatically route to best provider
const response = await openrouter.chat.completions.create({
  model: "openai/gpt-4o",
  messages: [...],
  route: "fallback" // Automatically try alternatives if primary fails
});
```

#### Response Healing (2026 Feature)
Automatically fixes malformed JSON responses from models.

### TypeScript Support

**Quality:** Excellent - Uses standard OpenAI SDK types
**Type Inference:** Full TypeScript support
**Multiple Options:**
- Official TypeScript SDK
- Use with OpenAI SDK
- Community libraries (openrouter-kit)
- AI SDK provider integration

### API Design & Ergonomics

**Pros:**
- Familiar OpenAI-compatible API
- Single API key for all providers
- Unified billing
- No need to manage multiple provider accounts
- Automatic fallbacks
- Cost tracking built-in
- 300+ model choices

**Cons:**
- Adds latency (proxy layer)
- Requires internet (can't use local-only)
- Costs include small OpenRouter margin
- Service dependency (not self-hosted)

### Maintenance Status (2026)

- **Service Status:** Active production service
- **Recent Updates:** Response Healing (2026), expanding model catalog
- **Sponsorship:** Super Gold sponsor at SaaStr AI 2026
- **Community:** Active development of TypeScript tooling

### Provider-Specific Quirks Handling

**Rate Limiting:**
- OpenRouter handles provider rate limits
- Unified rate limiting across providers
- Automatic fallbacks on rate limit errors

**Authentication:**
- Single API key for all providers
- No need to manage provider-specific keys

**Retries:**
- Automatic routing and fallback support
- Provider-specific error handling abstracted

### Production Readiness

**Strengths:**
- Production service (no self-hosting needed)
- Unified billing simplifies accounting
- Access to latest models immediately
- Cost tracking included
- Automatic failover

**Considerations:**
- Service dependency (not self-hosted)
- Additional latency vs direct API calls
- Small markup on provider costs
- Requires internet connectivity

### Code Example: Code Summarization

```typescript
import OpenAI from "openai";

// OpenRouter as drop-in OpenAI replacement
class CodeSummarizer {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY
    });
  }

  async summarize(
    code: string,
    model: string = "anthropic/claude-opus-4.5"
  ) {
    const response = await this.client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are an expert code analyst."
        },
        {
          role: "user",
          content: `Analyze and summarize:\n\n${code}`
        }
      ],
      temperature: 0.3
    });

    return response.choices[0].message.content;
  }

  // Multi-model comparison
  async compareModels(code: string) {
    const models = [
      "openai/gpt-4o",
      "anthropic/claude-opus-4.5",
      "google/gemini-2.0-flash",
      "deepseek/deepseek-chat"
    ];

    const summaries = await Promise.all(
      models.map(async model => ({
        model,
        summary: await this.summarize(code, model)
      }))
    );

    return summaries;
  }

  // Streaming
  async streamSummary(code: string) {
    const stream = await this.client.chat.completions.create({
      model: "anthropic/claude-opus-4.5",
      messages: [
        { role: "user", content: `Summarize: ${code}` }
      ],
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) process.stdout.write(content);
    }
  }
}

// With AI SDK integration
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY
});

async function smartSummary(code: string) {
  // Try expensive model first, fall back to cheaper if needed
  try {
    return await generateText({
      model: openrouter('anthropic/claude-opus-4.5'),
      prompt: `Detailed analysis: ${code}`,
      maxRetries: 0
    });
  } catch (error) {
    // Fallback to cheaper model
    return await generateText({
      model: openrouter('anthropic/claude-3-5-haiku'),
      prompt: `Quick summary: ${code}`
    });
  }
}
```

### Pros for mdcontext

✅ 300+ models from single API
✅ No provider account management
✅ Unified billing and cost tracking
✅ Automatic fallbacks
✅ OpenAI-compatible (familiar API)
✅ Works with AI SDK and other libraries
✅ Latest models available immediately
✅ Response healing (2026)

### Cons for mdcontext

❌ Service dependency (not self-hosted)
❌ Added latency (proxy layer)
❌ Small cost markup
❌ Requires internet connectivity

### Recommendation for mdcontext

**Rating: 9/10 - EXCELLENT FOR MAXIMUM FLEXIBILITY**

**Best for:** Applications wanting maximum model choice with minimal code complexity.

**Use when:** You want to experiment with many models, don't want to manage provider accounts, or need automatic failover.

**Skip when:** You need lowest possible latency or want self-hosted solution.

---

## 6. Agentica

**GitHub:** [wrtnlabs/agentica](https://github.com/wrtnlabs/agentica)
**NPM:** `@agentica/core`
**License:** MIT
**Maintainer:** Wrtn Technologies

### Overview

Agentica is a TypeScript AI function calling framework enhanced by compiler skills. It focuses on simplicity for agentic AI with automatic schema generation.

### Provider Support

**Core:** OpenAI SDK (npm i openai)
**Compatible Providers:**
- OpenAI
- Anthropic Claude
- DeepSeek
- Meta Llama
- Any provider following OpenAI API design

**Approach:** Uses OpenAI SDK as foundation since most modern LLMs follow OpenAI's API design.

### Key Features

#### Compiler-Driven Schema Generation
```typescript
import { Agentica } from "@agentica/core";

// Automatic function calling schema from TypeScript
interface CodeAnalysis {
  summary: string;
  complexity: "low" | "medium" | "high";
  functions: Array<{
    name: string;
    purpose: string;
  }>;
}

// Schema automatically generated by compiler
const agent = new Agentica({
  model: "gpt-4o",
  functions: {
    analyzeCode: async (code: string): Promise<CodeAnalysis> => {
      // Implementation
    }
  }
});
```

#### JSON Schema Conversion
Automatically handles specification differences between vendors (OpenAI, Claude, DeepSeek, etc.).

### TypeScript Support

**Quality:** Excellent - Compiler-driven
**Type Inference:** Automatic from function signatures
**Dependencies:** Requires `typia` for compile-time type reflection

### API Design & Ergonomics

**Pros:**
- Minimal boilerplate (compiler generates schemas)
- Simple API for function calling
- TypeScript-first design

**Cons:**
- Requires `typia` compiler setup
- Focused on function calling (not general LLM use)
- Smaller community
- Less documentation than major frameworks

### Maintenance Status (2026)

- **Status:** Active development
- **Maintainer:** Wrtn Technologies
- **Community:** Growing but smaller than major alternatives
- **Updates:** Regular maintenance

### Recommendation for mdcontext

**Rating: 6/10 - INTERESTING BUT NICHE**

**Best for:** Function calling-heavy applications with TypeScript.

**Use when:** You need automatic schema generation from TypeScript types.

**Skip when:** You need comprehensive provider support or mature ecosystem.

---

## 7. LiteLLM Proxy (Python Backend)

**GitHub:** [BerriAI/litellm](https://github.com/BerriAI/litellm)
**Approach:** Run Python proxy, access from TypeScript

### Overview

Use Python's LiteLLM as a proxy server, access via OpenAI-compatible TypeScript client. This is the "closest" to original LiteLLM but requires Python infrastructure.

### Architecture

```
TypeScript App → LiteLLM Proxy (Python) → 100+ LLM Providers
```

### Setup

**Install LiteLLM:**
```bash
pip install 'litellm[proxy]'
```

**Start Proxy:**
```bash
litellm --model gpt-4o
# or with config
litellm --config config.yaml
```

**config.yaml:**
```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: ${OPENAI_API_KEY}

  - model_name: claude-opus
    litellm_params:
      model: anthropic/claude-opus-4.5
      api_key: ${ANTHROPIC_API_KEY}

  - model_name: gemini-flash
    litellm_params:
      model: gemini/gemini-2.0-flash
      api_key: ${GOOGLE_API_KEY}
```

### TypeScript Client

```typescript
import OpenAI from "openai";

// Point to LiteLLM proxy
const client = new OpenAI({
  baseURL: "http://localhost:4000", // LiteLLM proxy
  apiKey: "any-string" // Not used by proxy
});

// Use any configured model
const response = await client.chat.completions.create({
  model: "gpt-4o", // From config.yaml
  messages: [{ role: "user", content: "Summarize..." }]
});

// Switch to Claude
const response2 = await client.chat.completions.create({
  model: "claude-opus", // From config.yaml
  messages: [{ role: "user", content: "Summarize..." }]
});
```

### Features

✅ True LiteLLM compatibility (100+ providers)
✅ Cost tracking built-in
✅ Load balancing
✅ Guardrails support
✅ Logging and monitoring
✅ OpenAI-compatible API

❌ Requires Python infrastructure
❌ Additional service to manage
❌ Network hop (latency)
❌ More complex deployment

### Recommendation for mdcontext

**Rating: 7.5/10 - EXCELLENT IF PYTHON IS ACCEPTABLE**

**Best for:** Teams already running Python services or needing true LiteLLM feature parity.

**Use when:** You need LiteLLM's advanced features (cost tracking, load balancing, guardrails) and don't mind Python dependency.

**Skip when:** You want pure TypeScript stack without additional services.

---

## 8. Native Provider SDKs (Direct Approach)

### Overview

Use each provider's official TypeScript SDK directly without abstraction layer.

### Provider SDKs

**OpenAI:**
```typescript
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Summarize..." }]
});
```

**Anthropic:**
```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const response = await anthropic.messages.create({
  model: "claude-opus-4.5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Summarize..." }]
});
```

**Google (Gemini):**
```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
const result = await model.generateContent("Summarize...");
```

**DeepSeek:**
```typescript
import { DeepSeek } from "node-deepseek";

const deepseek = new DeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });
const response = await deepseek.chat.completions.create({
  model: "deepseek-chat",
  messages: [{ role: "user", content: "Summarize..." }]
});
```

**Ollama (Local):**
```typescript
import { Ollama } from "ollama";

const ollama = new Ollama();
const response = await ollama.chat({
  model: "llama3.2",
  messages: [{ role: "user", content: "Summarize..." }]
});
```

### Abstraction Layer

Create your own unified interface:

```typescript
// types.ts
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface LLMProvider {
  generate(messages: LLMMessage[]): Promise<LLMResponse>;
  stream(messages: LLMMessage[]): AsyncGenerator<string>;
}

// providers/openai.ts
import OpenAI from "openai";
import type { LLMProvider, LLMMessage, LLMResponse } from "../types";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = "gpt-4o") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generate(messages: LLMMessage[]): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages
    });

    return {
      content: response.choices[0].message.content || "",
      model: this.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0
      }
    };
  }

  async *stream(messages: LLMMessage[]): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }
}

// providers/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMMessage, LLMResponse } from "../types";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = "claude-opus-4.5") {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generate(messages: LLMMessage[]): Promise<LLMResponse> {
    // Convert messages format
    const anthropicMessages = messages.filter(m => m.role !== "system");
    const systemMessage = messages.find(m => m.role === "system")?.content;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemMessage,
      messages: anthropicMessages
    });

    return {
      content: response.content[0].type === "text"
        ? response.content[0].text
        : "",
      model: this.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens
      }
    };
  }

  async *stream(messages: LLMMessage[]): AsyncGenerator<string> {
    const anthropicMessages = messages.filter(m => m.role !== "system");
    const systemMessage = messages.find(m => m.role === "system")?.content;

    const stream = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemMessage,
      messages: anthropicMessages,
      stream: true
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  }
}

// llm-service.ts
export class LLMService {
  private providers: Map<string, LLMProvider> = new Map();

  constructor() {
    // Initialize providers
    this.providers.set(
      "openai",
      new OpenAIProvider(process.env.OPENAI_API_KEY!)
    );
    this.providers.set(
      "anthropic",
      new AnthropicProvider(process.env.ANTHROPIC_API_KEY!)
    );
  }

  async generate(
    messages: LLMMessage[],
    provider: string = "openai"
  ): Promise<LLMResponse> {
    const llm = this.providers.get(provider);
    if (!llm) throw new Error(`Provider ${provider} not found`);

    return llm.generate(messages);
  }

  async *stream(
    messages: LLMMessage[],
    provider: string = "openai"
  ): AsyncGenerator<string> {
    const llm = this.providers.get(provider);
    if (!llm) throw new Error(`Provider ${provider} not found`);

    yield* llm.stream(messages);
  }
}

// Usage
const llm = new LLMService();

// OpenAI
const result1 = await llm.generate(
  [{ role: "user", content: "Summarize..." }],
  "openai"
);

// Anthropic
const result2 = await llm.generate(
  [{ role: "user", content: "Summarize..." }],
  "anthropic"
);

// Streaming
for await (const chunk of llm.stream(
  [{ role: "user", content: "Analyze..." }],
  "anthropic"
)) {
  process.stdout.write(chunk);
}
```

### Pros

✅ Direct access to provider features
✅ Lowest latency (no abstraction layer)
✅ Official SDKs (best documentation)
✅ Full control over implementation
✅ No third-party dependencies

### Cons

❌ Manual abstraction layer maintenance
❌ Different APIs per provider
❌ More code to write
❌ Must handle provider quirks yourself
❌ No built-in retry/fallback logic

### Recommendation for mdcontext

**Rating: 7/10 - GOOD FOR SPECIFIC NEEDS**

**Best for:** Applications needing direct provider access or provider-specific features.

**Use when:** You want maximum control and minimal dependencies.

**Skip when:** You prefer battle-tested abstractions and faster development.

---

## Comparison Matrix

| Feature | AI SDK | LangChain.js | Instructor-js | LlamaIndex.TS | OpenRouter | Agentica | LiteLLM Proxy | Native SDKs |
|---------|--------|--------------|---------------|---------------|------------|----------|---------------|-------------|
| **Provider Support** | 25+ official, 30+ community | 50+ | OpenAI-compatible | Modular | 300+ | OpenAI-compatible | 100+ | Provider-specific |
| **TypeScript Quality** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Ease of Use** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Streaming** | ✅ Excellent | ✅ Good | ✅ Good | ✅ Good | ✅ Excellent | ❌ Limited | ✅ Good | ✅ Varies |
| **Structured Outputs** | ✅ Zod/Valibot/JSON | ✅ Zod | ⭐ Best (Zod-focused) | ✅ Basic | ✅ Via SDK | ✅ Function calling | ✅ Via providers | ✅ Via providers |
| **Rate Limiting** | Exponential backoff | Per provider | Via OpenAI SDK | Per provider | Handled by service | Basic | ✅ Advanced | Manual |
| **Retries** | Built-in (doesn't respect retry-after) | Configurable | Built-in | Configurable | Automatic fallback | Basic | ✅ Smart | Manual |
| **NPM Downloads** | 20M+/month | Active | Growing | 51 dependents | N/A (service) | Small | N/A (Python) | Varies |
| **GitHub Stars** | 21k+ | 16.8k+ | Growing | 3k+ | N/A | Small | 15k+ (Python) | Official |
| **Bundle Size** | Medium | Large | Small | Large | Tiny (client only) | Small | Tiny (client only) | Varies |
| **Learning Curve** | Low | Medium-High | Low | Medium | Very Low | Medium | Low | Low |
| **RAG Support** | ❌ | ✅ Excellent | ❌ | ⭐ Best | ❌ | ❌ | ❌ | ❌ |
| **Agent Support** | ✅ AI SDK 6 | ✅ LangGraph | ❌ | ✅ Templates | ❌ | ⭐ Focused | ❌ | ❌ |
| **Cost Tracking** | ❌ | Via LangSmith | ❌ | ❌ | ✅ Built-in | ❌ | ⭐ Best | Manual |
| **Maintenance** | ⭐ Very Active | ⭐ Active | Active | Active | ⭐ Active Service | Active | ⭐ Active | Official |
| **Production Ready** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Best For** | General use | Complex workflows | Structured data | RAG applications | Maximum flexibility | Function calling | LiteLLM parity | Full control |

---

## Recommendations for mdcontext

### 🥇 Primary Recommendation: Vercel AI SDK

**Why:**
1. **Industry Standard:** 20M+ monthly downloads, proven at scale
2. **TypeScript Excellence:** Best-in-class TypeScript support with full type inference
3. **Developer Experience:** Intuitive API, minimal boilerplate, excellent docs
4. **Provider Flexibility:** 25+ official providers, easy to switch with one line
5. **Structured Outputs:** First-class Zod integration for code analysis schemas
6. **Streaming:** Excellent streaming support via SSE
7. **Future-Proof:** Active development (AI SDK 6 just released in 2026)
8. **Production Ready:** Battle-tested by major companies

**Implementation:**
```typescript
import { generateObject } from 'ai';
import { z } from 'zod';

const CodeSummarySchema = z.object({
  summary: z.string(),
  functions: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
    complexity: z.enum(['low', 'medium', 'high'])
  })),
  recommendations: z.array(z.string())
});

async function summarizeCode(
  code: string,
  provider: 'openai' | 'anthropic' | 'google' = 'anthropic'
) {
  const modelMap = {
    openai: 'gpt-4o',
    anthropic: 'claude-opus-4.5',
    google: 'gemini-2.0-flash'
  };

  const result = await generateObject({
    model: `${provider}/${modelMap[provider]}`,
    schema: CodeSummarySchema,
    prompt: `Analyze this code:\n\n${code}`,
    maxRetries: 3
  });

  return result.object; // Fully typed!
}
```

**When to Reconsider:**
- If you need provider-specific features not exposed by AI SDK
- If you're already heavily invested in LangChain ecosystem
- If you need self-hosted LiteLLM-specific features

---

### 🥈 Alternative: OpenRouter

**Why:**
1. **Maximum Flexibility:** 300+ models from single API
2. **Simplicity:** OpenAI-compatible, familiar API
3. **No Account Management:** Single API key for all providers
4. **Cost Tracking:** Built-in cost monitoring
5. **Automatic Fallbacks:** Provider failover included
6. **AI SDK Compatible:** Can use with `@openrouter/ai-sdk-provider`

**Implementation:**
```typescript
import OpenAI from "openai";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY
});

// Try multiple models easily
async function summarizeWithBestModel(code: string) {
  const models = [
    "anthropic/claude-opus-4.5",
    "openai/gpt-4o",
    "google/gemini-2.0-flash"
  ];

  for (const model of models) {
    try {
      const response = await openrouter.chat.completions.create({
        model,
        messages: [{ role: "user", content: `Summarize: ${code}` }]
      });
      return response.choices[0].message.content;
    } catch (error) {
      console.log(`${model} failed, trying next...`);
    }
  }
}
```

**When to Reconsider:**
- If latency is critical (adds proxy hop)
- If you need self-hosted solution
- If cost markup is a concern

---

### 🥉 Third Option: Instructor-js (For Structured Output Focus)

**Why:**
1. **Best Structured Outputs:** Purpose-built for reliable extraction
2. **Type Safety:** Excellent Zod integration with full inference
3. **Lightweight:** Minimal dependencies, fast
4. **Transparent:** Easy to debug, simple wrapper
5. **Perfect for Code Analysis:** Ideal for structured code summaries

**Implementation:**
```typescript
import Instructor from "@instructor-ai/instructor";
import OpenAI from "openai";
import { z } from "zod";

const client = Instructor({
  client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  mode: "TOOLS"
});

const DetailedAnalysisSchema = z.object({
  overview: z.string(),
  architecture: z.object({
    pattern: z.enum(['mvc', 'microservices', 'monolith', 'other']),
    description: z.string()
  }),
  functions: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
    complexity: z.enum(['low', 'medium', 'high']),
    testCoverage: z.enum(['none', 'partial', 'complete'])
  })),
  codeQuality: z.object({
    maintainability: z.number().min(1).max(10),
    technicalDebt: z.array(z.string()),
    improvements: z.array(z.string())
  })
});

const analysis = await client.chat.completions.create({
  messages: [{ role: "user", content: `Analyze: ${code}` }],
  model: "gpt-4o",
  response_model: {
    schema: DetailedAnalysisSchema,
    name: "CodeAnalysis"
  },
  max_retries: 2
});

// analysis is fully typed from schema!
console.log(analysis.codeQuality.maintainability); // number
```

**When to Reconsider:**
- If you need native multi-provider support
- If you need RAG or complex agent workflows
- If provider switching is more important than structured outputs

---

### 🔧 Hybrid Approach (Recommended for Maximum Flexibility)

**Combine AI SDK + OpenRouter:**

```typescript
import { generateObject, streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY
});

// Use AI SDK's excellent API with OpenRouter's 300+ models
const CodeSummarySchema = z.object({
  summary: z.string(),
  complexity: z.enum(['low', 'medium', 'high'])
});

async function summarize(code: string, modelId: string) {
  const result = await generateObject({
    model: openrouter(modelId), // Any of 300+ models
    schema: CodeSummarySchema,
    prompt: `Summarize: ${code}`
  });

  return result.object;
}

// Try different models easily
const claude = await summarize(code, 'anthropic/claude-opus-4.5');
const gpt4 = await summarize(code, 'openai/gpt-4o');
const gemini = await summarize(code, 'google/gemini-2.0-flash');
const deepseek = await summarize(code, 'deepseek/deepseek-chat');
```

**Benefits:**
- AI SDK's excellent TypeScript and API design
- OpenRouter's 300+ model catalog
- Best of both worlds

---

## Implementation Roadmap for mdcontext

### Phase 1: Start with AI SDK (Week 1)

**Install:**
```bash
npm install ai @ai-sdk/anthropic @ai-sdk/openai zod
```

**Basic Implementation:**
```typescript
// src/llm/summarizer.ts
import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

export const CodeSummarySchema = z.object({
  summary: z.string(),
  functions: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
    complexity: z.enum(['low', 'medium', 'high'])
  })),
  dependencies: z.array(z.string()),
  recommendations: z.array(z.string())
});

export type CodeSummary = z.infer<typeof CodeSummarySchema>;

export async function summarizeCode(
  code: string,
  options: {
    provider?: 'openai' | 'anthropic';
    model?: string;
  } = {}
): Promise<CodeSummary> {
  const { provider = 'anthropic', model } = options;

  const modelMap = {
    openai: model || 'gpt-4o',
    anthropic: model || 'claude-opus-4.5'
  };

  const result = await generateObject({
    model: `${provider}/${modelMap[provider]}`,
    schema: CodeSummarySchema,
    prompt: `Analyze and summarize this code:\n\n${code}`,
    maxRetries: 3
  });

  return result.object;
}
```

**Test:**
```typescript
const summary = await summarizeCode(sourceCode, {
  provider: 'anthropic'
});

console.log(summary.summary);
console.log(summary.functions[0].complexity); // Type-safe!
```

### Phase 2: Add OpenRouter for Flexibility (Week 2)

**Install:**
```bash
npm install @openrouter/ai-sdk-provider
```

**Enhance:**
```typescript
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY
});

export async function summarizeWithAnyModel(
  code: string,
  modelId: string
): Promise<CodeSummary> {
  const result = await generateObject({
    model: openrouter(modelId),
    schema: CodeSummarySchema,
    prompt: `Analyze: ${code}`,
    maxRetries: 3
  });

  return result.object;
}

// Now support 300+ models
await summarizeWithAnyModel(code, 'deepseek/deepseek-chat');
await summarizeWithAnyModel(code, 'meta/llama-3.2-90b');
```

### Phase 3: Add Streaming for UX (Week 3)

```typescript
import { streamText } from 'ai';

export async function* streamCodeSummary(
  code: string,
  provider: string = 'anthropic'
) {
  const result = await streamText({
    model: `${provider}/claude-opus-4.5`,
    prompt: `Summarize this code:\n\n${code}`
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

// Usage
for await (const chunk of streamCodeSummary(code)) {
  process.stdout.write(chunk);
}
```

### Phase 4: Production Hardening (Week 4)

**Error Handling:**
```typescript
import { APICallError } from 'ai';

export async function robustSummarize(
  code: string,
  options: SummarizeOptions
): Promise<CodeSummary> {
  try {
    return await summarizeCode(code, options);
  } catch (error) {
    if (error instanceof APICallError) {
      // Rate limit - retry with exponential backoff
      if (error.statusCode === 429) {
        const retryAfter = error.responseHeaders?.['retry-after'];
        if (retryAfter) {
          await sleep(parseInt(retryAfter) * 1000);
          return summarizeCode(code, options);
        }
      }

      // Fallback to different provider
      if (options.provider === 'openai') {
        return summarizeCode(code, { ...options, provider: 'anthropic' });
      }
    }

    throw error;
  }
}
```

**Cost Tracking:**
```typescript
export async function summarizeWithCost(
  code: string,
  options: SummarizeOptions
): Promise<{ summary: CodeSummary; cost: number }> {
  const result = await generateObject({
    model: `${options.provider}/${options.model}`,
    schema: CodeSummarySchema,
    prompt: `Analyze: ${code}`
  });

  // Estimate cost based on usage
  const cost = calculateCost(
    result.usage?.promptTokens || 0,
    result.usage?.completionTokens || 0,
    options.model
  );

  return {
    summary: result.object,
    cost
  };
}
```

---

## Key Takeaways

### For mdcontext Code Summarization API:

1. **Start with Vercel AI SDK**
   - Industry-standard TypeScript support
   - Clean API for provider switching
   - Excellent structured output with Zod
   - 20M+ downloads = proven reliability

2. **Add OpenRouter for Experimentation**
   - Test 300+ models with same code
   - No provider account management
   - Easy cost comparison
   - Automatic fallbacks

3. **Consider Instructor-js for Complex Schemas**
   - If code analysis schemas become very complex
   - Best type inference for nested structures
   - Lightweight addition to stack

4. **Avoid Over-Engineering**
   - Don't use LangChain unless you need RAG/complex agents
   - Don't use LlamaIndex unless document processing is core
   - Don't build custom abstraction if AI SDK suffices

5. **Production Checklist**
   - ✅ Structured outputs with Zod schemas
   - ✅ Provider fallbacks for reliability
   - ✅ Streaming for better UX
   - ✅ Error handling for rate limits
   - ✅ Cost tracking per request
   - ✅ TypeScript type safety everywhere

---

## Sources

### Vercel AI SDK
- [AI SDK by Vercel](https://ai-sdk.dev/docs/introduction)
- [AI SDK](https://vercel.com/docs/ai-sdk)
- [AI SDK 6 - Vercel](https://vercel.com/blog/ai-sdk-6)
- [GitHub - vercel/ai](https://github.com/vercel/ai)
- [Foundations: Providers and Models - AI SDK](https://ai-sdk.dev/docs/foundations/providers-and-models)
- [ai - npm](https://www.npmjs.com/package/ai)

### LangChain.js
- [LangChain overview - Docs by LangChain](https://docs.langchain.com/oss/javascript/langchain/overview)
- [GitHub - langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs)
- [langchain - npm](https://www.npmjs.com/package/langchain)
- [LangChain vs Vercel AI SDK: A Developer's Ultimate Guide](https://www.templatehub.dev/blog/langchain-vs-vercel-ai-sdk-a-developers-ultimate-guide-2561)

### Instructor-js
- [Instructor - Multi-Language Library for Structured LLM Outputs](https://python.useinstructor.com/)
- [GitHub - instructor-ai/instructor-js](https://github.com/instructor-ai/instructor-js)
- [Welcome To Instructor - Instructor (JS)](https://js.useinstructor.com/)
- [Why use Instructor? - Instructor (JS)](https://instructor-ai.github.io/instructor-js/why/)

### LlamaIndex.TS
- [GitHub - run-llama/LlamaIndexTS](https://github.com/run-llama/LlamaIndexTS)
- [Welcome to LlamaIndex.TS](https://developers.llamaindex.ai/typescript/framework/)
- [llamaindex - npm](https://www.npmjs.com/package/llamaindex)

### OpenRouter
- [OpenRouter: A Unified Interface for LLMs - KDnuggets](https://www.kdnuggets.com/openrouter-a-unified-interface-for-llms)
- [Call Model Overview (Typescript) | OpenRouter SDK](https://openrouter.ai/docs/sdks/call-model/overview)
- [GitHub - mmeerrkkaa/openrouter-kit](https://github.com/mmeerrkkaa/openrouter-kit)
- [OpenRouter](https://openrouter.ai)
- [Streaming | OpenRouter SDK](https://openrouter.ai/docs/sdks/typescript/call-model/streaming)

### Agentica
- [GitHub - wrtnlabs/agentica](https://github.com/wrtnlabs/agentica)
- [@agentica/core - npm](https://www.npmjs.com/package/@agentica/core)
- [Agentica > Guide Documents > Core Library > LLM Vendors](https://wrtnlabs.io/agentica/docs/core/vendor/)

### LiteLLM
- [LiteLLM Proxy (LLM Gateway)](https://docs.litellm.ai/docs/providers/litellm_proxy)
- [GitHub - BerriAI/litellm](https://github.com/BerriAI/litellm)
- [Cookbook - LiteLLM (Proxy) + Langfuse OpenAI Integration (JS/TS)](https://langfuse.com/guides/cookbook/js_integration_litellm_proxy)

### Provider-Specific
- [GitHub - m-alhoomaidi/node-deepseek](https://github.com/m-alhoomaidi/node-deepseek)
- [Simple Agent Function-Calling with DeepSeek-V3 in TypeScript](https://medium.com/@wickerwobber/simple-agent-function-calling-with-deepseek-v3-in-typescript-38a5914c3cf3)
- [GitHub - ollama/ollama-js](https://github.com/ollama/ollama-js)
- [Using Ollama with TypeScript: A Simple Guide](https://medium.com/@jonigl/using-ollama-with-typescript-a-simple-guide-20f5e8d3827c)

### Comparisons & Analysis
- [AI Framework Comparison: AI SDK, Genkit and Langchain](https://komelin.com/blog/ai-framework-comparison)
- [14 AI Agent Frameworks Compared](https://softcery.com/lab/top-14-ai-agent-frameworks-of-2025-a-founders-guide-to-building-smarter-systems)
- [The Top 15 LangChain Alternatives in 2026](https://www.vellum.ai/blog/top-langchain-alternatives)
- [Comparing AI SDKs for React: Vercel, LangChain, Hugging Face](https://dev.to/brayancodes/comparing-ai-sdks-for-react-vercel-langchain-hugging-face-5g66)

---

**Document Status:** Complete
**Last Updated:** January 26, 2026
**Maintainer:** mdcontext research team
**Next Review:** When considering new LLM integrations or major version updates
