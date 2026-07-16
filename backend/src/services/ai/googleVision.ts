// Google Vision OCR provider (R2.2, R2.5, R2.6).
//
// Implements the provider-agnostic OCRProvider contract on top of Google Cloud
// Vision's DOCUMENT_TEXT_DETECTION. Two credential styles are supported and
// selected automatically:
//
//   - GOOGLE_VISION_API_KEY .......... REST API keyed requests (no SDK auth).
//   - GOOGLE_APPLICATION_CREDENTIALS . service-account JSON via the
//                                       @google-cloud/vision SDK (dynamically
//                                       imported so the package is only loaded
//                                       when Google OCR is actually selected).
//
// Behaviour:
//   - Images (JPEG/PNG) are annotated as a single page.
//   - PDFs are annotated via file annotation, preserving page order and
//     per-page text/boundaries (R2.4).
//   - An overall recognition confidence is computed from Vision's per-page
//     confidence scores so the parser can apply the < 60% low-confidence rule
//     (R2.5).
//   - Network calls are wrapped with `callWithResilience` (timeout + one
//     retry); a hard failure or an API error response throws so the parser can
//     surface a temporary-failure/retry state (R2.6).

import { readAiEnv } from '../../config/env';
import { callWithResilience } from './net';
import type { OCRProvider, OcrPage, OcrResult } from './types';

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

/** Vision feature used for dense document text (better for policy docs). */
const FEATURE_TYPE = 'DOCUMENT_TEXT_DETECTION';
/** REST endpoint for annotating raw images. */
const IMAGES_ANNOTATE_URL = 'https://vision.googleapis.com/v1/images:annotate';
/** REST endpoint for annotating files (e.g. PDFs) synchronously. */
const FILES_ANNOTATE_URL = 'https://vision.googleapis.com/v1/files:annotate';
/**
 * Confidence used when Vision extracted text but reported no per-page
 * confidence. Treated as acceptable (above the 60% floor) so we don't falsely
 * flag a successful extraction as low-quality.
 */
const CONFIDENCE_WHEN_UNKNOWN = 0.9;

/** Supported image MIME types (single-page annotation). */
const IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
/** Supported PDF MIME type (multi-page file annotation). */
const PDF_MIME = 'application/pdf';

// ---------------------------------------------------------------------------
// Minimal Vision response shapes (only the fields we read).
// ---------------------------------------------------------------------------

interface VisionPage {
  confidence?: number | null;
}

interface VisionFullTextAnnotation {
  text?: string | null;
  pages?: VisionPage[] | null;
}

interface VisionStatus {
  code?: number | null;
  message?: string | null;
}

/** Response for a single image (or a single page within a file). */
interface VisionImageResponse {
  fullTextAnnotation?: VisionFullTextAnnotation | null;
  error?: VisionStatus | null;
}

/** `images:annotate` response body. */
interface ImagesAnnotateResponse {
  responses?: VisionImageResponse[] | null;
}

/** Per-file response inside a `files:annotate` result (one entry per page). */
interface VisionFileResponse {
  responses?: VisionImageResponse[] | null;
  totalPages?: number | null;
  error?: VisionStatus | null;
}

/** `files:annotate` response body. */
interface FilesAnnotateResponse {
  responses?: VisionFileResponse[] | null;
}

/** Loosely-typed surface of the SDK client we depend on. */
interface ImageAnnotatorClientLike {
  documentTextDetection(request: unknown): Promise<[VisionImageResponse, ...unknown[]]>;
  batchAnnotateFiles(request: unknown): Promise<[FilesAnnotateResponse, ...unknown[]]>;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

/** Thrown when Google Vision returns an error status or an unusable response. */
export class GoogleVisionError extends Error {
  constructor(message: string) {
    super(`Google Vision OCR failed: ${message}`);
    this.name = 'GoogleVisionError';
  }
}

// ---------------------------------------------------------------------------
// Provider.
// ---------------------------------------------------------------------------

/** Options for {@link GoogleVisionOCRProvider}. */
export interface GoogleVisionOptions {
  /** API key for keyed REST requests (`GOOGLE_VISION_API_KEY`). */
  apiKey?: string;
  /** Service-account JSON path (`GOOGLE_APPLICATION_CREDENTIALS`), used via SDK. */
  credentialsPath?: string;
  /** Per-attempt timeout in ms (defaults to the resilience helper default). */
  timeoutMs?: number;
  /** Retries after the first attempt (defaults to the resilience helper default). */
  retries?: number;
}

/**
 * Google Vision-backed OCR provider. Prefers the API-key REST path when a key
 * is present; otherwise uses the service-account SDK client.
 */
export class GoogleVisionOCRProvider implements OCRProvider {
  private readonly apiKey?: string;
  private readonly credentialsPath?: string;
  private readonly timeoutMs?: number;
  private readonly retries?: number;

