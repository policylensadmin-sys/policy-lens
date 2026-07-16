// Common shared types used across portals.

/** Standard API error body returned by the backend error handler. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** ISO-8601 timestamp string. */
export type Timestamp = string;
