#!/usr/bin/env node
/**
 * md-tldr CLI - Token-efficient markdown analysis
 */

import { Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Option } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { parseFile } from "../parser/parser.js";
import { buildIndex, getOutgoingLinks, getIncomingLinks } from "../index/indexer.js";
import { watchDirectory } from "../index/watcher.js";
import { search, getContext, formatContextForLLM } from "../search/searcher.js";
import { buildEmbeddings, semanticSearch, getEmbeddingStats } from "../embeddings/semantic-search.js";
import { summarizeFile, formatSummary, assembleContext, formatAssembledContext } from "../summarize/summarizer.js";
import type { MdSection } from "../core/types.js";

// ============================================================================
// Helper Functions
// ============================================================================

const formatJson = (obj: unknown, pretty: boolean): string => {
  return pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
};

const printSection = (section: MdSection, indent: number = 0): string => {
  const prefix = "  ".repeat(indent);
  const bullet = section.level === 1 ? "#" : "-";
  let output = `${prefix}${bullet} ${section.heading} (${section.metadata.tokenCount} tokens)\n`;

  for (const child of section.children) {
    output += printSection(child, indent + 1);
  }

  return output;
};

const isMarkdownFile = (filename: string): boolean => {
  return filename.endsWith(".md") || filename.endsWith(".mdx");
};

const walkDir = async (dir: string): Promise<string[]> => {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip hidden directories and node_modules
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }

    if (entry.isDirectory()) {
      const subFiles = await walkDir(fullPath);
      files.push(...subFiles);
    } else if (entry.isFile() && isMarkdownFile(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
};

// ============================================================================
// Command Options
// ============================================================================

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false)
);

const prettyOption = Options.boolean("pretty").pipe(
  Options.withDescription("Pretty-print JSON output"),
  Options.withDefault(true)
);

// ============================================================================
// Parse Command
// ============================================================================

const parseCommand = Command.make(
  "parse",
  {
    file: Options.file("file").pipe(Options.withAlias("f")),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ file, json, pretty }) =>
    Effect.gen(function* () {
      const result = yield* parseFile(file).pipe(
        Effect.mapError((e) => new Error(`${e._tag}: ${e.message}`))
      );

      if (json) {
        yield* Console.log(formatJson(result, pretty));
      } else {
        yield* Console.log(`Document: ${result.title}`);
        yield* Console.log(`Path: ${result.path}`);
        yield* Console.log(`Tokens: ${result.metadata.tokenCount}`);
        yield* Console.log(`Sections: ${result.metadata.headingCount}`);
        yield* Console.log(`Links: ${result.metadata.linkCount}`);
        yield* Console.log(`Code Blocks: ${result.metadata.codeBlockCount}`);
        yield* Console.log("");
        yield* Console.log("Structure:");
        for (const section of result.sections) {
          yield* Console.log(printSection(section));
        }
      }
    })
);

// ============================================================================
// Tree Command
// ============================================================================

const treeCommand = Command.make(
  "tree",
  {
    dir: Options.directory("dir").pipe(
      Options.withAlias("d"),
      Options.withDefault(".")
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ dir, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedDir = path.resolve(dir);

      const files = yield* Effect.promise(() => walkDir(resolvedDir));

      const tree: { path: string; relativePath: string }[] = files
        .sort()
        .map((f) => ({
          path: f,
          relativePath: path.relative(resolvedDir, f),
        }));

      if (json) {
        yield* Console.log(formatJson(tree, pretty));
      } else {
        yield* Console.log(`Markdown files in ${resolvedDir}:`);
        yield* Console.log("");
        for (const file of tree) {
          yield* Console.log(`  ${file.relativePath}`);
        }
        yield* Console.log("");
        yield* Console.log(`Total: ${tree.length} files`);
      }
    })
);

// ============================================================================
// Structure Command
// ============================================================================

