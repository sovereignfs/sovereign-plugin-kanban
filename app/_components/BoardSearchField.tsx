'use client';

import { Button, Icon, Input } from '@sovereignfs/ui';
import styles from '../kanban.module.css';

/**
 * Board header search/filter (K.10) — a controlled input; `BoardView` owns
 * the query state and does the actual filtering (client-side only, see its
 * own comment for the design decisions this drives).
 */
export function BoardSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.searchField}>
      <Icon name="search" size="sm" aria-hidden={true} className={styles.searchIcon} />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search cards…"
        aria-label="Search cards"
        className={styles.searchInput}
      />
      {value && (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Clear search"
          className={styles.searchClear}
          onClick={() => onChange('')}
        >
          <Icon name="x" size="sm" aria-hidden={true} />
        </Button>
      )}
    </div>
  );
}
