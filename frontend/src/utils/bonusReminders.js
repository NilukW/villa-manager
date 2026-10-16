import { useState, useEffect } from 'react';
import { fetchWithAuth } from './api';
import { DATA_CHANGED_EVENT, notifyDataChanged } from './notifications';

// Call after a bonus decision is recorded or undone so badges and banners refresh immediately
export const notifyBonusUpdated = notifyDataChanged;

// Months whose staff bonus decision is due (pending) or coming up (upcoming)
export function usePendingBonuses() {
    const [state, setState] = useState({ pending: [], upcoming: [] });

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await fetchWithAuth('/api/staff-bonus/pending');
                if (!res.ok) return;
                const json = await res.json();
                if (!cancelled) setState(json.data || { pending: [], upcoming: [] });
            } catch {
                // Reminders are best-effort; a failed check simply shows no badge
            }
        };
        load();
        window.addEventListener(DATA_CHANGED_EVENT, load);
        // Re-check periodically so a reminder appears on its due date without a reload
        const timer = setInterval(load, 30 * 60 * 1000);
        return () => {
            cancelled = true;
            window.removeEventListener(DATA_CHANGED_EVENT, load);
            clearInterval(timer);
        };
    }, []);

    return state;
}
