import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, ArrowDownToLine } from 'lucide-react';
import { useLanguage } from './LanguageContext';
import Tooltip from './Tooltip';
import { useState, useEffect } from 'react';
import './TitleBar.css';

const appWindow = getCurrentWindow();

const TitleBar: React.FC = () => {
    const { t } = useLanguage();
    const [isMaximized, setIsMaximized] = useState(false);

    // Check initial maximized state
    appWindow.isMaximized().then(setIsMaximized);

    const handleMinimize = () => appWindow.minimize();
    const handleMaximize = async () => {
        await appWindow.toggleMaximize();
        setIsMaximized(await appWindow.isMaximized());
    };
    const handleClose = () => appWindow.close();
    const handleTrayMinimize = () => appWindow.hide();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Alt + Space shortcut (using capture to try and prevent system menu)
            if (e.altKey && (e.code === 'Space' || e.key === ' ')) {
                e.preventDefault();
                e.stopPropagation();
                handleTrayMinimize();
            }
        };

        const handleGlobalMouseDown = (e: MouseEvent) => {
            // Middle mouse button is 1
            if (e.button === 1) {
                e.preventDefault();
                handleTrayMinimize();
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('mousedown', handleGlobalMouseDown, true);

        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('mousedown', handleGlobalMouseDown, true);
        };
    }, []);

    return (
        <div
            className="titlebar"
            data-tauri-drag-region
        >
            <div className="titlebar-title" data-tauri-drag-region>
                <img src="/images/favicon.png" alt="" className="titlebar-icon" draggable={false} />
                Media Browser
            </div>
            <div className="titlebar-buttons">
                <Tooltip text={t('tray.minimize_to_tray')}>
                    <button
                        className="titlebar-btn titlebar-btn-tray"
                        onClick={handleTrayMinimize}
                    >
                        <ArrowDownToLine size={12} />
                    </button>
                </Tooltip>
                <button className="titlebar-btn" onClick={handleMinimize}>
                    <Minus size={12} />
                </button>
                <button className="titlebar-btn" onClick={handleMaximize}>
                    {isMaximized ? (
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                            <rect x="3.5" y="0.5" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
                            <rect x="0.5" y="3.5" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
                        </svg>
                    ) : (
                        <Square size={10} />
                    )}
                </button>
                <button className="titlebar-btn titlebar-btn-close" onClick={handleClose}>
                    <X size={14} />
                </button>
            </div>
        </div>
    );
};

export default TitleBar;
