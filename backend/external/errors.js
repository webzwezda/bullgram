// REST API error formatter + Express error handler.
// Plan 02 Phase 1.
//
// Every error that bubbles up from a REST route is normalized to:
//   {
//     error: {
//       code: <ERROR_CODES value or 'INTERNAL_ERROR'>,
//       message: <human-readable>,
//       details?: <object>,
//       retry_after_sec?: <number>,
//       telegram_error_event_id?: <uuid>
//     }
//   }
//
// HTTP status is derived from mapMcpErrorToHttp(code). Defaults to 500.

import { MCPError, ERROR_CODES, mapMcpErrorToHttp } from '../shared/errors.js';

export function buildErrorEnvelope(error) {
  if (error instanceof MCPError) {
    const body = {
      code: error.code,
      message: error.message
    };
    if (error.data) body.details = error.data;
    if (error.retryAfterSec) body.retry_after_sec = error.retryAfterSec;
    if (error.telegramErrorEventId) body.telegram_error_event_id = error.telegramErrorEventId;
    return { error: body };
  }
  // Plain Error or unrecognized shape — never leak internals.
  return {
    error: {
      code: ERROR_CODES.INTERNAL,
      message: process.env.NODE_ENV === 'production'
        ? 'Internal server error.'
        : (error?.message || 'Internal server error.')
    }
  };
}

export function restErrorHandler(err, _req, res, _next) {
  if (res.headersSent) {
    // Delegate to Express default if we already started writing.
    return;
  }
  // Always log — we previously swallowed errors silently in prod, which made
  // debugging external API failures impossible. MCPError carries code/message,
  // everything else is an unexpected throw we want a stack trace for.
  if (err instanceof MCPError) {
    console.error('[external-api]', {
      code: err.code,
      message: err.message,
      data: err.data,
      path: _req?.path,
      method: _req?.method
    });
  } else {
    console.error('[external-api] unexpected error', err);
  }
  const envelope = buildErrorEnvelope(err);
  const code = envelope.error.code;
  const status = mapMcpErrorToHttp(code);
  // Optional: surface Retry-After header for 429s
  if (status === 429 && err?.retryAfterSec) {
    res.setHeader('Retry-After', String(err.retryAfterSec));
  }
  res.status(status).json(envelope);
}
