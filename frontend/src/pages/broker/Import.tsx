import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiClientError } from '../../lib/api';
import { supabase } from '../../lib/supabase';

/**
 * Broker CSV bulk-import page (R — broker "Import Data").
 *
 * A SAFE two-step import flow for a broker's legacy clients & policies:
 *   1. Download a canonical CSV template (authed `fetch` → blob download).
 *   2. Upload / paste a CSV and PREVIEW it (`POST /broker/import/:entity/preview`)
 *      — the backend normalizes + validates (AI-assisted) every row without any
 *      DB writes.
 *   3. Review the per-row result, pick which importable rows to keep, then
 *      COMMIT (`POST /broker/import/:entity/commit`) the accepted rows' `data`
 *      objects. Invalid rows can never be selected or imported.
 *
 * Styling matches the broker portal: white cards, slate text, indigo (#2563EB)
 * accents, and it is fully mobile responsive (tables wrap in overflow-x-auto).
 */

type ImportEntity = 'clients' | 'policies';

type RowStatus = 'valid' | 'fixed' | 'invalid';

interface PreviewRow {
  index: number;
  raw: Record<string, string>;
  data: Record<string, unknown> | null;
  status: RowStatus;
  aiFixed: boolean;
  notes: string[];
  errors: string[];
}

interface PreviewResult {
  entity: ImportEntity;
  rows: PreviewRow[];
  summary: { total: number; valid: number; fixed: number; invalid: number };
}

interface CommitResult {
  inserted: number;
  failed: Array<{ index: number; reason: string }>;
}

/** Base URL used for the authed template download (mirrors the api client). */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

