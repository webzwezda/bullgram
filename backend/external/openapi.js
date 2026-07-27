// OpenAPI 3.0.3 spec generator driven by the operation registry.
// Plan 02 Phase 2.
//
// For each operation with `transports.rest = { method, path, tags?, summary? }`:
//   - Path params (`{userbot_id}`) become OpenAPI path parameters
//   - For GET/DELETE: remaining inputSchema fields → query parameters
//   - For POST/PUT/PATCH: remaining inputSchema fields → JSON request body
//   - 200 response is the operation's output (declared loosely — handlers can return
//     varying shapes; we document the common case)
//   - 401/403/429/502 responses come from ERROR_CODES via mapMcpErrorToHttp
//
// Security: Bearer auth (brapi_ integration tokens).

import { ERROR_CODES, mapMcpErrorToHttp } from '../shared/errors.js';
import { listRestOperations } from '../shared/operations.js';

const STANDARD_ERROR_CODES = [
  ERROR_CODES.INTEGRATION_TOKEN_REQUIRED,
  ERROR_CODES.INSUFFICIENT_SCOPE,
  ERROR_CODES.FORBIDDEN_ACCOUNT,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.INTERNAL,
  ERROR_CODES.TELEGRAM_ERROR
];

function refForError(code) {
  return `#/components/responses/Err_${Math.abs(code)}`;
}

// Manual routes that share the /api/external/v1/* surface but aren't part of
// the operation registry (no scope checks, no audit log, infrastructure only).
function buildManualPathItems() {
  return {
    '/health': {
      get: {
        operationId: 'health',
        summary: 'Service health + protocol version',
        description: 'Public. No auth required. Returns service name, API version, and supported MCP protocol version.',
        tags: ['infra'],
        security: [],
        responses: {
          200: {
            description: 'Service is alive',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['service', 'version', 'mcp_protocol', 'time'],
                  properties: {
                    service: { type: 'string', example: 'bullgram-external-api' },
                    version: { type: 'string', example: 'v1' },
                    mcp_protocol: { type: 'string', example: '2025-03-26' },
                    time: { type: 'string', format: 'date-time' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/me': {
      get: {
        operationId: 'me',
        summary: 'Token smoke check',
        description: 'Returns the calling token\'s id, purpose, scopes, and the owner\'s product tier. Use this to verify a token works before hitting real operations.',
        tags: ['infra'],
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Token is valid',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['auth_kind', 'owner_id', 'token', 'tier'],
                  properties: {
                    auth_kind: { type: 'string', example: 'integration_token' },
                    owner_id: { type: 'string', format: 'uuid' },
                    token: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        purpose: { type: 'string', enum: ['api', 'custom'] },
                        scopes: { type: 'array', items: { type: 'string' } }
                      }
                    },
                    tier: { type: 'string', nullable: true }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/Err_32001' }
        }
      }
    },
    '/docs': {
      get: {
        operationId: 'docs',
        summary: 'Interactive API explorer (Scalar)',
        description: 'HTML page rendering the OpenAPI spec via Scalar. No auth required.',
        tags: ['infra'],
        security: [],
        responses: {
          200: { description: 'HTML explorer page' }
        }
      }
    }
  };
}

function buildErrorResponses() {
  const responses = {};
  for (const code of STANDARD_ERROR_CODES) {
    const http = mapMcpErrorToHttp(code);
    responses[`Err_${Math.abs(code)}`] = {
      description: `${http} — error code ${code}`,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['error'],
            properties: {
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'integer', example: code },
                  message: { type: 'string' },
                  details: { type: 'object', additionalProperties: true },
                  retry_after_sec: { type: 'integer', nullable: true },
                  telegram_error_event_id: { type: 'string', format: 'uuid', nullable: true }
                }
              }
            }
          }
        }
      }
    };
  }
  return responses;
}

function jsonSchemaTypeToOpenApi(schema) {
  // OpenAPI 3.0.x is roughly JSON Schema Draft-07 with some renames.
  // We don't use any nullable/extra features here, so the schema passes through.
  return schema;
}

function extractPathParamNames(path) {
  const names = [];
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(path)) !== null) names.push(m[1]);
  return names;
}

