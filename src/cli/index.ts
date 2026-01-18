#!/usr/bin/env node
/**
 * md-tldr CLI - Token-efficient markdown analysis
 */

import { Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { parseFile } from "../parser/parser.js";
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
// Main CLI
// ============================================================================

const mainCommand = Command.make("mdtldr").pipe(
  Command.withDescription("Token-efficient markdown analysis tool for LLMs"),
  Command.withSubcommands([parseCommand, treeCommand, structureCommand])
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