const structureCommand = Command.make(
  "structure",
  {
    file: Options.file("file").pipe(Options.withAlias("f")),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ file, json, pretty }) =>
    Effect.gen(function* () {
      const result = yield* parseFile(file).pipe(
        Effect.mapError((e) => new Error(`${e._tag}: ${e.message}`))
      );

      const extractStructure = (
        section: MdSection
      ): { heading: string; level: number; tokens: number; children: unknown[] } => ({
        heading: section.heading,
        level: section.level,
        tokens: section.metadata.tokenCount,
        children: section.children.map(extractStructure),
      });

      const structure = {
        title: result.title,
        path: result.path,
        totalTokens: result.metadata.tokenCount,
        sections: result.sections.map(extractStructure),
      };

      if (json) {
        yield* Console.log(formatJson(structure, pretty));
      } else {
        yield* Console.log(`# ${result.title}`);
        yield* Console.log(`Total tokens: ${result.metadata.tokenCount}`);
        yield* Console.log("");

        const printOutline = (section: MdSection, depth: number = 0): Effect.Effect<void> =>
          Effect.gen(function* () {
            const indent = "  ".repeat(depth);
            const marker = "#".repeat(section.level);
            yield* Console.log(
              `${indent}${marker} ${section.heading} [${section.metadata.tokenCount} tokens]`
            );
            for (const child of section.children) {
              yield* printOutline(child, depth + 1);
            }
          });

        for (const section of result.sections) {
          yield* printOutline(section);
        }
      }
    })
);

// ============================================================================
// Index Command
// ============================================================================

const forceOption = Options.boolean("force").pipe(
  Options.withDescription("Force full rebuild, ignoring cache"),
  Options.withDefault(false)
);

const watchOption = Options.boolean("watch").pipe(
  Options.withAlias("w"),
  Options.withDescription("Watch for changes and re-index automatically"),
  Options.withDefault(false)
);

const indexCommand = Command.make(
  "index",
  {
    dir: Options.directory("dir").pipe(
      Options.withAlias("d"),
      Options.withDefault(".")
    ),
    force: forceOption,
    watch: watchOption,
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ dir, force, watch: watchMode, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedDir = path.resolve(dir);

      if (watchMode) {
        yield* Console.log(`Watching ${resolvedDir} for changes...`);
        yield* Console.log("Press Ctrl+C to stop.");
        yield* Console.log("");

        const watcher = yield* watchDirectory(resolvedDir, {
          force,
          onIndex: (result) => {
            if (json) {
              console.log(formatJson(result, pretty));
            } else {
              console.log(`Re-indexed ${result.documentsIndexed} documents (${result.duration}ms)`);
            }
          },
          onError: (error) => {
            console.error(`Watch error: ${error.message}`);
          },
        });

        // Keep the process running until Ctrl+C
        yield* Effect.async<never, never>(() => {
          process.on("SIGINT", () => {
            watcher.stop();
            console.log("\nStopped watching.");
            process.exit(0);
          });
        });
      } else {
        yield* Console.log(`Indexing ${resolvedDir}...`);

        const result = yield* buildIndex(resolvedDir, { force });

        if (json) {
          yield* Console.log(formatJson(result, pretty));
        } else {
          yield* Console.log("");
          yield* Console.log(`Indexed ${result.documentsIndexed} documents`);
          yield* Console.log(`  Sections: ${result.sectionsIndexed}`);
          yield* Console.log(`  Links: ${result.linksIndexed}`);
          yield* Console.log(`  Duration: ${result.duration}ms`);

          if (result.errors.length > 0) {
            yield* Console.log("");
            yield* Console.log(`Errors (${result.errors.length}):`);
            for (const error of result.errors) {
              yield* Console.log(`  ${error.path}: ${error.message}`);
            }
          }
        }
      }
    })
);

// ============================================================================
// Links Command
// ============================================================================