  /** Lazily-constructed SDK client (only when using the service-account path). */
  private sdkClient?: ImageAnnotatorClientLike;

  constructor(options: GoogleVisionOptions = {}) {
    this.apiKey = options.apiKey;
    this.credentialsPath = options.credentialsPath;
    this.timeoutMs = options.timeoutMs;
    this.retries = options.retries;

    if (!this.apiKey && !this.credentialsPath) {
      throw new Error(
        'GoogleVisionOCRProvider requires GOOGLE_VISION_API_KEY or GOOGLE_APPLICATION_CREDENTIALS.',
      );
    }
  }

  async extract(file: Buffer, mime: string): Promise<OcrResult> {
    const normalized = mime.trim().toLowerCase();

    if (IMAGE_MIMES.has(normalized)) {
      const page = await this.annotateImage(file);
      return toResult([page]);
    }

    if (normalized === PDF_MIME) {
      const pages = await this.annotatePdf(file);
      return toResult(pages);
    }

    throw new GoogleVisionError(`unsupported MIME type "${mime}".`);
  }

  // --- Image (single page) -------------------------------------------------

  private async annotateImage(file: Buffer): Promise<PageText> {
    const content = file.toString('base64');

    if (this.apiKey) {
      const body = {
        requests: [{ image: { content }, features: [{ type: FEATURE_TYPE }] }],
      };
      const json = await this.postJson<ImagesAnnotateResponse>(
        IMAGES_ANNOTATE_URL,
        body,
        'images:annotate',
      );
      const response = json.responses?.[0];
      if (!response) throw new GoogleVisionError('empty image annotation response.');
      return imageResponseToPage(response);
    }

    const client = await this.getSdkClient();
    const [response] = await this.run('documentTextDetection', () =>
      client.documentTextDetection({ image: { content } }),
    );
    return imageResponseToPage(response);
  }

  // --- PDF (multi-page) ----------------------------------------------------

  private async annotatePdf(file: Buffer): Promise<PageText[]> {
    const content = file.toString('base64');

    if (this.apiKey) {
      const body = {
        requests: [
          {
            inputConfig: { content, mimeType: PDF_MIME },
            features: [{ type: FEATURE_TYPE }],
          },
        ],
      };
      const json = await this.postJson<FilesAnnotateResponse>(
        FILES_ANNOTATE_URL,
        body,
        'files:annotate',
      );
      return fileResponseToPages(json.responses?.[0]);
    }

    const client = await this.getSdkClient();
    const [result] = await this.run('batchAnnotateFiles', () =>
      client.batchAnnotateFiles({
        requests: [
          {
            inputConfig: { content, mimeType: PDF_MIME },
            features: [{ type: FEATURE_TYPE }],
          },
        ],
      }),
    );
    return fileResponseToPages(result.responses?.[0]);
  }

  // --- Transport helpers ---------------------------------------------------

