import { createPortal } from 'react-dom';

// Full-screen "please wait" layer for slow actions (PDF parsing, saving, payments).
// Rendered into <body> so page transforms can never misplace it, and it blocks
// further clicks until the request finishes.
export default function ProcessingOverlay({ show, message = 'Processing...', detail }) {
    if (!show) return null;
    return createPortal(
        <div className="processing-overlay" role="alertdialog" aria-busy="true" aria-live="assertive">
            <div className="processing-box">
                <div className="spinner spinner-lg" />
                <div className="processing-message">{message}</div>
                {detail && <div className="processing-detail">{detail}</div>}
            </div>
        </div>,
        document.body
    );
}

// Small inline spinner for buttons
export const ButtonSpinner = () => <span className="spinner spinner-sm" aria-hidden="true" />;
