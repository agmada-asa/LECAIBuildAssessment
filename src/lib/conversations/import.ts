/**
 * @file Browser-safe parsers that normalise JSON, CSV, and line-based TXT logs.
 *
 * Parsers never sort messages. Missing IDs and timestamps receive stable values
 * based on source order, while supplied source IDs remain unchanged.
 */

import { conversationLogSchema, type ConversationLog } from "./schema";

export type ConversationImportFormat = "auto" | "json" | "csv" | "txt";

export type ConversationImportOptions = {
  format?: ConversationImportFormat;
  filename?: string;
  conversationId?: string;
  userId?: string;
};

/** An actionable, safe-to-display import failure. */
export class ConversationImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationImportError";
  }
}

type ImportedMessage = {
  id?: string;
  author?: unknown;
  role?: unknown;
  text?: unknown;
  content?: unknown;
  timestamp?: unknown;
};

/** Generates a deterministic identifier without exposing imported content. */
function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `import-${(hash >>> 0).toString(36)}`;
}

/** Supplies an ordered synthetic timestamp when the source has none. */
function fallbackTimestamp(index: number): string {
  return new Date(Date.UTC(2000, 0, 1, 0, 0, index)).toISOString();
}

/** Converts common export field names into the canonical message shape. */
function normaliseMessages(messages: ImportedMessage[]) {
  const usedIds = new Set(
    messages
      .map((message) =>
        typeof message.id === "string" && message.id.trim() ? message.id.trim() : undefined,
      )
      .filter((id): id is string => Boolean(id)),
  );

  return messages.map((message, index) => {
    const authorValue = message.author ?? message.role;
    const author =
      typeof authorValue === "string" && authorValue.trim()
        ? authorValue.trim()
        : undefined;
    const textValue = message.text ?? message.content;
    const timestampValue = message.timestamp;
    let id =
      typeof message.id === "string" && message.id.trim()
        ? message.id.trim()
        : `M${index + 1}`;
    let suffix = index + 1;
    while (
      (!message.id || !String(message.id).trim()) &&
      usedIds.has(id)
    ) {
      suffix += 1;
      id = `M${suffix}`;
    }
    usedIds.add(id);

    return {
      id,
      ...(author ? { author } : {}),
      text: typeof textValue === "string" ? textValue : "",
      timestamp:
        typeof timestampValue === "string" && timestampValue.trim()
          ? timestampValue.trim()
          : fallbackTimestamp(index),
    };
  });
}

/** Converts Zod issues into a concise message a user can act on. */
function parseCanonical(value: unknown): ConversationLog {
  const result = conversationLogSchema.safeParse(value);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const location = issue.path.length ? ` at ${issue.path.join(".")}` : "";
  throw new ConversationImportError(`${issue.message}${location}`);
}

/** Parses one RFC-4180-style CSV string, including quoted commas and newlines. */
function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new ConversationImportError("A quoted CSV field is not closed.");
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

/** Parses JSON that is either canonical or a common top-level message array. */
function parseJson(input: string, options: ConversationImportOptions): unknown {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new ConversationImportError("Paste valid JSON or choose a valid .json file.");
  }

  if (!Array.isArray(value)) {
    if (typeof value === "object" && value !== null && options.conversationId) {
      return {
        ...value,
        conversationId: options.conversationId,
      };
    }
    return value;
  }
  return {
    conversationId: options.conversationId ?? stableId(input),
    userId: options.userId ?? "imported-user",
    messages: normaliseMessages(value as ImportedMessage[]),
    acceptedOutcomes: [],
  };
}

/** Parses CSV columns: text is required; id, timestamp, and author are optional. */
function parseCsv(input: string, options: ConversationImportOptions): unknown {
  const rows = parseCsvRows(input);
  if (rows.length < 2) {
    throw new ConversationImportError("CSV must include a header and at least one message.");
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const textIndex = headers.indexOf("text");
  if (textIndex === -1) {
    throw new ConversationImportError('CSV must include a "text" column.');
  }

  const idIndex = headers.indexOf("id");
  const authorIndex = headers.indexOf("author");
  const timestampIndex = headers.indexOf("timestamp");
  const messages = rows.slice(1).map((row) => ({
    id: idIndex >= 0 ? row[idIndex] : undefined,
    author: authorIndex >= 0 ? row[authorIndex] : undefined,
    text: row[textIndex],
    timestamp: timestampIndex >= 0 ? row[timestampIndex] : undefined,
  }));

  return {
    conversationId: options.conversationId ?? stableId(input),
    userId: options.userId ?? "imported-user",
    messages: normaliseMessages(messages),
    acceptedOutcomes: [],
  };
}

/** Parses one task message per non-empty line with an optional `message-id:` prefix. */
function parseTxt(input: string, options: ConversationImportOptions): unknown {
  const messages: ImportedMessage[] = [];

  input.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    const match = line.match(/^\s*([^:]{1,200})\s*:\s*(.*)$/);
    messages.push(
      match
        ? { id: match[1].trim(), text: match[2] }
        : { text: line.trim() },
    );
  });

  return {
    conversationId: options.conversationId ?? stableId(input),
    userId: options.userId ?? "imported-user",
    messages: normaliseMessages(messages),
    acceptedOutcomes: [],
  };
}

/** Chooses a parser from an explicit option, filename, or content signature. */
function detectFormat(input: string, options: ConversationImportOptions) {
  if (options.format && options.format !== "auto") return options.format;
  const extension = options.filename?.split(".").pop()?.toLowerCase();
  if (extension === "json" || extension === "csv" || extension === "txt") {
    return extension;
  }
  const trimmed = input.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  const csvHeaders = trimmed
    .split(/\r?\n/, 1)[0]
    .split(",")
    .map((header) => header.trim().toLowerCase());
  if (csvHeaders.includes("text")) return "csv";
  return "txt";
}

/**
 * Normalises one pasted string or file body into `ConversationLog`.
 *
 * @throws ConversationImportError with safe, actionable validation details.
 */
export function parseConversationInput(
  input: string,
  options: ConversationImportOptions = {},
): ConversationLog {
  if (!input.trim()) throw new ConversationImportError("Add a conversation to analyse.");
  const format = detectFormat(input, options);
  const value =
    format === "json"
      ? parseJson(input, options)
      : format === "csv"
        ? parseCsv(input, options)
        : parseTxt(input, options);
  return parseCanonical(value);
}
