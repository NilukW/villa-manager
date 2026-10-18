import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, Check } from 'lucide-react';

// Move keyboard focus to the next field in the same form (like pressing Tab)
export const focusNext = (el) => {
    if (!el) return;
    const scope = el.closest('form') || document;
    const fields = [...scope.querySelectorAll('input, select, textarea, button, [tabindex]')]
        .filter(e => !e.disabled && e.tabIndex >= 0 && e.type !== 'hidden' && e.offsetParent !== null);
    const next = fields[fields.indexOf(el) + 1];
    if (next) next.focus();
};

// Type-to-filter picker. Options: [{ value, label, hint?, group?, keywords? }].
// groups: { key: { label, color } } for the small tag shown next to each option.
// onCreate(text) adds an "+ Add ..." choice when the typed text matches nothing exactly.
// freeText: the input is the value itself (text/onTextChange); options are suggestions only.
export default function SearchSelect({
    options, groups = {}, value, selectedLabel = '', onSelect, onCreate, createLabel,
    freeText = false, text = '', onTextChange, placeholder = 'Type to search…', autoFocus = false,
    inputStyle, maxResults = 60
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [pos, setPos] = useState(null);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    const q = (freeText ? text : query).trim().toLowerCase();

    const results = useMemo(() => {
        let list = options;
        if (q) {
            const score = (o) => {
                const label = o.label.toLowerCase();
                if (label.startsWith(q)) return 0;
                if (label.split(/[\s/(),-]+/).some(w => w.startsWith(q))) return 1;
                if (label.includes(q)) return 2;
                if ((o.keywords || '').toLowerCase().includes(q)) return 3;
                return -1;
            };
            list = options.map(o => [o, score(o)]).filter(([, s]) => s >= 0)
                .sort((a, b) => a[1] - b[1] || a[0].label.localeCompare(b[0].label))
                .map(([o]) => o);
        }
        const shown = list.slice(0, maxResults);
        const exact = options.some(o => o.label.toLowerCase() === q);
        if (onCreate && q && !exact) shown.push({ create: true, value: '__create__', label: (freeText ? text : query).trim() });
        return shown;
    }, [options, q, query, text, freeText, onCreate, maxResults]);

    // Keep the highlighted row valid and in view
    useEffect(() => { setActive(0); }, [q]);
    useEffect(() => {
        const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
        if (el) el.scrollIntoView({ block: 'nearest' });
    }, [active, open]);

    // The list is drawn in a portal with fixed position, so scrolling modals don't clip it
    const place = () => {
        const r = inputRef.current?.getBoundingClientRect();
        if (!r) return;
        const below = window.innerHeight - r.bottom;
        const up = below < 260 && r.top > below;
        setPos({ left: r.left, width: Math.max(r.width, 240), top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined, maxHeight: Math.min(300, (up ? r.top : below) - 12) });
    };
    useLayoutEffect(() => {
        if (!open) return;
        place();
        const onMove = () => place();
        window.addEventListener('resize', onMove);
        window.addEventListener('scroll', onMove, true);
        return () => {
            window.removeEventListener('resize', onMove);
            window.removeEventListener('scroll', onMove, true);
        };
    }, [open]);

    // After a choice, go on to the next field (after React has drawn any fields the choice adds)
    const choose = (o) => {
        if (o.create) onCreate(o.label);
        else onSelect(o);
        setOpen(false);
        setQuery('');
        const input = inputRef.current;
        setTimeout(() => focusNext(input), 0);
    };

    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) setOpen(true);
            else setActive(a => Math.min(a + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(a => Math.max(a - 1, 0));
        } else if (e.key === 'Enter') {
            if (open && results[active]) {
                e.preventDefault();
                choose(results[active]);
            } else if (freeText) {
                e.preventDefault();
            }
        } else if (e.key === 'Escape') {
            if (open) {
                e.stopPropagation();
                setOpen(false);
            }
        } else if (e.key === 'Tab') {
            // Typed something? Tab takes the highlighted choice, like Enter (not in free-text boxes,
            // where what was typed is already the value)
            if (!freeText && !e.shiftKey && open && q && results[active]) {
                e.preventDefault();
                choose(results[active]);
            } else {
                setOpen(false);
            }
        }
    };

    const inputValue = freeText ? text : (open ? query : selectedLabel);

    return (
        <div style={{ position: 'relative', minWidth: 0 }}>
            <input
                ref={inputRef}
                className="form-control"
                value={inputValue}
                placeholder={!freeText && selectedLabel && open ? selectedLabel : placeholder}
                autoFocus={autoFocus}
                autoComplete="off"
                role="combobox"
                aria-expanded={open}
                onFocus={() => { setOpen(true); setQuery(''); }}
                onBlur={() => { setOpen(false); setQuery(''); }}
                onChange={e => {
                    if (freeText) onTextChange(e.target.value);
                    else setQuery(e.target.value);
                    setOpen(true);
                }}
                onKeyDown={onKeyDown}
                style={{ width: '100%', paddingRight: '1.8rem', ...inputStyle }}
            />
            <ChevronDown size={15} style={{ position: 'absolute', right: '0.55rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)', pointerEvents: 'none' }} />
            {open && pos && results.length > 0 && createPortal(
                <div
                    ref={listRef}
                    role="listbox"
                    className="search-select-list"
                    onMouseDown={e => e.preventDefault()} // keep focus in the input while clicking
                    style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight, overflowY: 'auto', zIndex: 2000, backgroundColor: 'white', border: '1px solid var(--border)', borderRadius: '0.5rem', boxShadow: '0 10px 25px rgba(15, 23, 42, 0.15)', padding: '0.25rem' }}
                >
                    {results.map((o, idx) => {
                        const g = o.group ? groups[o.group] : null;
                        const selected = !o.create && value !== undefined && String(o.value) === String(value);
                        return (
                            <div
                                key={`${o.value}-${idx}`}
                                data-idx={idx}
                                role="option"
                                aria-selected={idx === active}
                                onMouseEnter={() => setActive(idx)}
                                onClick={() => choose(o)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.6rem', borderRadius: '0.35rem', cursor: 'pointer', fontSize: '0.9rem',
                                    backgroundColor: idx === active ? '#eef2ff' : 'transparent',
                                    color: o.create ? 'var(--primary)' : 'var(--text)',
                                    borderTop: o.create && idx > 0 ? '1px solid var(--border)' : 'none',
                                    fontWeight: o.create ? 600 : 400
                                }}
                            >
                                {o.create ? <Plus size={15} /> : selected ? <Check size={15} style={{ color: 'var(--primary)' }} /> : <span style={{ width: 15 }} />}
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {o.create ? (createLabel ? createLabel(o.label) : `Add "${o.label}"`) : o.label}
                                    {o.hint && <span style={{ color: 'var(--text-light)', fontSize: '0.8rem' }}> · {o.hint}</span>}
                                </span>
                                {g && <span style={{ fontSize: '0.7rem', fontWeight: 600, color: g.color, backgroundColor: `${g.color}1a`, padding: '0.1rem 0.45rem', borderRadius: '1rem', whiteSpace: 'nowrap' }}>{g.label}</span>}
                            </div>
                        );
                    })}
                </div>,
                document.body
            )}
        </div>
    );
}