/** Key fields surfaced in the preview table per entity, in display order. */
const KEY_FIELDS: Record<ImportEntity, { key: string; label: string }[]> = {
  clients: [
    { key: 'fullName', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
  ],
  policies: [
    { key: 'clientEmail', label: 'Client email' },
    { key: 'policyType', label: 'Type' },
    { key: 'insurer', label: 'Insurer' },
    { key: 'startDate', label: 'Start' },
    { key: 'endDate', label: 'End' },
    { key: 'premiumAmount', label: 'Premium' },
    { key: 'status', label: 'Status' },
  ],
};

/** Read a display value from a row's parsed `data`, falling back to `raw`. */
function fieldValue(row: PreviewRow, key: string): string {
  const fromData = row.data?.[key];
  if (fromData !== undefined && fromData !== null && fromData !== '') {
    return String(fromData);
  }
  const fromRaw = row.raw?.[key];
  return fromRaw !== undefined && fromRaw !== '' ? String(fromRaw) : '—';
}

/** A row is importable when it is valid or was AI-fixed (never when invalid). */
function isImportable(row: PreviewRow): boolean {
  return row.status !== 'invalid' && row.data !== null;
}

const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';

const secondaryButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-[#2563EB] hover:text-[#2563EB] disabled:cursor-not-allowed disabled:opacity-50';

export function Import() {
  const [entity, setEntity] = useState<ImportEntity>('clients');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Reset everything downstream of the CSV input (preview + commit state). */
  function resetResults() {
    setPreview(null);
    setSelected({});
    setPreviewError(null);
    setCommitResult(null);
    setCommitError(null);
  }

  /** Switch the target entity, clearing any stale preview for the old entity. */
  function switchEntity(next: ImportEntity) {
    if (next === entity) return;
    setEntity(next);
    resetResults();
  }

  /** Download the canonical CSV template with the auth token attached. */
  async function handleDownloadTemplate() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch(
        `${API_BASE_URL}/broker/import/${entity}/template`,
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
      );
      if (!response.ok) {
        throw new Error(`Download failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${entity}-import-template.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError('We could not download the template. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  /** Read a chosen `.csv` file as text into the CSV textarea. */
  async function handleFile(file: File | undefined | null) {
    if (!file) return;
    setFileName(file.name);
    resetResults();
    try {
      const text = await file.text();
      setCsv(text);
    } catch {
      setPreviewError('We could not read that file. Please try another CSV.');
    }
  }

  function onDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    void handleFile(file);
  }

  /** Preview the CSV: normalize + validate server-side (no DB writes). */
  async function handlePreview() {
    if (!csv.trim()) {
      setPreviewError('Add a CSV file or paste some rows first.');
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    setCommitResult(null);
    setCommitError(null);
    try {
      const result = await api.post<PreviewResult>(
        `/broker/import/${entity}/preview`,
        { csv },
      );
      setPreview(result);
      // Default: all importable (valid + AI-fixed) rows are checked.
      const defaults: Record<number, boolean> = {};
      for (const row of result.rows) {
        if (isImportable(row)) defaults[row.index] = true;
      }
      setSelected(defaults);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'We could not preview this CSV. Please try again.';
      setPreviewError(message);
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  const importableRows = useMemo(
    () => (preview ? preview.rows.filter(isImportable) : []),
    [preview],
  );

  const selectedRows = useMemo(
    () => importableRows.filter((row) => selected[row.index]),
    [importableRows, selected],
  );

  const allSelected =
    importableRows.length > 0 && selectedRows.length === importableRows.length;

  function toggleRow(index: number) {
    setSelected((prev) => ({ ...prev, [index]: !prev[index] }));
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<number, boolean> = {};
      for (const row of importableRows) next[row.index] = true;
      setSelected(next);
    }
  }

  /** Commit the accepted rows' `data` objects; backend re-validates each row. */
  async function handleCommit() {
    if (selectedRows.length === 0) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const rows = selectedRows.map((row) => row.data).filter(Boolean);
      const result = await api.post<CommitResult>(
        `/broker/import/${entity}/commit`,
        { rows },
      );
      setCommitResult(result);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : 'We could not import these rows. Please try again.';
      setCommitError(message);
    } finally {
      setCommitting(false);
    }
  }

  /** Clear the whole flow to import another file. */
  function startOver() {
    setCsv('');
    setFileName(null);
    resetResults();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold text-slate-900">Import data</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Bulk import your existing clients &amp; policies from a CSV. Messy data is
          auto-checked (and AI-assisted); nothing invalid gets imported.
        </p>
      </header>

      {/* Step 1 — choose entity + download template. */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              What are you importing?
            </span>
            <div
              role="tablist"
              aria-label="Import entity"
              className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1"
            >
              {(['clients', 'policies'] as ImportEntity[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={entity === value}
                  onClick={() => switchEntity(value)}
                  className={[
                    'rounded-md px-4 py-1.5 text-sm font-medium capitalize transition',
                    entity === value
                      ? 'bg-[#2563EB] text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900',
                  ].join(' ')}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              onClick={() => void handleDownloadTemplate()}
              disabled={downloading}
              className={secondaryButtonClass}
            >
              {downloading ? 'Preparing…' : `Download ${entity} template`}
            </button>
            {downloadError && (
              <p role="alert" className="text-xs text-rose-600">
                {downloadError}
              </p>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Not sure about the format? Download the template, fill in your rows, and upload
          it below.
        </p>
      </section>

      {/* Step 2 — upload / paste CSV + preview. */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Upload or paste your CSV</h2>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition hover:border-[#2563EB]"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <span className="text-sm font-medium text-slate-700">
            {fileName ? fileName : 'Drop a .csv file here or click to browse'}
          </span>
          <span className="text-xs text-slate-400">CSV files only</span>
        </label>

        <div className="flex flex-col gap-1">
          <label htmlFor="csv-input" className="text-xs font-medium text-slate-600">
            …or paste CSV content
          </label>
          <textarea
            id="csv-input"
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              resetResults();
            }}
            rows={5}
            placeholder="fullName,email,phone&#10;Ravi Kumar,ravi@example.com,+91 98200 11111"
            className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
          />
        </div>

        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={previewing || !csv.trim()}
            className={primaryButtonClass}
          >
            {previewing ? 'Checking…' : 'Preview'}
          </button>
          {csv && (
            <button type="button" onClick={startOver} className={secondaryButtonClass}>
              Clear
            </button>
          )}
        </div>
        {previewError && (
          <p role="alert" className="text-sm text-rose-600">
            {previewError}
          </p>
        )}
      </section>

      {/* Step 3 — preview result + commit. */}
      {preview && !commitResult && (
        <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Preview</h2>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold text-emerald-600">
                {preview.summary.valid} valid
              </span>
              <span className="text-slate-300">·</span>
              <span className="font-semibold text-amber-600">
                {preview.summary.fixed} AI-fixed
              </span>
              <span className="text-slate-300">·</span>
              <span className="font-semibold text-rose-600">
                {preview.summary.invalid} invalid
              </span>
            </p>
          </div>

          {importableRows.length > 0 && (
            <label className="inline-flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
              />
              Select all importable rows
            </label>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="w-10 px-3 py-2" scope="col">
                    <span className="sr-only">Include</span>
                  </th>
                  <th className="w-12 px-3 py-2" scope="col">
                    #
                  </th>
                  {KEY_FIELDS[preview.entity].map((f) => (
                    <th key={f.key} className="px-3 py-2" scope="col">
                      {f.label}
                    </th>
                  ))}
                  <th className="px-3 py-2" scope="col">
                    Status
                  </th>
                  <th className="px-3 py-2" scope="col">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.rows.map((row) => {
                  const importable = isImportable(row);
                  return (
                    <tr
                      key={row.index}
                      className={row.status === 'invalid' ? 'bg-rose-50/40' : undefined}
                    >
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Include row ${row.index + 1}`}
                          checked={Boolean(selected[row.index])}
                          disabled={!importable}
                          onChange={() => toggleRow(row.index)}
                          className="h-4 w-4 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB] disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </td>
                      <td className="px-3 py-2 align-top text-slate-400">{row.index + 1}</td>
                      {KEY_FIELDS[preview.entity].map((f) => (
                        <td key={f.key} className="px-3 py-2 align-top text-slate-700">
                          {fieldValue(row, f.key)}
                        </td>
                      ))}
                      <td className="px-3 py-2 align-top">
                        <StatusBadge status={row.status} aiFixed={row.aiFixed} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        {row.status === 'invalid' && row.errors.length > 0 && (
                          <ul className="list-disc space-y-0.5 pl-4 text-xs text-rose-600">
                            {row.errors.map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        )}
                        {row.status === 'fixed' && row.notes.length > 0 && (
                          <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-700">
                            {row.notes.map((n, i) => (
                              <li key={i}>{n}</li>
                            ))}
                          </ul>
                        )}
                        {row.status === 'valid' && (
                          <span className="text-xs text-slate-400">Ready to import</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col items-start gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              {selectedRows.length} of {importableRows.length} importable row
              {importableRows.length === 1 ? '' : 's'} selected.
            </p>
            <button
              type="button"
              onClick={() => void handleCommit()}
              disabled={committing || selectedRows.length === 0}
              className={primaryButtonClass}
            >
              {committing
                ? 'Importing…'
                : `Import ${selectedRows.length} row${selectedRows.length === 1 ? '' : 's'}`}
            </button>
          </div>
          {commitError && (
            <p role="alert" className="text-sm text-rose-600">
              {commitError}
            </p>
          )}
        </section>
      )}

      {/* Success summary. */}
      {commitResult && (
        <section className="flex flex-col gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-emerald-800">Import complete</h2>
            <p className="text-sm text-emerald-700">
              Imported {commitResult.inserted}. Skipped {commitResult.failed.length}.
            </p>
          </div>

          {commitResult.failed.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-white p-4">
              <p className="mb-2 text-sm font-medium text-slate-700">Skipped rows</p>
              <ul className="space-y-1 text-xs text-slate-600">
                {commitResult.failed.map((f) => (
                  <li key={f.index}>
                    <span className="font-medium text-slate-800">Row {f.index + 1}:</span>{' '}
                    {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={startOver} className={primaryButtonClass}>
              Import another file
            </button>
            <Link to="/broker/clients" className={secondaryButtonClass}>
              Go to Clients
            </Link>
            <Link to="/broker/policies" className={secondaryButtonClass}>
              Go to Policies
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

/** Per-row status pill: green (valid), amber "AI-fixed" (fixed), red (invalid). */
function StatusBadge({ status, aiFixed }: { status: RowStatus; aiFixed: boolean }) {
  if (status === 'valid') {
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
        Valid
      </span>
    );
  }
  if (status === 'fixed') {
    return (
      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
        {aiFixed ? 'AI-fixed' : 'Fixed'}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
      Invalid
    </span>
  );
}

export default Import;