  /** POST JSON to a keyed Vision REST endpoint, with timeout + retry. */
  private async postJson<T>(url: string, body: unknown, label: string): Promise<T> {
    return this.run(label, async () => {
      const response = await fetch(`${url}?key=${encodeURIComponent(this.apiKey ?? '')}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const detail = await safeText(response);
        throw new GoogleVisionError(`HTTP ${response.status} ${response.statusText}. ${detail}`);
      }
      return (await response.json()) as T;
    });
  }

  /** Wrap a single logical Vision call with timeout + one retry. */
  private run<T>(label: string, task: () => Promise<T>): Promise<T> {
    return callWithResilience(task, {
      label: `googleVision.${label}`,
      timeoutMs: this.timeoutMs,
      retries: this.retries,
    });
  }

  /** Lazily import and construct the SDK client (service-account path). */
  private async getSdkClient(): Promise<ImageAnnotatorClientLike> {
    if (this.sdkClient) return this.sdkClient;
    const mod = (await import('@google-cloud/vision')) as unknown as {
      default?: { ImageAnnotatorClient: new (opts?: unknown) => ImageAnnotatorClientLike };
      ImageAnnotatorClient?: new (opts?: unknown) => ImageAnnotatorClientLike;
    };
    const Ctor = mod.ImageAnnotatorClient ?? mod.default?.ImageAnnotatorClient;
    if (!Ctor) {
      throw new GoogleVisionError('unable to load @google-cloud/vision ImageAnnotatorClient.');
    }
    // When set, the SDK reads GOOGLE_APPLICATION_CREDENTIALS from the env; pass
    // an explicit keyFilename too so the intent is clear and testable.
    this.sdkClient = new Ctor(
      this.credentialsPath ? { keyFilename: this.credentialsPath } : undefined,
    );
    return this.sdkClient;
  }
}

// ---------------------------------------------------------------------------
// Response mapping.
// ---------------------------------------------------------------------------

/** Intermediate per-page text + optional confidence before numbering. */
interface PageText {
  text: string;
  confidence?: number;
}

/** Map a single image/page response to page text, surfacing API errors. */
function imageResponseToPage(response: VisionImageResponse): PageText {
  if (response.error?.code) {
    throw new GoogleVisionError(response.error.message ?? `status code ${response.error.code}.`);
  }
  const annotation = response.fullTextAnnotation;
  return {
    text: annotation?.text ?? '',
    confidence: pageConfidence(annotation?.pages ?? undefined),
  };
}

/** Map a file (PDF) response to an ordered list of page texts. */
function fileResponseToPages(file: VisionFileResponse | null | undefined): PageText[] {
  if (!file) throw new GoogleVisionError('empty file annotation response.');
  if (file.error?.code) {
    throw new GoogleVisionError(file.error.message ?? `status code ${file.error.code}.`);
  }
  const responses = file.responses ?? [];
  if (responses.length === 0) {
    throw new GoogleVisionError('file annotation returned no pages.');
  }
  // `responses` are already ordered per input page; preserve that order.
  return responses.map(imageResponseToPage);
}

/** Average the per-page confidences Vision reports for one image/page. */
function pageConfidence(pages: VisionPage[] | undefined): number | undefined {
  if (!pages || pages.length === 0) return undefined;
  const values = pages
    .map((p) => p.confidence)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  if (values.length === 0) return undefined;
  const sum = values.reduce((acc, c) => acc + c, 0);
  return clamp01(sum / values.length);
}

/** Assemble the final {@link OcrResult}, numbering pages and scoring overall. */
function toResult(pages: PageText[]): OcrResult {
  const ocrPages: OcrPage[] = pages.map((p, i) => ({
    page: i + 1,
    text: p.text,
    ...(p.confidence !== undefined ? { confidence: p.confidence } : {}),
  }));
  return {
    text: pages.map((p) => p.text).join('\n\n'),
    pages: ocrPages,
    confidence: overallConfidence(pages),
  };
}

/**
 * Overall confidence: page confidences weighted by extracted text length so a
 * short low-confidence page can't dominate a long clean one. Falls back to a
 * neutral value when Vision reports no confidences but text was extracted, and
 * to 0 when nothing was extracted.
 */
function overallConfidence(pages: PageText[]): number {
  let weightSum = 0;
  let confWeightSum = 0;
  for (const p of pages) {
    if (p.confidence === undefined) continue;
    const weight = Math.max(p.text.length, 1);
    weightSum += weight;
    confWeightSum += weight * p.confidence;
  }
  if (weightSum > 0) return clamp01(confWeightSum / weightSum);

  const hasText = pages.some((p) => p.text.trim().length > 0);
  return hasText ? CONFIDENCE_WHEN_UNKNOWN : 0;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Read a response body as text without throwing (for error detail). */
async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Factory (used by `factory.ts`).
// ---------------------------------------------------------------------------

/**
 * Build the live Google Vision OCR provider from configuration. The factory
 * only selects this adapter when at least one credential style is present.
 */
export function createGoogleVisionOCRProvider(): OCRProvider {
  const env = readAiEnv();
  return new GoogleVisionOCRProvider({
    apiKey: env.googleVisionApiKey,
    credentialsPath: env.googleApplicationCredentials,
  });
}