const linksCommand = Command.make(
  "links",
  {
    file: Options.file("file").pipe(Options.withAlias("f")),
    root: Options.directory("root").pipe(
      Options.withAlias("r"),
      Options.withDefault(".")
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ file, root, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedRoot = path.resolve(root);
      const resolvedFile = path.resolve(file);
      const relativePath = path.relative(resolvedRoot, resolvedFile);

      const links = yield* getOutgoingLinks(resolvedRoot, resolvedFile);

      if (json) {
        yield* Console.log(formatJson({ file: relativePath, links }, pretty));
      } else {
        yield* Console.log(`Outgoing links from ${relativePath}:`);
        yield* Console.log("");
        if (links.length === 0) {
          yield* Console.log("  (none)");
        } else {
          for (const link of links) {
            yield* Console.log(`  -> ${link}`);
          }
        }
        yield* Console.log("");
        yield* Console.log(`Total: ${links.length} links`);
      }
    })
);

// ============================================================================
// Backlinks Command
// ============================================================================

const backlinksCommand = Command.make(
  "backlinks",
  {
    file: Options.file("file").pipe(Options.withAlias("f")),
    root: Options.directory("root").pipe(
      Options.withAlias("r"),
      Options.withDefault(".")
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ file, root, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedRoot = path.resolve(root);
      const resolvedFile = path.resolve(file);
      const relativePath = path.relative(resolvedRoot, resolvedFile);

      const links = yield* getIncomingLinks(resolvedRoot, resolvedFile);

      if (json) {
        yield* Console.log(formatJson({ file: relativePath, backlinks: links }, pretty));
      } else {
        yield* Console.log(`Incoming links to ${relativePath}:`);
        yield* Console.log("");
        if (links.length === 0) {
          yield* Console.log("  (none)");
        } else {
          for (const link of links) {
            yield* Console.log(`  <- ${link}`);
          }
        }
        yield* Console.log("");
        yield* Console.log(`Total: ${links.length} backlinks`);
      }
    })
);

// ============================================================================
// Search Command
// ============================================================================

const headingOption = Options.text("heading").pipe(
  Options.withAlias("h"),
  Options.withDescription("Filter by heading pattern (regex)"),
  Options.optional
);

const pathOption = Options.text("path").pipe(
  Options.withAlias("p"),
  Options.withDescription("Filter by file path pattern (glob-like)"),
  Options.optional
);

const hasCodeOption = Options.boolean("has-code").pipe(
  Options.withDescription("Only sections with code blocks"),
  Options.withDefault(false)
);

const hasListOption = Options.boolean("has-list").pipe(
  Options.withDescription("Only sections with lists"),
  Options.withDefault(false)
);

const hasTableOption = Options.boolean("has-table").pipe(
  Options.withDescription("Only sections with tables"),
  Options.withDefault(false)
);

const limitOption = Options.integer("limit").pipe(
  Options.withAlias("l"),
  Options.withDescription("Maximum number of results"),
  Options.withDefault(100)
);

const searchCommand = Command.make(
  "search",
  {
    root: Options.directory("root").pipe(
      Options.withAlias("r"),
      Options.withDefault(".")
    ),
    heading: headingOption,
    pathPattern: pathOption,
    hasCode: hasCodeOption,
    hasList: hasListOption,
    hasTable: hasTableOption,
    limit: limitOption,
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ root, heading, pathPattern, hasCode, hasList, hasTable, limit, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedRoot = path.resolve(root);

      // Build search options - only include filters that are actively set
      const searchOptions: Parameters<typeof search>[1] = {
        heading: Option.getOrUndefined(heading),
        pathPattern: Option.getOrUndefined(pathPattern),
        hasCode: hasCode ? true : undefined,
        hasList: hasList ? true : undefined,
        hasTable: hasTable ? true : undefined,
        limit,
      };

      const results = yield* search(resolvedRoot, searchOptions);

      if (json) {
        const output = results.map((r) => ({
          path: r.section.documentPath,
          heading: r.section.heading,
          level: r.section.level,
          tokens: r.section.tokenCount,
          line: r.section.startLine,
          hasCode: r.section.hasCode,
          hasList: r.section.hasList,
          hasTable: r.section.hasTable,
        }));
        yield* Console.log(formatJson(output, pretty));
      } else {
        yield* Console.log(`Search results (${results.length}):`);
        yield* Console.log("");

        for (const result of results) {
          const levelMarker = "#".repeat(result.section.level);
          const meta: string[] = [];
          if (result.section.hasCode) meta.push("code");
          if (result.section.hasList) meta.push("list");
          if (result.section.hasTable) meta.push("table");
          const metaStr = meta.length > 0 ? ` [${meta.join(", ")}]` : "";

          yield* Console.log(
            `  ${result.section.documentPath}:${result.section.startLine}`
          );
          yield* Console.log(
            `    ${levelMarker} ${result.section.heading}${metaStr} (${result.section.tokenCount} tokens)`
          );
          yield* Console.log("");
        }
      }
    })
);

