import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { searchAccountCodes, getAccountByCode } from '../data/accountCodes';
import { displayName } from '../types/accountCode';
import type { AccountCode } from '../types/accountCode';

interface Props {
  value?: string;
  onChange: (code: AccountCode | null) => void;
  /** Limit to expense / income group */
  group?: string;
  placeholder?: string;
  allowClear?: boolean;
}

/** Type-ahead picker: find and select an account by code. */
export function CodePicker({
  value,
  onChange,
  group,
  placeholder = 'Type code, e.g. P5…',
  allowClear = true,
}: Props) {
  const [query, setQuery] = useState(value ?? '');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value ?? '');
  }, [value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const results = useMemo(
    () => searchAccountCodes(query, { group }).slice(0, 12),
    [query, group],
  );

  const selected = value ? getAccountByCode(value) : undefined;

  function pick(c: AccountCode) {
    setQuery(c.code);
    onChange(c);
    setOpen(false);
  }

  return (
    <div className="code-picker" ref={wrapRef}>
      <div className="search-bar" style={{ marginBottom: 0 }}>
        <Search size={16} />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            const hit = getAccountByCode(e.target.value);
            if (hit && !hit.archived) onChange(hit);
            else if (!e.target.value.trim()) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
        />
        {allowClear && value && (
          <button
            type="button"
            className="text-link"
            style={{ fontSize: 12, border: 'none', background: 'none', cursor: 'pointer' }}
            onClick={() => {
              setQuery('');
              onChange(null);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {selected && (
        <div className="cell-sub" style={{ marginTop: 6 }}>
          {displayName(selected, 'en') || displayName(selected, 'ru')}
          {selected.uzbek ? ` · ${selected.uzbek}` : ''}
        </div>
      )}

      {open && results.length > 0 && (
        <div className="code-picker-menu">
          {results.map((c) => (
            <button key={c.code} type="button" className="code-picker-item" onClick={() => pick(c)}>
              <code>{c.code}</code>
              <span>{displayName(c, 'en') || displayName(c, 'ru')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