function buildPathItem(operation) {
  const { method, path, summary, tags } = operation.transports.rest;
  const upperMethod = method.toLowerCase();
  const pathParamNames = extractPathParamNames(path);
  const inputSchema = operation.inputSchema || { type: 'object', properties: {} };
  const inputProps = (inputSchema.properties || {});
  const inputRequired = new Set(inputSchema.required || []);

  const parameters = [];

  // Path params
  for (const name of pathParamNames) {
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: inputProps[name]?.type
        ? { type: inputProps[name].type, ...(inputProps[name].format ? { format: inputProps[name].format } : {}) }
        : { type: 'string' },
      description: inputProps[name]?.description || `${name} path parameter`
    });
  }

  // Remaining (non-path) params: query for GET, body for write methods
  const remainingPropNames = Object.keys(inputProps).filter((k) => !pathParamNames.includes(k));

  if (upperMethod === 'get' || upperMethod === 'delete') {
    for (const name of remainingPropNames) {
      const prop = inputProps[name];
      parameters.push({
        name,
        in: 'query',
        required: inputRequired.has(name),
        schema: prop
          ? { type: prop.type || 'string', ...(prop.format ? { format: prop.format } : {}), ...(prop.minimum !== undefined ? { minimum: prop.minimum } : {}), ...(prop.maximum !== undefined ? { maximum: prop.maximum } : {}) }
          : { type: 'string' },
        description: prop?.description || `${name} query parameter`
      });
    }
  }

  const opDef = {
    operationId: operation.name,
    summary: summary || operation.title,
    description: operation.description || operation.title,
    tags: Array.isArray(tags) && tags.length ? tags : ['bullgram'],
    security: [{ BearerAuth: [] }],
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: true,
              description: 'Operation-specific result. See operation description.'
            }
          }
        }
      }
    }
  };

  if (parameters.length) opDef.parameters = parameters;

  // Body for write methods
  if (['post', 'put', 'patch'].includes(upperMethod) && remainingPropNames.length) {
    const bodySchema = {
      type: 'object',
      additionalProperties: inputSchema.additionalProperties ?? false,
      properties: {},
      required: remainingPropNames.filter((n) => inputRequired.has(n))
    };
    if (bodySchema.required.length === 0) delete bodySchema.required;
    for (const name of remainingPropNames) {
      bodySchema.properties[name] = jsonSchemaTypeToOpenApi(inputProps[name] || { type: 'string' });
    }
    opDef.requestBody = {
      required: bodySchema.required && bodySchema.required.length > 0,
      content: {
        'application/json': { schema: bodySchema }
      }
    };
  }

  // Standard error responses
  for (const code of STANDARD_ERROR_CODES) {
    opDef.responses[mapMcpErrorToHttp(code)] = { $ref: refForError(code) };
  }

  return { [upperMethod]: opDef };
}

export function buildOpenApiSpec({ baseURL = '', serverUrl = '' } = {}) {
  const restOps = listRestOperations();
  const paths = {};
  const pathCounter = new Map();

  for (const op of restOps) {
    const path = op.transports.rest.path;
    const item = buildPathItem(op);
    if (!paths[path]) {
      paths[path] = item;
    } else {
      // Same path with multiple methods (e.g. GET + POST on /userbots/{id}/messages)
      Object.assign(paths[path], item);
    }
    pathCounter.set(path, (pathCounter.get(path) || 0) + 1);
  }

  // Mount manual routes — these exist on the same router but aren't in the
  // operation registry (they're infrastructural: health, spec discovery, auth smoke).
  Object.assign(paths, buildManualPathItems());

  const servers = [];
  if (serverUrl) {
    servers.push({ url: serverUrl, description: 'Custom' });
  } else if (baseURL) {
    servers.push({ url: baseURL, description: 'Current deployment' });
  } else {
    servers.push({ url: '/api/external/v1', description: 'Default' });
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Bullgram External API',
      version: 'v1',
      description:
        'REST access to Bullgram userbots, dialogs, messages, and proxies. ' +
        'Authenticate with a brapi_ integration token (Bearer header). ' +
        'All operations are also available via MCP at POST /api/mcp.',
      contact: { name: 'Bullgram', url: 'https://bullgram.xyz' }
    },
    servers,
    tags: [
      { name: 'userbots', description: 'Userbot account management and operations' },
      { name: 'proxies', description: 'Managed proxy infrastructure' },
      { name: 'infra', description: 'Account-level summaries' }
    ],
    paths,
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'brapi_',
          description: 'Integration token with purpose=api or custom. Issue at /app/integrations.'
        }
      },
      responses: buildErrorResponses()
    },
    security: [{ BearerAuth: [] }]
  };
}

const SCALAR_HTML = `<!doctype html>
<html>
  <head>
    <title>Bullgram External API — Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='4' fill='%23000'/%3E%3Ctext x='12' y='17' font-family='monospace' font-size='14' fill='%23fff' text-anchor='middle'%3EB%3C/text%3E%3C/svg%3E" />
  </head>
  <body>
    <div id="api-reference" data-url="./openapi.json" data-proxy-url=""></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <noscript>This page requires JavaScript to render the API reference.</noscript>
  </body>
</html>`;

export function renderScalarExplorer() {
  return SCALAR_HTML;
}
