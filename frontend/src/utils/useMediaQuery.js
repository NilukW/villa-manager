import { useState, useEffect } from 'react';

// True while the viewport is at most maxWidth pixels wide; updates on resize/rotation
export function useIsNarrow(maxWidth = 768) {
    const query = `(max-width: ${maxWidth}px)`;
    const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const mq = window.matchMedia(query);
        const onChange = () => setNarrow(mq.matches);
        onChange();
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, [query]);
    return narrow;
}
