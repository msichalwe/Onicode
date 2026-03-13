import React from 'react';
import type { ScreenshotImageProps } from './types';

export default function ScreenshotImage({ filePath, alt, onClick }: ScreenshotImageProps) {
    const [src, setSrc] = React.useState<string>('');
    const [error, setError] = React.useState(false);

    React.useEffect(() => {
        if (!filePath) return;
        let cancelled = false;
        window.onicode?.readScreenshotBase64?.(filePath).then(result => {
            if (cancelled) return;
            if (result?.dataUri) setSrc(result.dataUri);
            else setError(true);
        }).catch(() => { if (!cancelled) setError(true); });
        return () => { cancelled = true; };
    }, [filePath]);

    if (error) return <div className="tool-step-error" style={{ fontSize: 11, padding: '4px 8px' }}>Screenshot not available</div>;
    if (!src) return <div style={{ padding: '8px', color: 'var(--text-tertiary)', fontSize: 11 }}>Loading screenshot...</div>;
    return <img src={src} alt={alt} className="tool-screenshot-img" onClick={onClick} />;
}
