import type { ReactNode } from 'react';

/**
 * DataTable — a reusable, paginated card-based table for the broker portal
 * (R11.1, R19.3).
 *
 * Presentation-only: the parent owns the data fetching and page state and
 * passes the current page slice plus pagination metadata. The table renders a
 * header row, the supplied rows, loading / error / empty states, and a pager
 * that never advances past the reported `totalPages` (page size is capped at
 * 50 per page upstream, R11.1).
 */

/** A single column definition. `render` maps a row to a cell node. */
export interface Column<T> {
  /** Stable key for the column (used for React keys). */
  key: string;
  /** Header label. */
  header: string;
  /** Cell renderer for a row. */
  render: (row: T) => ReactNode;
  /** Optional extra classes applied to the cell + header (e.g. alignment). */
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Stable key for each row. */
  rowKey: (row: T) => string;
  /** 1-based current page. */
  page: number;
  /** Total number of pages (≥1). */
  totalPages: number;
  /** Total row count across all pages (for the summary line). */
  totalCount: number;
  /** Rows per page (≤50, R11.1). */
  pageSize: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
  error?: string | null;
  /** Message shown when there are no rows and no error. */
  emptyMessage?: string;
  /** Optional row click handler (e.g. open a detail view). */
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  page,
  totalPages,
  totalCount,
  pageSize,
  onPageChange,
  isLoading = false,
  error = null,
  emptyMessage = 'No records to display.',
  onRowClick,
}: DataTableProps<T>) {
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const firstRow = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={[
                    'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500',
                    col.className ?? '',
                  ].join(' ')}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-sm text-slate-500"
                >
                  <span role="status" className="inline-flex items-center gap-3">
                    <span
                      className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-[#2563EB]"
                      aria-hidden
                    />
                    Loading…
                  </span>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-sm text-rose-600"
                >
                  <span role="alert">{error}</span>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-sm text-slate-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={[
                    'border-b border-slate-100 last:border-0',
                    onRowClick ? 'cursor-pointer hover:bg-slate-50' : '',
                  ].join(' ')}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={['px-4 py-3 text-slate-700', col.className ?? ''].join(' ')}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pager (R11.1). */}
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <span className="text-xs text-slate-500">
          {totalCount === 0
            ? 'No records'
            : `Showing ${firstRow}–${lastRow} of ${totalCount}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => canPrev && onPageChange(page - 1)}
            disabled={!canPrev || isLoading}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-[#2563EB] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-xs text-slate-500">
            Page {page} of {Math.max(totalPages, 1)}
          </span>
          <button
            type="button"
            onClick={() => canNext && onPageChange(page + 1)}
            disabled={!canNext || isLoading}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-[#2563EB] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export default DataTable;
