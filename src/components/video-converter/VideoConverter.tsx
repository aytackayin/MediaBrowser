import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { exists } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import { X, Folder, FileVideo, Play, Pause, Trash2, Info, RefreshCw, CheckCircle, AlertCircle, Copy, ExternalLink } from 'lucide-react';
import { useLanguage } from '../LanguageContext';
import { motion, AnimatePresence } from 'framer-motion';
import Tooltip from '../Tooltip';
import './VideoConverter.css';

interface MediaFile {
    path: string;
    filename: string;
    file_type: string;
    size: number;
    mtime: number;
}

interface ConverterItem {
    id: string; // usually original path
    filename: string;
    path: string;
    targetPath: string;
    progress: number;
    status: 'pending' | 'processing' | 'done' | 'failed' | 'loading';
    error?: string;
}

interface ConvertProgressPayload {
    file: string;
    progress: number;
}

interface VideoConverterProps {
    onClose: () => void;
}

const VideoConverter: React.FC<VideoConverterProps> = ({ onClose }) => {
    const { t } = useLanguage();
    const [items, setItems] = useState<ConverterItem[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [errorModalHtml, setErrorModalHtml] = useState<{ path: string, error: string } | null>(null);
    const [isPaused, setIsPaused] = useState(false);
    const [keepOriginal, setKeepOriginal] = useState(true);
    const [isScanning, setIsScanning] = useState(false);

    const isProcessingRef = useRef<boolean>(false);
    const isPausedRef = useRef<boolean>(false);

    useEffect(() => {
        isProcessingRef.current = isProcessing;
    }, [isProcessing]);

    useEffect(() => {
        isPausedRef.current = isPaused;
    }, [isPaused]);

    useEffect(() => {
        const unlistenPromise = listen<ConvertProgressPayload>('convert_progress', (event) => {
            setItems(prev => prev.map(item => {
                if (item.path === event.payload.file && item.status === 'processing') {
                    return { ...item, progress: event.payload.progress };
                }
                return item;
            }));
        });

        return () => {
            unlistenPromise.then(unlisten => unlisten());
        };
    }, []);

    const processConversions = async (itemsToProcess: ConverterItem[]) => {
        if (itemsToProcess.length === 0) return;
        setIsProcessing(true);
        isProcessingRef.current = true;
        setShowReport(false);
        setIsPaused(false);
        isPausedRef.current = false;

        for (const item of itemsToProcess) {
            while (isPausedRef.current) {
                if (!isProcessingRef.current) break;
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            if (!isProcessingRef.current) break;

            setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'processing', progress: 0 } : i));

            try {
                // invoke Rust command convert_video_to_mp4
                await invoke('convert_video_to_mp4', {
                    inputPath: item.path,
                    outputPath: item.targetPath
                });

                setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'done', progress: 100 } : i));

                // Handle original file deletion if needed
                if (!keepOriginal) {
                    try {
                        const method = localStorage.getItem('shred_method') || 'DoD3';
                        await invoke('delete_media_file_only', { path: item.path, method });
                    } catch (e) { /* silent delete failure */ }
                }
            } catch (error: any) {
                // Retry once
                try {
                    await invoke('convert_video_to_mp4', {
                        inputPath: item.path,
                        outputPath: item.targetPath
                    });
                    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'done', progress: 100 } : i));

                    // Handle original file deletion on successful retry
                    if (!keepOriginal) {
                        try {
                            const method = localStorage.getItem('shred_method') || 'DoD3';
                            await invoke('delete_media_file_only', { path: item.path, method });
                        } catch (e) { /* silent delete failure */ }
                    }
                } catch (retryError: any) {
                    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'failed', error: retryError.toString() } : i));
                }
            }
        }

        setIsProcessing(false);
        setShowReport(true);
    };

    const handleStart = () => {
        const pendingItems = items.filter(i => i.status === 'pending');
        processConversions(pendingItems);
    };

    const handleRetryAllFailed = () => {
        const failedItems = items.filter(i => i.status === 'failed');
        failedItems.forEach(fi => {
            setItems(prev => prev.map(i => i.id === fi.id ? { ...i, status: 'pending', error: undefined, progress: 0 } : i));
        });
        processConversions(failedItems);
    };

    const handleRetryItem = (id: string) => {
        const target = items.find(i => i.id === id);
        if (target) {
            setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'pending', error: undefined, progress: 0 } : i));
            processConversions([target]);
        }
    };

    const handleSelectFiles = async () => {
        try {
            const selected = await open({
                multiple: true,
                filters: [{
                    name: t('sidebar.videos'),
                    extensions: ['mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'mpg', 'mpeg', '3gp', 'dat'] // all videos excluding mp4
                }]
            });

            if (selected) {
                const paths = Array.isArray(selected) ? selected : [selected];
                setIsScanning(true);
                try {
                    await addItemsFromPaths(paths as string[]);
                } finally {
                    setIsScanning(false);
                }
            }
        } catch (err) {
            // Error handled by status or ignored if cancelled
        }
    };

    const handleSelectFolder = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false
            });

            if (selected && typeof selected === 'string') {
                setIsScanning(true);
                try {
                    const results: MediaFile[] = await invoke('scan_videos_recursive', { path: selected });

                    const newItems: ConverterItem[] = [];
                    for (const m of results) {
                        const isWin = m.path.includes('\\');
                        const sep = isWin ? '\\' : '/';
                        const parts = m.path.split(sep);
                        parts.pop(); // remove filename
                        const directory = parts.join(sep);

                        const nameParts = m.filename.split('.');
                        nameParts.pop(); // remove ext
                        const baseName = nameParts.join('.');

                        let counter = 0;
                        let targetFilename = `${baseName}.mp4`;
                        let targetPath = `${directory}${sep}${targetFilename}`;

                        try {
                            while (await exists(targetPath)) {
                                counter++;
                                targetFilename = `${baseName}-${counter}.mp4`;
                                targetPath = `${directory}${sep}${targetFilename}`;
                            }
                        } catch (e) {
                            // Target path does not exist yet, safe to proceed
                        }

                        newItems.push({
                            id: m.path,
                            filename: m.filename,
                            path: m.path,
                            targetPath,
                            progress: 0,
                            status: 'pending' as const
                        });
                    }

                    // Filter out already existing items in the UI list
                    setItems(prev => {
                        const existingIds = new Set(prev.map(i => i.id));
                        const uniqueNewItems = newItems.filter(ni => !existingIds.has(ni.id));
                        return [...prev, ...uniqueNewItems];
                    });
                } catch (invErr) {
                    // Silently fail or handle as needed
                } finally {
                    setIsScanning(false);
                }
            }
        } catch (err) {
            // Silently fail or handled by item status
        }
    };

    const addItemsFromPaths = async (paths: string[]) => {
        const newItemsPromises = paths.map(async (p) => {
            const isWin = p.includes('\\');
            const sep = isWin ? '\\' : '/';
            const parts = p.split(sep);
            const filename = parts.pop() || '';
            const directory = parts.join(sep);

            const nameParts = filename.split('.');
            nameParts.pop(); // remove ext
            const baseName = nameParts.join('.');

            let counter = 0;
            let targetFilename = `${baseName}.mp4`;
            let targetPath = `${directory}${sep}${targetFilename}`;

            while (await exists(targetPath)) {
                counter++;
                targetFilename = `${baseName}-${counter}.mp4`;
                targetPath = `${directory}${sep}${targetFilename}`;
            }

            return {
                id: p,
                filename,
                path: p,
                targetPath,
                progress: 0,
                status: 'pending' as const
            };
        });

        const newItems = await Promise.all(newItemsPromises);

        setItems(prev => {
            const existingIds = new Set(prev.map(i => i.id));
            const uniqueNewItems = newItems.filter(ni => !existingIds.has(ni.id));
            return [...prev, ...uniqueNewItems];
        });
    };

    const removeAll = () => {
        setItems([]);
        setShowReport(false);
    };

    const removeItem = (id: string) => {
        setItems(prev => prev.filter(i => i.id !== id));
    };

    const pendingCount = items.filter(i => i.status === 'pending').length;
    const processingCount = items.filter(i => i.status === 'processing').length;
    const doneCount = items.filter(i => i.status === 'done').length;
    const failedCount = items.filter(i => i.status === 'failed').length;

    return (
        <div className="video-converter-container">
            <header className="vc-header">
                <div className="vc-header-left">
                    <div className="vc-logo">
                        <RefreshCw size={20} />
                    </div>
                    <h2>{t('converter.title')}</h2>
                </div>
                <div className="vc-actions">
                    <button className="vc-btn-yellow" onClick={handleSelectFiles} disabled={isProcessing}>
                        <FileVideo size={18} />
                        {t('converter.select_files')}
                    </button>
                    <button className="vc-btn-purple" onClick={handleSelectFolder} disabled={isProcessing}>
                        <Folder size={18} />
                        {t('converter.select_folder')}
                    </button>
                    {items.length > 0 && (
                        <Tooltip text={t('converter.clear')}>
                            <button className="vc-btn-danger" onClick={removeAll} disabled={isProcessing}>
                                <Trash2 size={18} />
                                {t('converter.clear')}
                            </button>
                        </Tooltip>
                    )}
                    <Tooltip text={t('common.close')}>
                        <button onClick={onClose} className="vc-close-btn" disabled={isProcessing}><X size={24} /></button>
                    </Tooltip>
                </div>
            </header>

            <main className="vc-main">
                {items.length === 0 ? (
                    <div className="vc-empty">
                        <RefreshCw size={48} className={`vc-empty-icon ${isScanning ? 'animate-spin' : ''}`} />
                        <p>{t('browser.no_media_desc')}</p>
                    </div>
                ) : (
                    <div className="vc-list">
                        {items.map(item => (
                            <div key={item.id} className="vc-item-wrapper">
                                <div className={`vc-item ${item.status}`}>
                                    {item.status === 'processing' && (
                                        <div className="vc-item-progress-bg" style={{ width: `${item.progress}%` }}></div>
                                    )}
                                    <div className="vc-item-content">
                                        <div className="vc-item-info">
                                            <Tooltip text={item.path}>
                                                <span className="vc-filename">{item.filename}</span>
                                            </Tooltip>
                                            <Tooltip text={item.targetPath}>
                                                <span className="vc-target">→ {item.targetPath.split(/[\\/]/).pop()}</span>
                                            </Tooltip>
                                        </div>
                                        <div className="vc-item-status">
                                            {item.status === 'processing' && (
                                                <span className="vc-pct">{Math.round(item.progress)}%</span>
                                            )}
                                            {item.status === 'pending' && <span className="vc-badge pending">{t('converter.status_pending')}</span>}
                                            {item.status === 'done' && <span className="vc-badge done-solid"><CheckCircle size={16} /> {t('converter.status_done')}</span>}
                                            {item.status === 'failed' && (
                                                <div className="vc-failed-actions">
                                                    <span className="vc-badge failed"><AlertCircle size={16} /> {t('converter.status_failed')}</span>
                                                    <Tooltip text={t('converter.error_details')}>
                                                        <button className="vc-icon-btn error-btn" onClick={() => setErrorModalHtml({ path: item.path, error: item.error || 'Unknown error' })}>
                                                            <div className="vc-icon-wrapper">
                                                                <Info size={18} />
                                                            </div>
                                                        </button>
                                                    </Tooltip>
                                                    {!isProcessing && (
                                                        <Tooltip text={t('converter.retry')}>
                                                            <button className="vc-icon-btn" onClick={() => handleRetryItem(item.id)}>
                                                                <div className="vc-icon-wrapper">
                                                                    <RefreshCw size={18} />
                                                                </div>
                                                            </button>
                                                        </Tooltip>
                                                    )}
                                                </div>
                                            )}
                                            {item.status === 'pending' && !isProcessing && (
                                                <div className="vc-pending-actions">
                                                    <Tooltip text={t('converter.remove_from_list')}>
                                                        <button className="vc-action-sq-btn delete" onClick={() => removeItem(item.id)}>
                                                            <X size={16} />
                                                        </button>
                                                    </Tooltip>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                {(item.status === 'done' || item.status === 'failed') && (
                                    <div className="vc-item-actions">
                                        <Tooltip text={t('converter.copy_path')}>
                                            <button className="vc-action-sq-btn copy" onClick={() => navigator.clipboard.writeText(item.status === 'done' ? item.targetPath : item.path)}>
                                                <Copy size={16} />
                                            </button>
                                        </Tooltip>
                                        <Tooltip text={t('converter.open_folder')}>
                                            <button className="vc-action-sq-btn explore" onClick={() => invoke('reveal_in_explorer', { path: item.status === 'done' ? item.targetPath : item.path })}>
                                                <ExternalLink size={16} />
                                            </button>
                                        </Tooltip>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {items.length > 0 && (
                <footer className="vc-footer">
                    <div className="vc-stats">
                        <span>{t('converter.status_done')}: <strong>{doneCount}</strong></span>
                        <span>{t('converter.status_failed')}: <strong>{failedCount}</strong></span>
                        <span>{t('converter.status_pending')}: <strong>{pendingCount}</strong></span>
                    </div>

                    <div className="vc-footer-actions">
                        {failedCount > 0 && !isProcessing && (
                            <button className="vc-btn-primary retry-btn" onClick={handleRetryAllFailed}>
                                <RefreshCw size={18} />
                                {t('converter.retry')}
                            </button>
                        )}
                        {(pendingCount > 0 || processingCount > 0) && (
                            <div className="vc-footer-controls">
                                {!isProcessing && (
                                    <label className="vc-checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={keepOriginal}
                                            onChange={(e) => setKeepOriginal(e.target.checked)}
                                        />
                                        <span>{t('converter.keep_original')}</span>
                                    </label>
                                )}
                                {!isProcessing ? (
                                    <button
                                        className="vc-btn-green"
                                        onClick={handleStart}
                                        disabled={pendingCount === 0}
                                    >
                                        <Play size={18} /> {t('converter.start')}
                                    </button>
                                ) : (
                                    <button
                                        className="vc-btn-secondary"
                                        style={{ color: isPaused ? 'var(--accent-primary)' : 'inherit', borderColor: isPaused ? 'var(--accent-primary)' : 'inherit' }}
                                        onClick={() => setIsPaused(!isPaused)}
                                    >
                                        {isPaused ? <Play size={18} /> : <Pause size={18} />}
                                        {isPaused ? t('converter.resume') : t('converter.pause')}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </footer>
            )}

            {showReport && !isProcessing && (
                <AnimatePresence>
                    <motion.div
                        initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }}
                        className="vc-report-card"
                    >
                        <h3>{t('converter.report_title')}</h3>
                        <p>{t('converter.report_summary').replace('{success}', doneCount.toString()).replace('{failed}', failedCount.toString())}</p>
                        <button className="vc-btn-secondary" onClick={() => setShowReport(false)}>{t('common.close')}</button>
                    </motion.div>
                </AnimatePresence>
            )}

            <AnimatePresence>
                {errorModalHtml && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="browser-modal-overlay vc-modal-overlay"
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                            className="browser-modal-content vc-error-modal"
                        >
                            <div className="browser-modal-header">
                                <h3 className="browser-modal-title" style={{ color: 'var(--accent-red)' }}>{t('converter.error_details')}</h3>
                                <button className="browser-modal-close-btn" onClick={() => setErrorModalHtml(null)}><X size={20} /></button>
                            </div>
                            <div className="modal-body">
                                <p style={{ wordBreak: 'break-all', marginBottom: '1rem', color: 'var(--text-secondary)' }}><strong>Path:</strong> {errorModalHtml.path}</p>
                                <div className="vc-error-box">
                                    {errorModalHtml.error}
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

        </div>
    );
};

export default VideoConverter;
