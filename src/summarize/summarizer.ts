/**
 * Summarization engine for md-tldr
 *
 * Provides hierarchical summarization and multi-document context assembly
 */

import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { parseFile } from "../parser/parser.js";
import { countTokensApprox } from "../utils/tokens.js";
import type { MdDocument, MdSection } from "../core/types.js";

// ============================================================================
// Types
// ============================================================================

export type CompressionLevel = "brief" | "summary" | "full";

export interface SummarizeOptions {
  /** Compression level */
  readonly level?: CompressionLevel | undefined;
  /** Maximum tokens for output */
  readonly maxTokens?: number | undefined;
}

export interface SectionSummary {
  readonly heading: string;
  readonly level: number;
  readonly originalTokens: number;
  readonly summaryTokens: number;
  readonly summary: string;
  readonly children: readonly SectionSummary[];
  readonly hasCode: boolean;
  readonly hasList: boolean;
  readonly hasTable: boolean;
}

export interface DocumentSummary {
  readonly path: string;
  readonly title: string;
  readonly originalTokens: number;
  readonly summaryTokens: number;
  readonly compressionRatio: number;
  readonly sections: readonly SectionSummary[];
  readonly keyTopics: readonly string[];
}

export interface AssembleContextOptions {
  /** Total token budget */
  readonly budget: number;
  /** Compression level for each source */
  readonly level?: CompressionLevel | undefined;
}

export interface AssembledContext {
  readonly sources: readonly SourceContext[];
  readonly totalTokens: number;
  readonly budget: number;
  readonly overflow: readonly string[];
}

export interface SourceContext {
  readonly path: string;
  readonly title: string;
  readonly tokens: number;
  readonly content: string;
}

// ============================================================================
// Token Budgets per Level
// ============================================================================

const TOKEN_BUDGETS: Record<CompressionLevel, number> = {
  brief: 100,
  summary: 500,
  full: Infinity,
};

// ============================================================================
// Section Summarization
// ============================================================================

