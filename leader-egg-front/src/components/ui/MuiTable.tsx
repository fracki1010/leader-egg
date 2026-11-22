import { useState, useMemo, type MouseEvent } from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Paper from '@mui/material/Paper';
import type { SxProps, Theme } from '@mui/material/styles';

export interface Column<T> {
  id: keyof T & string;
  label: string;
  sortable?: boolean;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
  sx?: SxProps<Theme>;
}

export interface MuiTableProps<T extends { _id?: string; id?: string }> {
  columns: Column<T>[];
  rows: T[];
  /** Unique key getter — defaults to row._id || row.id */
  rowKey?: (row: T) => string;
  /** Custom sx for the TableContainer */
  containerSx?: SxProps<Theme>;
  /** Mouse convenience: called when a clickable row is clicked (nested controls are ignored). */
  onRowClick?: (row: T) => void;
  /** Marks a row as clickable. Defaults to true for every row when onRowClick is provided. */
  isRowClickable?: (row: T) => boolean;
}

type Order = 'asc' | 'desc';

/**
 * M3 DataTable wrapper — sortable columns over MUI Table.
 * Lightweight alternative to DataGrid (~40KB) for simple tables.
 */
export function MuiTable<T extends { _id?: string; id?: string }>({
  columns,
  rows,
  rowKey,
  containerSx,
  onRowClick,
  isRowClickable,
}: MuiTableProps<T>) {
  const [orderBy, setOrderBy] = useState<string>('');
  const [order, setOrder] = useState<Order>('asc');

  const handleSort = (columnId: string) => {
    const isAsc = orderBy === columnId && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(columnId);
  };

  const sortedRows = useMemo(() => {
    if (!orderBy) return rows;
    return [...rows].sort((a, b) => {
      const aVal = a[orderBy as keyof T];
      const bVal = b[orderBy as keyof T];
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return order === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const cmp = String(aVal).localeCompare(String(bVal));
      return order === 'asc' ? cmp : -cmp;
    });
  }, [rows, orderBy, order]);

  const getKey = rowKey ?? ((row: T) => (row._id ?? row.id ?? Math.random().toString()) as string);

  return (
    <TableContainer component={Paper} sx={containerSx}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell key={col.id} sx={{ fontWeight: 600, ...col.sx }}>
                {col.sortable ? (
                  <TableSortLabel
                    active={orderBy === col.id}
                    direction={orderBy === col.id ? order : 'asc'}
                    onClick={() => handleSort(col.id)}
                  >
                    {col.label}
                  </TableSortLabel>
                ) : (
                  col.label
                )}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedRows.map((row) => {
            const clickable = onRowClick ? (isRowClickable ? isRowClickable(row) : true) : false;

            return (
              <TableRow
                key={getKey(row)}
                onClick={
                  clickable
                    ? (event: MouseEvent<HTMLTableRowElement>) => {
                        // Let nested links/controls handle their own click instead of
                        // swallowing it with the row navigation.
                        const target = event.target as HTMLElement;
                        if (target.closest('a, button, input, select, textarea, [role="button"], [role="link"]')) {
                          return;
                        }
                        onRowClick?.(row);
                      }
                    : undefined
                }
                sx={clickable ? { cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } } : undefined}
              >
                {columns.map((col) => (
                  <TableCell key={col.id} sx={col.sx}>
                    {col.render
                      ? col.render(row[col.id], row)
                      : (row[col.id] as React.ReactNode) ?? '—'}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