// ============================================================================
// Summarize Command
// ============================================================================

const tokensOption = Options.integer("tokens").pipe(
  Options.withAlias("t"),
  Options.withDescription("Maximum tokens to include"),
  Options.optional
);

const levelOption = Options.choice("level", ["brief", "summary", "full"]).pipe(
  Options.withDescription("Compression level"),
  Options.withDefault("summary" as const)
);

const summarizeCommand = Command.make(
  "summarize",
  {
    file: Options.file("file").pipe(Options.withAlias("f")),
    level: levelOption,
    tokens: tokensOption,
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ file, level, tokens, json, pretty }) =>
    Effect.gen(function* () {
      const maxTokens = Option.getOrUndefined(tokens);

      const summary = yield* summarizeFile(file, {
        level: level as "brief" | "summary" | "full",
        maxTokens,
      });

      if (json) {
        yield* Console.log(formatJson(summary, pretty));
      } else {
        yield* Console.log(formatSummary(summary));
      }
    })
);

// ============================================================================
// Context Command (single file)
// ============================================================================

const contextCommand = Command.make(
  "context",
  {
    file: Options.file("file").pipe(Options.withAlias("f")),
    root: Options.directory("root").pipe(
      Options.withAlias("r"),
      Options.withDefault(".")
    ),
    tokens: tokensOption,
    level: levelOption,
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ file, root, tokens, level, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedRoot = path.resolve(root);
      const maxTokens = Option.getOrUndefined(tokens);

      const context = yield* getContext(resolvedRoot, file, {
        maxTokens,
        level: level as "brief" | "summary" | "full",
        includeContent: level === "full",
      });

      if (json) {
        yield* Console.log(formatJson(context, pretty));
      } else {
        yield* Console.log(formatContextForLLM(context));
      }
    })
);

// ============================================================================
// Assemble Command (multi-file context)
// ============================================================================

const sourcesOption = Options.text("sources").pipe(
  Options.withAlias("s"),
  Options.withDescription("Comma-separated list of source files")
);

const budgetOption = Options.integer("budget").pipe(
  Options.withAlias("b"),
  Options.withDescription("Total token budget"),
  Options.withDefault(2000)
);

const assembleCommand = Command.make(
  "assemble",
  {
    sources: sourcesOption,
    root: Options.directory("root").pipe(
      Options.withAlias("r"),
      Options.withDefault(".")
    ),
    budget: budgetOption,
    level: levelOption,
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ sources, root, budget, level, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedRoot = path.resolve(root);
      const sourcePaths = sources.split(",").map((s) => s.trim());

      const assembled = yield* assembleContext(resolvedRoot, sourcePaths, {
        budget,
        level: level as "brief" | "summary" | "full",
      });

      if (json) {
        yield* Console.log(formatJson(assembled, pretty));
      } else {
        yield* Console.log(formatAssembledContext(assembled));
      }
    })
);

// ============================================================================
// Embed Command
// ============================================================================