const extractKeyPoints = (content: string, maxSentences: number): string[] => {
  // Split into sentences
  const sentences = content
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 10);

  if (sentences.length <= maxSentences) {
    return sentences;
  }

  // Simple heuristic: prefer sentences with key indicators
  const scored = sentences.map((s) => {
    let score = 0;
    // Prefer sentences with:
    if (s.includes(":")) score += 2; // definitions/explanations
    if (/^[A-Z]/.test(s)) score += 1; // proper start
    if (s.length > 50 && s.length < 200) score += 1; // medium length
    if (/\*\*|`/.test(s)) score += 1; // has emphasis or code
    return { sentence: s, score };
  });

  // Sort by score and take top sentences
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxSentences).map((s) => s.sentence);
};

const summarizeSection = (
  section: MdSection,
  level: CompressionLevel
): SectionSummary => {
  const originalTokens = section.metadata.tokenCount;

  // Get children summaries first
  const children = section.children.map((child) =>
    summarizeSection(child, level)
  );

  // Calculate target tokens based on level
  const targetTokens = Math.min(
    TOKEN_BUDGETS[level],
    Math.max(originalTokens * 0.3, 20) // At least 30% or 20 tokens
  );

  let summary: string;

  if (level === "full" || originalTokens <= targetTokens) {
    // Include full content for "full" level or if already small
    summary = section.content;
  } else if (level === "brief") {
    // Just heading and metadata for brief
    const meta: string[] = [];
    if (section.metadata.hasCode) meta.push("code");
    if (section.metadata.hasList) meta.push("list");
    if (section.metadata.hasTable) meta.push("table");
    summary = meta.length > 0 ? `[${meta.join(", ")}]` : "";
  } else {
    // Summary level: extract key points
    const maxSentences = Math.max(2, Math.floor(targetTokens / 30));
    const keyPoints = extractKeyPoints(section.plainText, maxSentences);

    if (keyPoints.length > 0) {
      summary = keyPoints.join(" ");
    } else {
      // Fallback: truncate
      const words = section.plainText.split(/\s+/).slice(0, targetTokens);
      summary = words.join(" ") + (words.length < section.plainText.split(/\s+/).length ? "..." : "");
    }
  }

  const summaryTokens = countTokensApprox(summary);

  return {
    heading: section.heading,
    level: section.level,
    originalTokens,
    summaryTokens,
    summary,
    children,
    hasCode: section.metadata.hasCode,
    hasList: section.metadata.hasList,
    hasTable: section.metadata.hasTable,
  };
};

// ============================================================================
// Document Summarization
// ============================================================================

const extractTopics = (document: MdDocument): string[] => {
  const topics: Set<string> = new Set();

  // Extract from headings
  const processSection = (section: MdSection) => {
    // Clean heading and add as topic
    const cleanHeading = section.heading
      .replace(/[:#\-_]/g, " ")
      .trim()
      .toLowerCase();
    if (cleanHeading.length > 2 && cleanHeading.length < 50) {
      topics.add(cleanHeading);
    }

    for (const child of section.children) {
      processSection(child);
    }
  };

  for (const section of document.sections) {
    processSection(section);
  }

  // Also extract from frontmatter tags if present
  const frontmatter = document.frontmatter as Record<string, unknown>;
  if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
    for (const tag of frontmatter.tags) {
      if (typeof tag === "string") {
        topics.add(tag.toLowerCase());
      }
    }
  }

  return Array.from(topics).slice(0, 10);
};

export const summarizeDocument = (
  document: MdDocument,
  options: SummarizeOptions = {}
): DocumentSummary => {
  const level = options.level ?? "summary";
  const maxTokens = options.maxTokens ?? TOKEN_BUDGETS[level];

  // Summarize all sections
  const sections = document.sections.map((s) => summarizeSection(s, level));

  // Calculate totals
  const originalTokens = document.metadata.tokenCount;
  let summaryTokens = sections.reduce((acc, s) => acc + s.summaryTokens, 0);

  // If over budget, truncate sections
  if (summaryTokens > maxTokens) {
    // Simple truncation: reduce section summaries
    const ratio = maxTokens / summaryTokens;
    summaryTokens = Math.floor(summaryTokens * ratio);
  }

  const compressionRatio =
    originalTokens > 0 ? 1 - summaryTokens / originalTokens : 0;

  return {
    path: document.path,
    title: document.title,
    originalTokens,
    summaryTokens,
    compressionRatio,
    sections,
    keyTopics: extractTopics(document),
  };
};

export const summarizeFile = (
  filePath: string,
  options: SummarizeOptions = {}
): Effect.Effect<DocumentSummary, Error> =>
  Effect.gen(function* () {
    const document = yield* parseFile(filePath).pipe(
      Effect.mapError((e) => new Error(`${e._tag}: ${e.message}`))
    );

    return summarizeDocument(document, options);
  });

// ============================================================================
// Format Summary for Output
// ============================================================================

export const formatSummary = (summary: DocumentSummary): string => {
  const lines: string[] = [];

  lines.push(`# ${summary.title}`);
  lines.push(`Path: ${summary.path}`);
  lines.push(
    `Tokens: ${summary.summaryTokens} (${(summary.compressionRatio * 100).toFixed(0)}% reduction from ${summary.originalTokens})`
  );
  lines.push("");

  if (summary.keyTopics.length > 0) {
    lines.push(`**Topics:** ${summary.keyTopics.join(", ")}`);
    lines.push("");
  }

  const formatSection = (section: SectionSummary, depth: number = 0) => {
    const indent = "  ".repeat(depth);
    const prefix = "#".repeat(section.level);

    lines.push(`${indent}${prefix} ${section.heading}`);

    if (section.summary) {
      lines.push(`${indent}${section.summary}`);
    }

    for (const child of section.children) {
      formatSection(child, depth + 1);
    }
  };

  for (const section of summary.sections) {
    formatSection(section);
    lines.push("");
  }

  return lines.join("\n");
};

// ============================================================================
// Multi-Document Context Assembly
// ============================================================================

export const assembleContext = (
  rootPath: string,
  sourcePaths: readonly string[],
  options: AssembleContextOptions
): Effect.Effect<AssembledContext, Error> =>
  Effect.gen(function* () {
    const budget = options.budget;
    const level = options.level ?? "summary";

    const sources: SourceContext[] = [];
    const overflow: string[] = [];
    let totalTokens = 0;

    // Calculate per-source budget (even distribution)
    const perSourceBudget = Math.floor(budget / sourcePaths.length);

    for (const sourcePath of sourcePaths) {
      const resolvedPath = path.isAbsolute(sourcePath)
        ? sourcePath
        : path.join(rootPath, sourcePath);

      try {
        const summary = yield* summarizeFile(resolvedPath, {
          level,
          maxTokens: perSourceBudget,
        });

        const content = formatSummary(summary);
        const tokens = summary.summaryTokens;

        if (totalTokens + tokens <= budget) {
          sources.push({
            path: path.relative(rootPath, resolvedPath),
            title: summary.title,
            tokens,
            content,
          });
          totalTokens += tokens;
        } else {
          // Over budget
          const remaining = budget - totalTokens;
          if (remaining > 50) {
            // Include partial if we have some room
            const briefSummary = yield* summarizeFile(resolvedPath, {
              level: "brief",
              maxTokens: remaining,
            });
            const briefContent = formatSummary(briefSummary);

            sources.push({
              path: path.relative(rootPath, resolvedPath),
              title: briefSummary.title,
              tokens: briefSummary.summaryTokens,
              content: briefContent,
            });
            totalTokens += briefSummary.summaryTokens;
          } else {
            overflow.push(path.relative(rootPath, resolvedPath));
          }
        }
      } catch (e) {
        // Skip files that can't be processed
        overflow.push(sourcePath);
      }
    }

    return {
      sources,
      totalTokens,
      budget,
      overflow,
    };
  });

// ============================================================================
// Format Assembled Context
// ============================================================================

export const formatAssembledContext = (context: AssembledContext): string => {
  const lines: string[] = [];

  lines.push("# Context Assembly");
  lines.push(`Total tokens: ${context.totalTokens}/${context.budget}`);
  lines.push(`Sources: ${context.sources.length}`);
  lines.push("");

  for (const source of context.sources) {
    lines.push("---");
    lines.push("");
    lines.push(source.content);
  }

  if (context.overflow.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Overflow (not included due to budget)");
    for (const path of context.overflow) {
      lines.push(`- ${path}`);
    }
  }

  return lines.join("\n");
};

// ============================================================================
// Measure Token Reduction
// ============================================================================

export interface TokenReductionReport {
  readonly originalTokens: number;
  readonly summaryTokens: number;
  readonly reduction: number;
  readonly reductionPercent: number;
}

export const measureReduction = async (
  filePath: string,
  level: CompressionLevel = "summary"
): Promise<TokenReductionReport> => {
  // Read original content
  const originalContent = await fs.readFile(filePath, "utf-8");
  const originalTokens = countTokensApprox(originalContent);

  // Get summary
  const result = await Effect.runPromise(
    summarizeFile(filePath, { level }).pipe(
      Effect.catchAll(() => Effect.succeed(null))
    )
  );

  if (!result) {
    return {
      originalTokens,
      summaryTokens: originalTokens,
      reduction: 0,
      reductionPercent: 0,
    };
  }

  const summaryTokens = result.summaryTokens;
  const reduction = originalTokens - summaryTokens;
  const reductionPercent = originalTokens > 0 ? reduction / originalTokens : 0;

  return {
    originalTokens,
    summaryTokens,
    reduction,
    reductionPercent,
  };
};
