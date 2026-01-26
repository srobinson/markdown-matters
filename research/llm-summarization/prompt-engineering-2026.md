# Prompt Engineering for Code Summarization: 2026 Best Practices

**Research Date:** January 26, 2026
**Purpose:** Comprehensive guide to prompt engineering best practices for code summarization and analysis, specifically tailored for mdcontext.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Effective Prompt Structures](#effective-prompt-structures)
3. [Few-Shot vs Zero-Shot Approaches](#few-shot-vs-zero-shot-approaches)
4. [Code Snippet Formatting](#code-snippet-formatting)
5. [Token Optimization Strategies](#token-optimization-strategies)
6. [Structured Output Formats](#structured-output-formats)
7. [Common Pitfalls and Solutions](#common-pitfalls-and-solutions)
8. [Prompt Templates for Code Summarization](#prompt-templates-for-code-summarization)
9. [References](#references)

---

## Executive Summary

Modern LLMs in 2026 excel at code summarization when provided with well-structured prompts that:

- **Separate concerns** - Distinct sections for instructions, context, task, and output format
- **Use explicit constraints** - Specify exact requirements rather than vague requests
- **Leverage examples strategically** - Few-shot for specialized tasks, zero-shot for common operations
- **Optimize token usage** - Remove unnecessary formatting while maintaining code clarity
- **Request structured outputs** - JSON or Markdown for consistent, parsable results

Key insight: **One good example beats five adjectives** when reliability is critical.

---

## Effective Prompt Structures

### 1. Core Structural Pattern (2026 Standard)

Modern prompts should follow a clear separation of concerns:

```markdown
## Instructions
[Clear, concise task definition with explicit constraints]

## Context
[Relevant background information, codebase conventions, domain knowledge]

## Task
[Specific action to perform]

## Output Format
[Exact structure expected - JSON schema, Markdown template, etc.]
```

**Why this works:** Claude and other frontier models excel at following structured instructions. Mixing context and instructions in one paragraph reduces reliability.

### 2. Constraint Specification

**❌ Vague approach:**
```
Summarize this code briefly.
```

**✅ Explicit constraints:**
```
Summarize this code in exactly 3 sentences:
- Sentence 1 (max 20 words): Primary purpose
- Sentence 2 (max 20 words): Key inputs and outputs
- Sentence 3 (max 20 words): Important side effects or dependencies
```

### 3. Prompt Template for Code Summarization

```markdown
## Instructions
Analyze the following code and provide a comprehensive summary following the exact structure specified in the Output Format section.

## Context
- Programming language: {LANGUAGE}
- Project context: {PROJECT_TYPE}
- Code location: {FILE_PATH}
- Related modules: {DEPENDENCIES}

## Task
Generate a multi-level summary that captures:
1. High-level purpose (what the code does and why)
2. Key technical details (algorithms, patterns, critical logic)
3. Dependencies and integration points
4. Notable edge cases or constraints

## Code
```{LANGUAGE}
{CODE_SNIPPET}
```

## Output Format
Return a JSON object with this exact structure:
```json
{
  "summary": "One-line description (max 100 chars)",
  "purpose": "Detailed explanation of what this code accomplishes",
  "technical_approach": "Key algorithms, patterns, or techniques used",
  "inputs": ["List of primary inputs or parameters"],
  "outputs": ["List of outputs or return values"],
  "dependencies": ["External libraries, modules, or services"],
  "side_effects": ["Any state changes, I/O operations, or side effects"],
  "edge_cases": ["Notable edge cases or error handling"],
  "complexity": "Brief complexity analysis (time/space)"
}
```
```

---

## Few-Shot vs Zero-Shot Approaches

### Decision Framework

| Factor | Zero-Shot | Few-Shot |
|--------|-----------|----------|
| **Task Complexity** | Simple, well-understood tasks | Specialized, domain-specific tasks |
| **Output Format** | Standard formats (plain text, basic JSON) | Custom structures, specific styling |
| **Model Type** | Instruction-tuned models (GPT-4, Claude 3.5+) | General-purpose or smaller models |
| **Token Budget** | Limited (examples consume tokens) | Sufficient for 2-5 examples |
| **Consistency Needs** | Moderate | High - examples establish clear patterns |

### Zero-Shot: When to Use

**Best for:**
- Text summarization with standard formats
- Code tasks abundant in training data (e.g., "explain this Python function")
- Working with fine-tuned instruction-following models
- Token-constrained environments

**Example - Zero-Shot Code Summary:**
```markdown
Analyze this TypeScript function and explain:
1. What it does
2. Key inputs and outputs
3. Any important edge cases

```typescript
export function parseConfig(filePath: string): Config | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to parse config: ${error}`);
    return null;
  }
}
```

Output as a concise paragraph.
```

### Few-Shot: When to Use

**Best for:**
- Domain-specific code patterns (e.g., blockchain, quantum computing)
- Custom output formats that are hard to describe
- Establishing consistent style across summaries
- Teaching new concepts not well-represented in training data

**Example - Few-Shot Code Summary:**
```markdown
Analyze the following function and provide a summary using the exact style shown in these examples:

## Example 1:

**Code:**
```python
def validate_email(email: str) -> bool:
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))
```

**Summary:**
Purpose: Email format validation using regex
Pattern: Pure function - deterministic validation
Input: String (email address)
Output: Boolean (valid/invalid)
Complexity: O(n) where n = email length
Edge Cases: Doesn't verify email existence, only format

## Example 2:

**Code:**
```python
async def fetch_user_data(user_id: int) -> dict:
    async with aiohttp.ClientSession() as session:
        response = await session.get(f'/api/users/{user_id}')
        return await response.json()
```

**Summary:**
Purpose: Async HTTP fetch for user data
Pattern: Async I/O with context management
Input: Integer (user_id)
Output: Dictionary (user data from API)
Complexity: O(1) computation, I/O-bound
Edge Cases: No error handling for failed requests or invalid JSON

## Now analyze this code:

**Code:**
```typescript
export async function processQueue<T>(
  queue: Queue<T>,
  handler: (item: T) => Promise<void>,
  concurrency: number = 5
): Promise<void> {
  const workers = Array(concurrency).fill(null).map(async () => {
    while (true) {
      const item = await queue.dequeue();
      if (!item) break;
      await handler(item);
    }
  });
  await Promise.all(workers);
}
```

**Summary:**
[Model generates summary following established pattern]
```

**Performance Note:** Few-shot prompting offers **better performance than zero-shot** by providing targeted guidance through labeled examples, resulting in more accurate and relevant responses.

---

## Code Snippet Formatting

### Key Research Findings (2026)

1. **Format Removal Reduces Tokens by 24.5%** on average with negligible impact on LLM performance
2. **Labeled Code Blocks Improve Understanding** - Models recognize code vs. context more accurately
3. **Strategic Formatting** - Use minimal formatting for token efficiency while maintaining clarity

### Formatting Best Practices

#### ✅ Recommended: Clearly Labeled Code Blocks

```markdown
## Context
Analyzing a Python data processing pipeline

## Code to Analyze
```python
def transform_data(raw_data):
    cleaned = remove_nulls(raw_data)
    normalized = normalize_values(cleaned)
    return aggregate_results(normalized)
```

## Task
Summarize the data transformation pipeline
```

**Why this works:**
- Clear boundaries between code and instructions
- Model understands code context immediately
- Maintains readability for human review

#### ⚠️ Token-Optimized: Minimal Formatting (When Needed)

For large codebases where token limits are critical:

```markdown
Summarize this function:

def transform_data(raw_data):
cleaned=remove_nulls(raw_data)
normalized=normalize_values(cleaned)
return aggregate_results(normalized)

Focus on: purpose, data flow, dependencies
```

**Trade-offs:**
- Saves ~25% tokens
- Slightly reduced readability
- LLM performance maintained according to 2026 research
- Use when processing many files or hitting context limits

#### ❌ Avoid: Mixing Code Without Delimiters

```markdown
Look at this code def transform_data(raw_data): cleaned = remove_nulls(raw_data) and tell me what it does
```

**Problems:**
- Model may confuse code with instructions
- Harder to parse code structure
- Reduced accuracy in analysis

### Structural Summarization for Large Codebases

For token-constrained scenarios, use tools like tree-sitter to create structural summaries:

```markdown
## File: /src/data/pipeline.py
Functions:
- transform_data(raw_data) -> processed_data
- remove_nulls(data) -> cleaned_data
- normalize_values(data) -> normalized_data
- aggregate_results(data) -> summary

Dependencies:
- pandas
- numpy
- custom.validators

Purpose: ETL pipeline for sensor data processing
```

**Benefit:** Drastically reduces tokens while preserving high-level architecture for summarization.

---

## Token Optimization Strategies

### 1. Batching Inputs (30% Token Savings)

**❌ Inefficient: Repeated Instructions**
```markdown
Summarize this function's purpose:
[Function 1]

Summarize this function's purpose:
[Function 2]

Summarize this function's purpose:
[Function 3]
```

**✅ Efficient: Batched Processing**
```markdown
Analyze each of the following functions and provide:
- Purpose (one sentence)
- Key inputs/outputs
- Complexity

Format: JSON array with one object per function

## Function 1
[Code]

## Function 2
[Code]

## Function 3
[Code]
```

**Savings:** Instructions specified once, not repeated for each input.

### 2. Prompt Compression Techniques

**LLMLingua (Microsoft)**
- Prunes unnecessary tokens from prompts
- Maintains semantic meaning
- Useful for very long context windows

**Tree-Sitter Parsing**
- Converts code to structural AST
- Preserves architecture while reducing tokens
- Ideal for codebase-wide summarization

### 3. Format Optimization by Task

| Task Type | Recommended Format | Token Efficiency |
|-----------|-------------------|------------------|
| Single file summary | Full formatted code | Clarity > tokens |
| Multi-file analysis | Minimal formatting | Tokens > minor clarity loss |
| Codebase overview | Structural summary (AST) | Maximum token savings |
| Detailed review | Full formatted with context | Clarity > tokens |

### 4. Practical Implementation for mdcontext

```typescript
// Adaptive formatting based on file size
function formatCodeForSummarization(code: string, fileSize: number): string {
  if (fileSize < 1000) {
    // Small files: preserve formatting
    return `\`\`\`${language}\n${code}\n\`\`\``;
  } else if (fileSize < 5000) {
    // Medium files: minimal formatting
    return code.replace(/\s+/g, ' ').trim();
  } else {
    // Large files: structural summary
    return generateASTSummary(code);
  }
}
```

---

## Structured Output Formats

### Why Structured Outputs Matter

1. **Consistency** - Same format every time, easier to parse programmatically
2. **Validation** - Can verify output matches expected schema
3. **Integration** - Direct use in downstream systems without parsing
4. **Clarity** - LLMs understand structure better than freeform requests

### JSON vs Markdown: When to Use Each

| Format | Best For | Example Use Cases |
|--------|----------|-------------------|
| **JSON** | Machine parsing, APIs, databases | Code metrics, dependency graphs, test results |
| **Markdown** | Human reading, documentation, RAG | Code explanations, architecture docs, summaries |

**Key Insight (2026):** JSON is the gold standard for explicit key-value structure that LLMs parse reliably, while Markdown excels for text-heavy applications like summarization.

### JSON Output Template

```markdown
## Instructions
Analyze the provided code and return a JSON object matching the schema below.

## Output Schema
```json
{
  "file_path": "string",
  "language": "string",
  "summary": {
    "one_line": "string (max 100 chars)",
    "detailed": "string (2-3 sentences)"
  },
  "functions": [
    {
      "name": "string",
      "purpose": "string",
      "parameters": ["string"],
      "returns": "string",
      "complexity": "string"
    }
  ],
  "dependencies": {
    "external": ["string"],
    "internal": ["string"]
  },
  "metadata": {
    "lines_of_code": "number",
    "estimated_complexity": "low|medium|high",
    "test_coverage_needed": "boolean"
  }
}
```

## Code to Analyze
```{language}
{code}
```

## Requirements
- Return ONLY valid JSON, no additional text
- Ensure all required fields are present
- Use null for unknown values, not empty strings
```

### Markdown Output Template

```markdown
## Instructions
Analyze the provided code and create a comprehensive Markdown summary.

## Output Format
Use this exact structure:

```markdown
# {File Name}

## Overview
[2-3 sentence description of the file's purpose and role in the project]

## Key Components

### Functions
- **{function_name}**: {one-line description}
  - Inputs: {parameters}
  - Outputs: {return type}
  - Complexity: {time/space complexity}

### Classes
- **{class_name}**: {one-line description}
  - Responsibilities: {key responsibilities}
  - Dependencies: {what it depends on}

## Dependencies
- External: {list}
- Internal: {list}

## Architecture Notes
{How this fits into the larger system}

## Potential Issues
{Any code smells, technical debt, or areas for improvement}
```

## Code to Analyze
[code here]
```

### Hybrid Approach: Structured Markdown

Combining benefits of both formats:

```markdown
---
file: /src/auth/validator.ts
language: typescript
complexity: medium
dependencies: [bcrypt, jsonwebtoken]
---

# Authentication Validator

## Purpose
Validates user credentials and generates JWT tokens for authenticated sessions.

## Implementation Details

**validateCredentials()**
- Input: `{ username: string, password: string }`
- Output: `Promise<User | null>`
- Complexity: O(1) - single DB lookup + hash comparison
- Side Effects: Logs failed attempts to security log

**generateToken()**
- Input: `User` object
- Output: `string` (JWT token)
- Complexity: O(1)
- Side Effects: None (pure function)

## Security Considerations
- Uses bcrypt with cost factor 12 for password hashing
- JWT tokens expire after 24 hours
- No rate limiting implemented ⚠️ (potential vulnerability)
```

### Enforcing Structured Outputs

**Schema Specification:**
```markdown
Return JSON matching this Pydantic schema:

```python
class FunctionSummary(BaseModel):
    name: str
    purpose: str = Field(max_length=200)
    parameters: List[str]
    returns: Optional[str]
    complexity: Literal["O(1)", "O(n)", "O(n log n)", "O(n²)", "unknown"]

class CodeSummary(BaseModel):
    file_path: str
    language: str
    functions: List[FunctionSummary]
    total_lines: int
```
```

**Grammar Enforcement:**
Most frontier models in 2026 support JSON mode for guaranteed valid JSON output.

---

## Common Pitfalls and Solutions

### 1. Vague Prompts

**❌ Problem:**
```markdown
Improve this code.
```

**Why it fails:** LLM doesn't know if you want performance optimization, readability, bug fixes, new features, or all of the above.

**✅ Solution:**
```markdown
Analyze this code for performance bottlenecks:
1. Identify functions with O(n²) or worse complexity
2. Suggest specific optimizations for each bottleneck
3. Estimate performance improvement for each suggestion

Code:
[code here]
```

### 2. Vague References in Conversations

**❌ Problem:**
```markdown
User: [Pastes 500 lines of code]
User: [Asks a question about function A]
User: [Asks a question about function B]
User: Refactor the above function
```

**Why it fails:** "Above function" is ambiguous - which one? LLMs may lose track in long conversations.

**✅ Solution:**
```markdown
Refactor the `processUserData` function (lines 45-67) to improve error handling.
```

### 3. Prompt Length Issues

**Research Finding (2026):** Prompts under 50 words have **higher success rates** than longer prompts.

**❌ Problem:**
```markdown
I need you to analyze this complex codebase and think about all the different architectural patterns we could use and consider the trade-offs between microservices and monolithic approaches and also think about how we might scale this in the future and what database we should use and whether we should use REST or GraphQL and also...
[continues for 300 words]
```

**✅ Solution: Prompt Chaining**
```markdown
Step 1: What is the current architecture pattern used in this codebase?
[Get response]

Step 2: What are the main scalability bottlenecks?
[Get response]

Step 3: Suggest 2-3 specific architectural improvements addressing those bottlenecks.
[Get response]
```

**Benefits:**
- Each prompt is focused and concise
- Higher accuracy per step
- Can course-correct between steps
- Better for complex, multi-faceted analysis

### 4. Semantic Errors and Hallucinations

**❌ Problem:** LLMs may generate plausible-looking code with logical errors (missing conditions, incorrect logic) or small inaccuracies (missing minus sign).

**✅ Solutions:**

**a) Explicit Constraint Checking**
```markdown
Analyze this sorting function and verify:
1. Does it handle empty arrays correctly?
2. Does it handle single-element arrays correctly?
3. Does it maintain stability (equal elements preserve order)?
4. What is its worst-case time complexity?

Flag any edge cases where it might fail.
```

**b) Human-in-the-Loop for Critical Code**
```markdown
Important: This code is used in a safety-critical medical device system.

Review this function for:
- Potential null pointer exceptions
- Integer overflow vulnerabilities
- Race conditions in concurrent access
- Edge cases that could cause incorrect dosage calculations

Mark each issue as: CRITICAL, HIGH, MEDIUM, or LOW severity.
```

### 5. Underspecification (Major 2026 Research Finding)

**Research Finding:** Underspecified prompts are **2x more likely to regress** over model or prompt changes, with accuracy drops of **>20%**.

**❌ Problem:**
```markdown
Summarize this code.
```

**Underspecified aspects:**
- How long should the summary be?
- What aspects to focus on (purpose, implementation, performance)?
- What format (prose, bullet points, JSON)?
- What audience (developers, managers, documentation)?

**✅ Solution: Comprehensive Specification**
```markdown
## Task
Create a technical summary for a senior developer code review.

## Requirements
- Length: 3-5 bullet points
- Focus: Code correctness, performance, maintainability
- Flag: Any potential bugs or security issues
- Format: Markdown with code references

## Code
[code here]

## Output Template
- **Purpose**: [what this code does]
- **Implementation**: [key technical approach]
- **Performance**: [time/space complexity]
- **Issues**: [any concerns or improvements needed]
- **Dependencies**: [external libraries or modules]
```

### 6. Insufficient Context

**❌ Problem:**
```markdown
Why is this function slow?

```python
def process_data(data):
    result = []
    for item in data:
        result.append(transform(item))
    return result
```
```

**Missing context:**
- What is `transform()`? Is it I/O-bound, CPU-bound?
- How large is `data`? 10 items or 10 million?
- What are the performance requirements?

**✅ Solution:**
```markdown
## Context
- Function: process_data() in data_pipeline.py
- Typical input size: 100,000 - 1,000,000 items
- Current performance: ~30 seconds for 500k items
- Performance requirement: <5 seconds for 500k items
- transform() is a pure CPU-bound function (regex parsing)

## Code
```python
def process_data(data):
    result = []
    for item in data:
        result.append(transform(item))
    return result
```

## Task
Identify why this is slow and suggest specific optimizations.
```

### 7. Incorrect Output Format Handling

**❌ Problem:**
```markdown
Return JSON with the code summary.

[LLM returns:]
Here's the JSON summary:
```json
{
  "summary": "..."
}
```
I hope this helps!
```

**Why it fails:** Extra text makes it harder to parse programmatically.

**✅ Solution:**
```markdown
Return ONLY a valid JSON object, with no additional text before or after.
Do not include markdown code fences.
Do not include explanatory text.

Schema:
{
  "summary": "string",
  "complexity": "string"
}
```

---

## Prompt Templates for Code Summarization

### Template 1: Single File Summary (Comprehensive)

```markdown
## Task
Analyze the following code file and provide a comprehensive technical summary.

## Context
- File path: {FILE_PATH}
- Programming language: {LANGUAGE}
- Project: {PROJECT_NAME}
- Role in project: {FILE_ROLE}

## Code
```{LANGUAGE}
{CODE_CONTENT}
```

## Output Format
Return a JSON object with this structure:

```json
{
  "summary": {
    "one_line": "Brief description (max 100 chars)",
    "detailed": "2-3 sentence explanation of purpose and approach"
  },
  "components": {
    "functions": [
      {
        "name": "function_name",
        "purpose": "What it does",
        "signature": "function signature",
        "complexity": "Time/space complexity"
      }
    ],
    "classes": [
      {
        "name": "ClassName",
        "purpose": "What it represents",
        "key_methods": ["method1", "method2"],
        "design_pattern": "Pattern used (if applicable)"
      }
    ],
    "constants": [
      {
        "name": "CONSTANT_NAME",
        "purpose": "Why it exists"
      }
    ]
  },
  "dependencies": {
    "external_libraries": ["lib1", "lib2"],
    "internal_modules": ["module1", "module2"],
    "coupling_level": "low|medium|high"
  },
  "quality_metrics": {
    "lines_of_code": 0,
    "cyclomatic_complexity": "low|medium|high",
    "test_coverage_needed": true,
    "code_smells": ["Issue 1", "Issue 2"]
  },
  "architecture_notes": "How this fits into the larger system"
}
```

## Requirements
- Be precise and technical
- Flag any potential issues or improvements
- Focus on code correctness and maintainability
- Return ONLY valid JSON
```

### Template 2: Quick Function Summary (Zero-Shot)

```markdown
Analyze this {LANGUAGE} function and provide:
1. Purpose (one sentence)
2. Key inputs and outputs
3. Time/space complexity
4. Any edge cases or potential issues

```{LANGUAGE}
{FUNCTION_CODE}
```

Format as a concise paragraph (max 100 words).
```

### Template 3: Multi-File Batch Summary

```markdown
## Task
Analyze each of the following code files and provide a standardized summary for each.

## Output Format
Return a JSON array where each element represents one file:

```json
[
  {
    "file_path": "string",
    "language": "string",
    "primary_purpose": "string (max 200 chars)",
    "key_exports": ["function/class names"],
    "dependencies": ["list of imports"],
    "complexity_score": 1-10,
    "suggested_improvements": ["improvement 1", "improvement 2"]
  }
]
```

## Files to Analyze

### File 1: {PATH_1}
```{LANGUAGE_1}
{CODE_1}
```

### File 2: {PATH_2}
```{LANGUAGE_2}
{CODE_2}
```

### File 3: {PATH_3}
```{LANGUAGE_3}
{CODE_3}
```

## Requirements
- Process each file independently
- Be consistent in evaluation criteria
- Return ONLY the JSON array
```

### Template 4: Architecture-Focused Summary (Few-Shot)

```markdown
## Task
Analyze the code and summarize its architectural role using the pattern shown in the examples.

## Example 1

**Code:**
```typescript
export class UserRepository {
  constructor(private db: Database) {}

  async findById(id: string): Promise<User | null> {
    return this.db.query('SELECT * FROM users WHERE id = ?', [id]);
  }
}
```

**Summary:**
- **Pattern**: Repository Pattern
- **Layer**: Data Access Layer
- **Responsibility**: Abstracts database operations for User entities
- **Dependencies**: Database connection interface
- **Testing**: Easily mockable via dependency injection
- **Scalability**: Can swap database implementation without changing business logic

## Example 2

**Code:**
```python
class EmailNotificationService:
    def __init__(self, email_client):
        self.client = email_client

    def send_welcome_email(self, user):
        template = self.load_template('welcome')
        self.client.send(user.email, template.render(user))
```

**Summary:**
- **Pattern**: Service Layer
- **Layer**: Application/Business Layer
- **Responsibility**: Orchestrates email sending with templating
- **Dependencies**: Email client abstraction, template engine
- **Testing**: Mock email client for unit tests
- **Scalability**: Can add queue for async sending without changing interface

## Now analyze this code

**Code:**
```{LANGUAGE}
{CODE}
```

**Summary:**
```

### Template 5: Security-Focused Code Review

```markdown
## Task
Perform a security-focused analysis of this code.

## Context
- Language: {LANGUAGE}
- Environment: {PRODUCTION/STAGING/DEV}
- Handles sensitive data: {YES/NO}
- Authentication/Authorization: {DESCRIPTION}

## Code
```{LANGUAGE}
{CODE}
```

## Analysis Requirements

Evaluate for:

1. **Input Validation**
   - Are all inputs validated?
   - Is sanitization performed correctly?
   - SQL injection risks?
   - XSS vulnerabilities?

2. **Authentication & Authorization**
   - Proper auth checks?
   - Role-based access control?
   - Token handling security?

3. **Data Protection**
   - Sensitive data encrypted?
   - Secrets hardcoded?
   - Logging sensitive info?

4. **Error Handling**
   - Information leakage in errors?
   - Proper exception handling?
   - Stack traces exposed?

5. **Dependencies**
   - Known vulnerabilities in libs?
   - Outdated packages?

## Output Format

```json
{
  "overall_risk": "low|medium|high|critical",
  "vulnerabilities": [
    {
      "type": "SQL Injection|XSS|Auth Bypass|etc",
      "severity": "low|medium|high|critical",
      "location": "line number or function name",
      "description": "What the vulnerability is",
      "exploit_scenario": "How it could be exploited",
      "remediation": "How to fix it"
    }
  ],
  "best_practices_violated": ["Practice 1", "Practice 2"],
  "recommendations": ["Recommendation 1", "Recommendation 2"],
  "safe_for_production": true|false
}
```
```

### Template 6: Performance Optimization Analysis

```markdown
## Task
Analyze this code for performance optimization opportunities.

## Context
- Current performance: {METRICS}
- Performance goal: {TARGET}
- Typical input size: {SIZE}
- Environment: {PROD_SPECS}

## Code
```{LANGUAGE}
{CODE}
```

## Analysis Focus

1. **Algorithmic Complexity**
   - Current time complexity
   - Current space complexity
   - Potential optimizations

2. **Resource Usage**
   - Memory allocations
   - I/O operations
   - Network calls
   - Database queries

3. **Concurrency**
   - Parallelization opportunities
   - Race conditions
   - Lock contention

## Output Format

```markdown
# Performance Analysis: {FUNCTION/FILE_NAME}

## Current Complexity
- Time: O(?)
- Space: O(?)

## Bottlenecks Identified

### Bottleneck 1: {NAME}
- **Location**: Line X-Y or function name
- **Issue**: [Description of the bottleneck]
- **Impact**: [How much it slows things down]
- **Optimization**: [Specific suggestion]
- **Expected Improvement**: [Estimated speedup]

### Bottleneck 2: {NAME}
[Same structure]

## Quick Wins
1. [Easy optimization with good ROI]
2. [Easy optimization with good ROI]

## Long-term Improvements
1. [More complex optimization for significant gains]
2. [Architectural changes needed]

## Estimated Overall Improvement
[X%] faster with quick wins, [Y%] with all optimizations
```
```

### Template 7: Dependency Analysis

```markdown
## Task
Map all dependencies for this code file and analyze coupling.

## Code
```{LANGUAGE}
{CODE}
```

## Output Format

```json
{
  "file_path": "string",
  "dependencies": {
    "external": [
      {
        "package": "package-name",
        "version": "^1.2.3",
        "imports": ["specific", "imports"],
        "purpose": "Why this dependency is used",
        "alternatives": ["alternative-package"]
      }
    ],
    "internal": [
      {
        "module_path": "./relative/path",
        "imports": ["imports"],
        "coupling_type": "tight|loose",
        "circular_dependency": true|false
      }
    ]
  },
  "coupling_analysis": {
    "level": "low|medium|high",
    "issues": ["Circular dependency between X and Y"],
    "suggestions": ["Break circular dep by introducing interface"]
  },
  "dependency_graph": {
    "direct_dependencies": 5,
    "transitive_dependencies": 23,
    "depth": 4
  },
  "risks": [
    {
      "type": "outdated|security|unmaintained",
      "package": "package-name",
      "description": "Risk description"
    }
  ]
}
```
```

### Template 8: Test Coverage Planning

```markdown
## Task
Analyze this code and create a test coverage plan.

## Code
```{LANGUAGE}
{CODE}
```

## Analysis Requirements

1. Identify all testable units (functions, methods, classes)
2. Determine test cases needed for each unit
3. Identify edge cases and error scenarios
4. Suggest test doubles (mocks, stubs) needed
5. Estimate test coverage complexity

## Output Format

```markdown
# Test Coverage Plan: {FILE_NAME}

## Test Units

### Unit 1: `{function/class_name}`

**Test Cases:**
1. **Happy Path**: [Description]
   - Input: [Example input]
   - Expected Output: [Expected result]

2. **Edge Case**: [Description]
   - Input: [Example input]
   - Expected Output: [Expected result]

3. **Error Case**: [Description]
   - Input: [Example input]
   - Expected Behavior: [Exception thrown, error returned, etc.]

**Test Doubles Needed:**
- Mock: {dependency_name} - [Why]
- Stub: {dependency_name} - [Why]

**Complexity**: Low|Medium|High

---

### Unit 2: `{function/class_name}`
[Same structure]

---

## Overall Test Strategy

**Total Test Cases**: {NUMBER}
**Estimated Coverage**: {PERCENTAGE}%
**Priority Order**: [Which units to test first and why]
**Integration Tests Needed**: [Cross-unit testing scenarios]

## Testing Challenges

1. [Challenge 1 and mitigation strategy]
2. [Challenge 2 and mitigation strategy]
```
```

---

## Implementation Guidelines for mdcontext

### 1. Adaptive Prompting Strategy

```typescript
interface PromptConfig {
  fileSize: number;
  complexity: 'low' | 'medium' | 'high';
  purpose: 'overview' | 'detailed' | 'security' | 'performance';
}

function selectPromptTemplate(config: PromptConfig): string {
  // Small files: comprehensive analysis
  if (config.fileSize < 1000) {
    return config.purpose === 'overview'
      ? TEMPLATE_QUICK_SUMMARY
      : TEMPLATE_COMPREHENSIVE;
  }

  // Large files: focus on structure
  if (config.fileSize > 5000) {
    return TEMPLATE_STRUCTURAL_SUMMARY;
  }

  // Medium files: balanced approach
  return TEMPLATE_STANDARD;
}
```

### 2. Token Budget Management

```typescript
const TOKEN_LIMITS = {
  SINGLE_FILE: 4000,
  BATCH_PROCESSING: 8000,
  CODEBASE_OVERVIEW: 16000,
};

function optimizeForTokens(code: string, limit: number): string {
  const estimatedTokens = code.length / 4; // Rough estimate

  if (estimatedTokens > limit * 0.8) {
    // Use structural summary
    return generateStructuralSummary(code);
  }

  return code; // Full code fits comfortably
}
```

### 3. Output Validation

```typescript
function validateSummaryOutput(output: string, expectedFormat: 'json' | 'markdown'): boolean {
  if (expectedFormat === 'json') {
    try {
      const parsed = JSON.parse(output);
      return validateSchema(parsed, EXPECTED_SCHEMA);
    } catch {
      return false;
    }
  }

  // Validate markdown structure
  return output.includes('##') && output.length > 50;
}
```

### 4. Caching Strategy

```typescript
// Cache summaries with prompt version for invalidation
interface CachedSummary {
  summary: string;
  promptVersion: string;
  timestamp: number;
  fileHash: string;
}

// Invalidate if prompt or file changes
function getCachedOrGenerate(
  file: CodeFile,
  promptVersion: string
): Promise<string> {
  const cached = cache.get(file.path);

  if (cached?.promptVersion === promptVersion &&
      cached?.fileHash === file.hash) {
    return cached.summary;
  }

  return generateSummary(file, promptVersion);
}
```

---

## References

### Research Papers & Technical Articles

1. [The Hidden Cost of Readability: How Code Formatting Silently Consumes Your LLM Budget](https://arxiv.org/html/2508.13666) - Research on token optimization through format removal
2. [Guidelines to Prompt Large Language Models for Code Generation: An Empirical Characterization](https://arxiv.org/html/2601.13118v1) - 2026 empirical study on code prompting
3. [What Prompts Don't Say: Understanding and Managing Underspecification in LLM Prompts](https://arxiv.org/html/2505.13360v1) - Critical research on prompt underspecification
4. [A comprehensive taxonomy of prompt engineering techniques](https://jamesthez.github.io/files/liu-fcs26.pdf) - Academic taxonomy of prompting methods

### Best Practices Guides

5. [The 2026 Guide to Prompt Engineering | IBM](https://www.ibm.com/think/prompt-engineering) - Industry best practices for 2026
6. [Prompt engineering best practices | Claude](https://claude.com/blog/best-practices-for-prompt-engineering) - Anthropic's official guidance
7. [Claude Prompt Engineering Best Practices (2026): A Checklist That Actually Improves Outputs](https://promptbuilder.cc/blog/claude-prompt-engineering-best-practices-2026)
8. [Prompt Engineering Guide 2026](https://www.analyticsvidhya.com/blog/2026/01/master-prompt-engineering/)

### Summarization Techniques

9. [Prompt Engineering Guide to Summarization](https://blog.promptlayer.com/prompt-engineering-guide-to-summarization/)
10. [Summarising Best Practices for Prompt Engineering | Towards Data Science](https://towardsdatascience.com/summarising-best-practices-for-prompt-engineering-c5e86c483af4/)
11. [Crafting Effective Prompts for Summarization Using Large Language Models | Towards Data Science](https://towardsdatascience.com/crafting-effective-prompts-for-summarization-using-large-language-models-dbbdf019f664/)

### Few-Shot vs Zero-Shot Learning

12. [Zero-Shot Learning vs. Few-Shot Learning vs. Fine-Tuning](https://labelbox.com/guides/zero-shot-learning-few-shot-learning-fine-tuning/) - Technical walkthrough
13. [Zero-Shot vs Few-Shot prompting: A Guide with Examples](https://www.vellum.ai/blog/zero-shot-vs-few-shot-prompting-a-guide-with-examples)
14. [Few-Shot Prompting | Prompt Engineering Guide](https://www.promptingguide.ai/techniques/fewshot)
15. [Zero-Shot and Few-Shot Learning with LLMs](https://neptune.ai/blog/zero-shot-and-few-shot-learning-with-llms)

### Token Optimization

16. [4 Research Backed Prompt Optimization Techniques to Save Your Tokens](https://medium.com/@koyelac/4-research-backed-prompt-optimization-techniques-to-save-your-tokens-ede300ec90dc)
17. [Better Prompting for LLMs: From Code Blocks to JSON and TOON](https://medium.com/@mokshanirugutti/better-prompting-for-llms-from-code-blocks-to-json-and-toon-8ceca8dd4f22)
18. [Prompt Compression in Large Language Models (LLMs): Making Every Token Count](https://medium.com/@sahin.samia/prompt-compression-in-large-language-models-llms-making-every-token-count-078a2d1c7e03)
19. [Stop Wasting LLM Tokens | Towards Data Science](https://towardsdatascience.com/stop-wasting-llm-tokens-a5b581fb3e6e/)

### Structured Outputs

20. [Generating Structured Output with LLMs (Part 1)](https://ankur-singh.github.io/blog/structured-output)
21. [Structuring Output Formats (JSON, Markdown)](https://apxml.com/courses/prompt-engineering-llm-application-development/chapter-2-advanced-prompting-strategies/structuring-output-formats)
22. [Mastering Prompt Engineering: Using LLMs to Generate JSON-Based Prompts](https://blog.republiclabs.ai/2026/01/mastering-prompt-engineering-using-llms.html)
23. [Why Markdown is the best format for LLMs](https://medium.com/@wetrocloud/why-markdown-is-the-best-format-for-llms-aa0514a409a7)
24. [From Free-Form to Structured: A Better Way to Use LLMs](https://marutitech.com/structured-outputs-llms/)

### Code Generation & Analysis

25. [Using LLMs for Code Generation: A Guide to Improving Accuracy and Addressing Common Issues](https://www.prompthub.us/blog/using-llms-for-code-generation-a-guide-to-improving-accuracy-and-addressing-common-issues)
26. [My LLM coding workflow going into 2026 - by Addy Osmani](https://addyo.substack.com/p/my-llm-coding-workflow-going-into)
27. [The Prompt Engineering Playbook for Programmers](https://addyo.substack.com/p/the-prompt-engineering-playbook-for)

### Common Pitfalls & Challenges

28. [Common LLM Prompt Engineering Challenges and Solutions](https://latitude-blog.ghost.io/blog/common-llm-prompt-engineering-challenges-and-solutions/)
29. [LLM Limitations: When Models and Chatbots Make Mistakes](https://learnprompting.org/docs/basics/pitfalls)
30. [A Field Guide to LLM Failure Modes](https://medium.com/@adnanmasood/a-field-guide-to-llm-failure-modes-5ffaeeb08e80)

---

## Appendix: Quick Reference Checklist

### Before Writing a Code Summarization Prompt

- [ ] Is the purpose clear? (overview, detailed analysis, security review, etc.)
- [ ] Is the output format specified? (JSON, Markdown, prose)
- [ ] Is the audience identified? (developers, managers, documentation)
- [ ] Are constraints explicit? (length, focus areas, depth)
- [ ] Is context provided? (file role, project type, dependencies)
- [ ] Are examples included if using few-shot?
- [ ] Is the prompt under 50 words for simple tasks?
- [ ] Is code properly formatted with language tags?
- [ ] Is token budget considered for large files?
- [ ] Is output validation planned?

### After Receiving LLM Output

- [ ] Does output match requested format?
- [ ] Are all required fields present?
- [ ] Is the summary accurate? (spot check against code)
- [ ] Are edge cases and issues identified?
- [ ] Is complexity analysis reasonable?
- [ ] Are dependencies correctly identified?
- [ ] Is technical terminology accurate?
- [ ] Can this output be parsed programmatically (if needed)?
- [ ] Is it suitable for the intended audience?
- [ ] Should this be cached for future use?

---

**Document Version:** 1.0
**Last Updated:** January 26, 2026
**Maintained by:** mdcontext project
**Review Schedule:** Quarterly (next review: April 2026)
