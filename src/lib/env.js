export function expandEnv(input) {
  return input.replace(/\$\{([A-Z0-9_]+)(?::-(.*?))?\}/g, (_m, name, fallback) => {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing environment variable: ${name}`);
  });
}
