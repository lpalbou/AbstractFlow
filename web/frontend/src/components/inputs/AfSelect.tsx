import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';

export interface AfSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  reason?: string;
}

export interface AfSelectProps {
  value: string;
  options: AfSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  allowCustom?: boolean;
  clearable?: boolean;
  minPopoverWidth?: number;
  variant?: 'pin' | 'panel';
  onOpen?: () => void;
  customOptionLabel?: (value: string) => string;
  validateCustomValue?: (value: string, context: { options: AfSelectOption[] }) => string | null | undefined;
  onChange: (value: string) => void;
}

export function AfSelect({
  value,
  options,
  placeholder = 'Select…',
  disabled = false,
  loading = false,
  searchable = true,
  searchPlaceholder = 'Search…',
  allowCustom = false,
  clearable = false,
  minPopoverWidth = 240,
  variant = 'panel',
  onOpen,
  customOptionLabel,
  validateCustomValue,
  onChange,
}: AfSelectProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const onOpenRef = useRef(onOpen);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');
  const [pos, setPos] = useState<{ left: number; top: number; width: number }>({ left: 0, top: 0, width: 0 });

  const optionsWithCurrent = useMemo(() => {
    const clean = typeof value === 'string' ? value.trim() : '';
    if (!clean || options.some((o) => o.value === clean)) return options;
    return [...options, { value: clean, label: clean }];
  }, [options, value]);

  const selectedLabel = useMemo(() => {
    const found = optionsWithCurrent.find((o) => o.value === value);
    return found?.label || value || '';
  }, [optionsWithCurrent, value]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return optionsWithCurrent;
    return optionsWithCurrent.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [optionsWithCurrent, search]);

  const customOption = useMemo<AfSelectOption | null>(() => {
    if (!allowCustom) return null;
    const q = search.trim();
    if (!q) return null;
    const exists = optionsWithCurrent.some((o) => o.value === q);
    if (exists) return null;
    const reason = validateCustomValue?.(q, { options: optionsWithCurrent }) || '';
    return {
      value: q,
      label: customOptionLabel ? customOptionLabel(q) : `Use "${q}"`,
      disabled: Boolean(reason),
      reason,
    };
  }, [allowCustom, customOptionLabel, optionsWithCurrent, search, validateCustomValue]);

  const visibleOptions = useMemo<AfSelectOption[]>(() => {
    if (!customOption) return filtered;
    return [customOption, ...filtered];
  }, [customOption, filtered]);

  const displayedOptions = useMemo<AfSelectOption[]>(() => {
    if (visibleOptions.length > 0) return visibleOptions;
    const clean = value.trim();
    if (!loading || !clean) return visibleOptions;
    return [{ value: clean, label: selectedLabel || clean }];
  }, [loading, selectedLabel, value, visibleOptions]);

  const recalcPosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(rect.width, minPopoverWidth);

    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const availableBelow = window.innerHeight - rect.bottom;
    const availableAbove = rect.top;
    const nextPlacement: 'bottom' | 'top' = availableBelow >= 220 || availableBelow >= availableAbove ? 'bottom' : 'top';
    setPlacement(nextPlacement);

    const top = nextPlacement === 'bottom' ? rect.bottom + 6 : rect.top - 6;
    setPos({ left, top, width });
  }, [minPopoverWidth]);

  const close = useCallback(() => {
    setOpen(false);
    setSearch('');
  }, []);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    if (!open) return;
    onOpenRef.current?.();
    recalcPosition();
    const onResize = () => recalcPosition();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, recalcPosition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(
      0,
      displayedOptions.findIndex((o) => o.value === value)
    );
    setHighlightIdx(idx === -1 ? 0 : idx);
    // Focus search for fast typing
    if (searchable) {
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [displayedOptions, open, searchable, value]);

  const pick = (v: string) => {
    const option = displayedOptions.find((o) => o.value === v);
    if (option?.disabled) return;
    onChange(v);
    close();
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((x) => !x);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onPopoverKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, Math.max(0, displayedOptions.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const opt = displayedOptions[highlightIdx];
      if (opt) pick(opt.value);
    }
  };

  const showValue = Boolean(value);
  const triggerText = showValue ? selectedLabel : placeholder;
  const customError = customOption?.disabled ? customOption.reason || 'Unavailable' : '';

  return (
    <span className={clsx('af-select', variant === 'pin' ? 'af-select--pin' : 'af-select--panel')}>
      <button
        ref={triggerRef}
        type="button"
        className="af-select-trigger"
        disabled={disabled}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          setOpen((x) => !x);
        }}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={clsx('af-select-value', !showValue && 'af-select-value--placeholder')}>
          {loading && !showValue ? 'Loading…' : triggerText}
        </span>

        {clearable && showValue ? (
          <span
            className="af-select-clear"
            role="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange('');
              close();
            }}
            title="Clear"
          >
            ×
          </span>
        ) : null}

        <span className={clsx('af-select-caret', open && 'af-select-caret--open')}>▾</span>
      </button>

      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className={clsx('af-select-popover', placement === 'top' && 'af-select-popover--top')}
              style={{
                position: 'fixed',
                left: `${pos.left}px`,
                top: `${pos.top}px`,
                width: `${pos.width}px`,
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              onKeyDown={onPopoverKeyDown}
              role="listbox"
              tabIndex={-1}
            >
              {searchable ? (
                <div className="af-select-search">
                  <input
                    ref={searchRef}
                    className="af-select-search-input"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={searchPlaceholder}
                    onKeyDown={onPopoverKeyDown}
                    aria-invalid={Boolean(customError)}
                    aria-describedby={customError ? 'af-select-custom-error' : undefined}
                  />
                  {customError ? (
                    <div id="af-select-custom-error" className="af-select-custom-error" role="alert">
                      {customError}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="af-select-options">
                {loading && displayedOptions.length === 0 ? (
                  <div className="af-select-empty">Loading…</div>
                ) : displayedOptions.length === 0 ? (
                  <div className="af-select-empty">No results</div>
                ) : (
                  displayedOptions.map((o, i) => {
                    const isSelected = o.value === value;
                    const isHighlighted = i === highlightIdx;
                    return (
                      <div
                        key={o.value}
                        className={clsx(
                          'af-select-option',
                          isSelected && 'af-select-option--selected',
                          isHighlighted && 'af-select-option--highlighted',
                          o.disabled && 'af-select-option--disabled'
                        )}
                        title={o.disabled ? o.reason || 'Unavailable' : undefined}
                        onMouseEnter={() => setHighlightIdx(i)}
                        onMouseDown={(e) => {
                          // prevent focus loss / drag start
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={() => pick(o.value)}
                        aria-disabled={o.disabled ? true : undefined}
                      >
                        <span className="af-select-option-label">
                          <span>{o.label}</span>
                          {o.reason ? <small className="af-select-option-reason">{o.reason}</small> : null}
                        </span>
                        {isSelected ? <span className="af-select-check">✓</span> : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

export default AfSelect;
