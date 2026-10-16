import { useState, useEffect } from 'react';
import { fetchWithAuth } from './api';

export const DATA_CHANGED_EVENT = 'app-data-changed';

// Call after anything that can resolve a notification (bill uploaded/paid, bonus decided, ...)
// so the bell, sidebar badges and banners refresh straight away.
export const notifyDataChanged = () => window.dispatchEvent(new Event(DATA_CHANGED_EVENT));

// Live list of notifications; each item disappears once its task is done
export function useNotifications() {
    const [items, setItems] = useState([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await fetchWithAuth('/api/notifications');
                if (!res.ok) return;
                const json = await res.json();
                if (!cancelled) {
                    setItems(json.data?.items || []);
                    setLoaded(true);
                }
            } catch {
                // Best-effort: a failed check leaves the previous list in place
            }
        };
        load();
        window.addEventListener(DATA_CHANGED_EVENT, load);
        // Re-check periodically so date-based reminders appear without a reload
        const timer = setInterval(load, 15 * 60 * 1000);
        return () => {
            cancelled = true;
            window.removeEventListener(DATA_CHANGED_EVENT, load);
            clearInterval(timer);
        };
    }, []);

    return { items, loaded };
}
