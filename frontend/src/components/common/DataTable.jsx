import React, { useMemo, useState } from 'react';
import './DataTable.css';

/**
 * Generic management-table matching flexiWAN 6.5.1's list pages (filter bar,
 * sortable columns, checkbox selection, pagination + page-size + count badge).
 *
 * columns: [{ key, label, render?: (row) => node, sortable？: bool, sortValue?: (row) => number|string }]
 * rows: array of data objects (must have a stable `_id` or `id`)
 */
const DataTable = ({
  columns,
  rows,
  rowKey = (row) => row._id || row.id,
  selectable = false,
  selected = [],
  onSelectionChange,
  filterPlaceholder = 'Add filter',
  actions,
  emptyMessage = 'No results',
  defaultPageSize = 10,
}) => {
  const [filterText, setFilterText] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const filteredRows = useMemo(() => {
    if (!filterText.trim()) return rows;
    const needle = filterText.toLowerCase();
    return rows.filter((row) =>
      columns.some((col) => {
        const val = col.render ? col.render(row) : row[col.key];
        return String(val ?? '').toLowerCase().includes(needle);
      })
    );
  }, [rows, filterText, columns]);

  const sortedRows = useMemo(() => {
    if (!sort.key) return filteredRows;
    const col = columns.find((c) => c.key === sort.key);
    const getVal = col?.sortValue || ((row) => row[sort.key]);
    return [...filteredRows].sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * sort.dir;
    });
  }, [filteredRows, sort, columns]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const allOnPageSelected = selectable && pageRows.length > 0 &&
    pageRows.every((row) => selected.includes(rowKey(row)));

  const toggleSort = (col) => {
    if (!col.sortable) return;
    setSort((prev) => (prev.key === col.key
      ? { key: col.key, dir: -prev.dir }
      : { key: col.key, dir: 1 }));
  };

  const toggleRow = (key) => {
    if (!onSelectionChange) return;
    onSelectionChange(selected.includes(key)
      ? selected.filter((k) => k !== key)
      : [...selected, key]);
  };

  const toggleAllOnPage = () => {
    if (!onSelectionChange) return;
    const pageKeys = pageRows.map(rowKey);
    onSelectionChange(allOnPageSelected
      ? selected.filter((k) => !pageKeys.includes(k))
      : [...new Set([...selected, ...pageKeys])]);
  };

  return (
    <div className="datatable">
      <div className="datatable-toolbar">
        {actions && <div className="datatable-actions">{actions}</div>}
        <div className="datatable-filter-bar">
          <input
            type="text"
            className="form-control datatable-filter-input"
            placeholder={filterPlaceholder}
            value={filterText}
            onChange={(e) => { setFilterText(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      <div className="datatable-container">
        <table className="table datatable-table">
          <thead>
            <tr>
              {selectable && (
                <th className="datatable-checkbox-col">
                  <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={col.sortable ? 'datatable-sortable' : ''}
                  onClick={() => toggleSort(col)}
                >
                  {col.label}
                  {col.sortable && sort.key === col.key && (
                    <span className="datatable-sort-arrow">{sort.dir === 1 ? ' ▲' : ' ▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="datatable-empty">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {pageRows.map((row) => {
              const key = rowKey(row);
              return (
                <tr key={key} className={selected.includes(key) ? 'datatable-row-selected' : ''}>
                  {selectable && (
                    <td className="datatable-checkbox-col">
                      <input
                        type="checkbox"
                        checked={selected.includes(key)}
                        onChange={() => toggleRow(key)}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key}>{col.render ? col.render(row) : row[col.key]}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="datatable-footer">
        <select
          className="form-control datatable-pagesize"
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
        >
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="datatable-summary">
          Showing {sortedRows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
          {Math.min(currentPage * pageSize, sortedRows.length)} of {sortedRows.length} Results
        </span>
        <div className="datatable-pagination">
          <button type="button" disabled={currentPage === 1} onClick={() => setPage(1)}>First</button>
          <button type="button" disabled={currentPage === 1} onClick={() => setPage((p) => p - 1)}>Back</button>
          <span className="datatable-pagecount">{currentPage - 1}</span>
          <button type="button" disabled={currentPage === totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(totalPages)}>Last</button>
        </div>
      </div>
    </div>
  );
};

export default DataTable;
