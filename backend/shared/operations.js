// Operation registry — single source of truth shared between MCP and REST transports.
// Plan 01 Phase 1.
//
// Each operation registers with:
//   {
//     handler: async ({ supabase, req, args, userbotService, source }) => result,
//     requiredScopes: string[],            // any-of (OR) match
//     requiresIntegrationToken: boolean,    // reject JWT path if true
//     rateLimitClass: 'read' | 'write',
//     title: string,
//     description: string,
//     inputSchema: object,                  // JSON Schema (MCP) or zod schema (REST)
//     transports: { mcp: bool, rest: { method, path } }
//   }

const registry = new Map();

export function registerOperation(name, definition) {
  if (!name || typeof name !== 'string') {
    throw new Error('registerOperation: name must be non-empty string');
  }
  if (registry.has(name)) {
    throw new Error(`Operation already registered: ${name}`);
  }
  if (typeof definition?.handler !== 'function') {
    throw new Error(`Operation ${name} missing handler`);
  }
  if (!Array.isArray(definition?.requiredScopes) || definition.requiredScopes.length === 0) {
    throw new Error(`Operation ${name} must declare at least one required scope`);
  }
  if (!definition.transports || typeof definition.transports !== 'object') {
    throw new Error(`Operation ${name} must declare transports (mcp/rest)`);
  }
  registry.set(name, { name, ...definition });
}

export function registerOperations(map) {
  for (const [name, def] of Object.entries(map || {})) {
    registerOperation(name, def);
  }
}

export function getOperation(name) {
  return registry.get(name) || null;
}

export function hasOperation(name) {
  return registry.has(name);
}

export function listOperations() {
  return Array.from(registry.values());
}

export function listOperationNames() {
  return Array.from(registry.keys());
}

export function listRestOperations() {
  return listOperations().filter((op) => op.transports?.rest);
}

export function listMcpOperations() {
  return listOperations().filter((op) => op.transports?.mcp);
}
