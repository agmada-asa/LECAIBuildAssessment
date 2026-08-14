/**
 * @file Environment allowlist for local provider subprocesses.
 *
 * Instruction-driven child processes receive only the paths and platform
 * settings needed to start. Application credentials and connection strings
 * remain in the parent server process.
 */

const PROVIDER_ENVIRONMENT_KEYS = [
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "CODEX_HOME",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
] as const;

/**
 * Copies the minimum non-secret environment needed to launch Codex or Ollama.
 *
 * @param source Parent process environment to filter.
 * @returns A new environment object containing allowlisted, defined values.
 */
export function buildProviderEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): NodeJS.ProcessEnv {
  const nodeEnvironment =
    source.NODE_ENV === "development" || source.NODE_ENV === "test"
      ? source.NODE_ENV
      : "production";
  const environment: NodeJS.ProcessEnv = {
    // Next.js makes NODE_ENV required in ProcessEnv; it is safe and also
    // preserves the child runtime's expected mode.
    NODE_ENV: nodeEnvironment,
  };

  PROVIDER_ENVIRONMENT_KEYS.forEach((key) => {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  });

  return environment;
}