const embedCommand = Command.make(
  "embed",
  {
    root: Options.directory("root").pipe(
      Options.withAlias("r"),
      Options.withDefault(".")
    ),
    force: forceOption,
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ root, force, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedRoot = path.resolve(root);

      yield* Console.log(`Building embeddings for ${resolvedRoot}...`);

      const result = yield* buildEmbeddings(resolvedRoot, { force });

      if (json) {
        yield* Console.log(formatJson(result, pretty));
      } else {
        yield* Console.log("");
        yield* Console.log(`Embedded ${result.sectionsEmbedded} sections`);
        yield* Console.log(`  Tokens used: ${result.tokensUsed}`);
        yield* Console.log(`  Cost: $${result.cost.toFixed(6)}`);
        yield* Console.log(`  Duration: ${result.duration}ms`);
      }
    })
);

// ============================================================================
// Semantic Search Command
// ============================================================================

const queryArg = Options.text("query").pipe(
  Options.withAlias("q"),
  Options.withDescription("Natural language query for semantic search")
);

const thresholdOption = Options.float("threshold").pipe(
  Options.withDescription("Minimum similarity threshold (0-1)"),
  Options.withDefault(0.5)
);

const semanticCommand = Command.make(
  "semantic",
  {
    query: queryArg,
    root: Options.directory("root").pipe(
      Options.withAlias("r"),
      Options.withDefault(".")
    ),
    limit: limitOption,
    threshold: thresholdOption,
    pathPattern: pathOption,
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ query, root, limit, threshold, pathPattern, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedRoot = path.resolve(root);

      const results = yield* semanticSearch(resolvedRoot, query, {
        limit,
        threshold,
        pathPattern: Option.getOrUndefined(pathPattern),
      });

      if (json) {
        yield* Console.log(formatJson(results, pretty));
      } else {
        yield* Console.log(`Semantic search results for: "${query}"`);
        yield* Console.log(`Results: ${results.length}`);
        yield* Console.log("");

        for (const result of results) {
          const similarity = (result.similarity * 100).toFixed(1);
          yield* Console.log(`  ${result.documentPath}`);
          yield* Console.log(`    ${result.heading} (${similarity}% match)`);
          yield* Console.log("");
        }
      }
    })
);

// ============================================================================
// Embedding Stats Command
// ============================================================================

const statsCommand = Command.make(
  "stats",
  {
    root: Options.directory("root").pipe(
      Options.withAlias("r"),
      Options.withDefault(".")
    ),
    json: jsonOption,
    pretty: prettyOption,
  },
  ({ root, json, pretty }) =>
    Effect.gen(function* () {
      const resolvedRoot = path.resolve(root);
      const stats = yield* getEmbeddingStats(resolvedRoot);

      if (json) {
        yield* Console.log(formatJson(stats, pretty));
      } else {
        yield* Console.log("Embedding stats:");
        yield* Console.log("");
        if (stats.hasEmbeddings) {
          yield* Console.log(`  Vectors: ${stats.count}`);
          yield* Console.log(`  Provider: ${stats.provider}`);
          yield* Console.log(`  Dimensions: ${stats.dimensions}`);
          yield* Console.log(`  Total tokens: ${stats.totalTokens}`);
          yield* Console.log(`  Total cost: $${stats.totalCost.toFixed(6)}`);
        } else {
          yield* Console.log("  No embeddings found.");
          yield* Console.log("  Run 'mdtldr embed' to build embeddings.");
        }
      }
    })
);

// ============================================================================
// Main CLI
// ============================================================================

const mainCommand = Command.make("mdtldr").pipe(
  Command.withDescription("Token-efficient markdown analysis tool for LLMs"),
  Command.withSubcommands([
    parseCommand,
    treeCommand,
    structureCommand,
    indexCommand,
    linksCommand,
    backlinksCommand,
    searchCommand,
    contextCommand,
    summarizeCommand,
    assembleCommand,
    embedCommand,
    semanticCommand,
    statsCommand,
  ])
);

const cli = Command.run(mainCommand, {
  name: "mdtldr",
  version: "0.1.0",
});

// Run
Effect.suspend(() => cli(process.argv)).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
);
