import React, { useState, useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search, Filter, SortAsc, RefreshCw, FolderOpen, ArrowLeft, ChevronRight, ChevronDown, CornerLeftUp, FolderPlus, X, Home, Trash2, Copy, Square, CheckSquare } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import MediaCard from './MediaCard';
import { useLanguage } from './LanguageContext';
import Tooltip from './Tooltip';
import FolderPickerModal from './FolderPickerModal';
import './MediaBrowser.css';

interface MediaFile {
    path: string;
    filename: string;
    file_type: string;
    size: number;
    mtime: number;
    width?: number;
    height?: number;
    duration?: number;
    notes?: string;
}


interface MediaBrowserProps {
    activeTab: string;
    files: MediaFile[];
    setFiles: React.Dispatch<React.SetStateAction<MediaFile[]>>;
    onFileSelect: (file: MediaFile) => void;
    initialPath?: string;
    isGalleryRoot?: boolean;
    currentPath: string | null;
    highlightedPath: string | null;
    setHighlightedPath: (path: string | null) => void;
    currentPage: number;
    setCurrentPage: (page: number) => void;
    sortBy: 'name' | 'type' | 'date' | 'size';
    setSortBy: (val: 'name' | 'type' | 'date' | 'size') => void;
    sortOrder: 'asc' | 'desc';
    setSortOrder: (val: 'asc' | 'desc') => void;
    filterType: 'all' | 'image' | 'video' | 'audio';
    setFilterType: (val: 'all' | 'image' | 'video' | 'audio') => void;
    totalItems: number;
    totalImages: number;
    totalVideos: number;
    totalAudio: number;
    searchQuery: string;
    setSearchQuery: (val: string) => void;
    onOpenPlayer?: (file: MediaFile) => void;
    filteredFiles: MediaFile[];
    loading: boolean;
    scanFolder: (inputPath?: string, page?: number, queryOverride?: string) => Promise<void>;
    pendingHighlight: 'first' | 'last' | null;
    setPendingHighlight: (val: 'first' | 'last' | null) => void;
}

const MediaBrowser: React.FC<MediaBrowserProps> = ({
    activeTab, files, setFiles, onFileSelect, initialPath, isGalleryRoot,
    currentPath, highlightedPath, setHighlightedPath,
    currentPage, setCurrentPage, sortBy, setSortBy, sortOrder, setSortOrder,
    filterType, setFilterType, totalItems,
    totalImages, totalVideos, totalAudio,
    searchQuery, setSearchQuery, onOpenPlayer, filteredFiles,
    loading, scanFolder, setPendingHighlight
}) => {
    const { t } = useLanguage();
    const gridRef = useRef<HTMLDivElement>(null);

    // Local UI states
    const [showSortMenu, setShowSortMenu] = useState(false);
    const [showFilterMenu, setShowFilterMenu] = useState(false);

    // Show window when ready
    useEffect(() => {
        const timer = setTimeout(() => {
            invoke('show_main_window');
        }, 100);
        return () => clearTimeout(timer);
    }, []);

    // Grid states
    const [thumbSize, setThumbSize] = useState(() => {
        return Number(localStorage.getItem('thumb_size')) || 200;
    });

    useEffect(() => {
        localStorage.setItem('thumb_size', thumbSize.toString());
    }, [thumbSize]);

    // Handle Ctrl + Scroll for resizing
    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -20 : 20;
                setThumbSize(prev => {
                    const next = prev + delta;
                    return Math.min(Math.max(next, 120), 400);
                });
            }
        };

        window.addEventListener('wheel', handleWheel, { passive: false });
        return () => window.removeEventListener('wheel', handleWheel);
    }, []);

    // Create folder
    const [showNewFolderModal, setShowNewFolderModal] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [folderError, setFolderError] = useState('');

    // Delete modal
    const [fileToDelete, setFileToDelete] = useState<MediaFile | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deletionMethod, setDeletionMethod] = useState<string>('DoD3');
    const [showDeletionMenu, setShowDeletionMenu] = useState(false);


    // Move/copy state
    const [itemToMoveCopy, setItemToMoveCopy] = useState<MediaFile | null>(null);
    const [isProcessingAction, setIsProcessingAction] = useState(false);
    const [showPageMenu, setShowPageMenu] = useState(false);

    // Selection state
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [isBulkDelete, setIsBulkDelete] = useState(false);
    const [bulkActionType, setBulkActionType] = useState<'copy' | 'move' | null>(null);

    // Set default deletion method
    useEffect(() => {
        if (fileToDelete || isBulkDelete) {
            const savedMethod = localStorage.getItem('shred_method') || 'DoD3';
            setDeletionMethod(savedMethod);
        }
    }, [fileToDelete, isBulkDelete]);

    // Reset selection on path change
    useEffect(() => {
        setSelectedPaths(new Set());
        setIsBulkDelete(false);
        setBulkActionType(null);
    }, [currentPath, searchQuery, filterType]);

    const handleToggleSelect = (path: string) => {
        setSelectedPaths(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    };

    const handleSelectAll = () => {
        if (selectedPaths.size === filteredFiles.length && filteredFiles.length > 0) {
            setSelectedPaths(new Set());
        } else {
            setSelectedPaths(new Set(filteredFiles.map(f => f.path)));
        }
    };

    // Toast state
    const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' | 'info' }[]>([]);

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    };

    const translateError = (error: any): string => {
        const msg = typeof error === 'string' ? error : (error?.toString?.() || '');
        const errorMap: Record<string, string> = {
            'Destination already exists': t('error.destination_already_exists'),
            'Folder already exists': t('error.folder_already_exists'),
            'A file with the same name already exists': t('error.file_already_exists'),
            'File not found': t('error.file_not_found'),
            'Permission denied': t('error.permission_denied'),
        };
        for (const [key, value] of Object.entries(errorMap)) {
            if (msg.includes(key)) return value;
        }
        return msg || t('error.unknown');
    };

    // Helpers
    const normalizePath = (p: string) => {
        if (!p) return '';
        const isWindows = p.includes('\\') || /^[A-Z]:/i.test(p);
        const separator = isWindows ? '\\' : '/';
        let normalized = p.replace(/[\\/]+/g, separator);
        if (isWindows) {
            if (normalized.length > 3 && normalized.endsWith('\\')) normalized = normalized.slice(0, -1);
        } else {
            if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
        }
        return normalized;
    };

    const isPathsEqual = (p1: string | null, p2: string | null) => {
        if (!p1 || !p2) return p1 === p2;
        const n1 = normalizePath(p1);
        const n2 = normalizePath(p2);
        const isWindows = n1.includes('\\') || /^[A-Z]:/i.test(n1);
        if (isWindows) return n1.toLowerCase() === n2.toLowerCase();
        return n1 === n2;
    };

    const pageSize = 100;

    const isFirstScroll = useRef(true);

    // Scroll to highlighted item
    useEffect(() => {
        if (highlightedPath && !loading) {
            const timer = setTimeout(() => {
                const element = document.getElementById(`media-item-${highlightedPath}`);
                if (element) {
                    element.scrollIntoView({
                        behavior: isFirstScroll.current ? 'auto' : 'smooth',
                        block: 'nearest',
                        inline: 'nearest'
                    });
                    isFirstScroll.current = false;
                }
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [highlightedPath, loading, files]);


    const handleCreateFolder = async () => {
        if (!newFolderName.trim() || !currentPath) return;
        setFolderError('');
        try {
            await invoke('create_folder', {
                parentPath: currentPath,
                folderName: newFolderName.trim()
            });
            setNewFolderName('');
            setShowNewFolderModal(false);
            scanFolder(currentPath || initialPath || '', currentPage);
            showToast(t('toast.create_folder_success'));
        } catch (err: any) {
            const errorStr = err.toString();
            if (errorStr.includes("already exists") || errorStr.includes("Folder already exists")) {
                setFolderError(t('browser.folder_exists_error'));
                showToast(t('browser.folder_exists_error'), 'error');
            } else {
                setFolderError(errorStr);
                showToast(t('toast.create_folder_error'), 'error');
            }
        }
    };

    const handleDeleteConfirm = async () => {
        if ((!fileToDelete && !isBulkDelete) || !initialPath) return;
        setIsDeleting(true);
        try {
            if (isBulkDelete) {
                // Bulk delete
                const paths = Array.from(selectedPaths);
                for (const path of paths) {
                    await invoke('delete_media_file', {
                        path,
                        galleryRoot: initialPath,
                        method: deletionMethod
                    });
                }
                setSelectedPaths(new Set());
                setIsBulkDelete(false);
            } else if (fileToDelete) {
                // Single delete
                await invoke('delete_media_file', {
                    path: fileToDelete.path,
                    galleryRoot: initialPath,
                    method: deletionMethod
                });
                setFileToDelete(null);
            }

            if (currentPath) {
                scanFolder(currentPath, currentPage);
            }
            showToast(t('modal.delete_success'));
        } catch (error) {
            showToast(t('toast.process_failed') + translateError(error), 'error');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleMoveCopySelect = async (destinationPath: string, action: 'copy' | 'move') => {
        if ((!itemToMoveCopy && !bulkActionType) || !initialPath) return;
        setIsProcessingAction(true);
        let totalSuccess = 0;
        let totalSkip = 0;

        try {
            if (bulkActionType) {
                const paths = Array.from(selectedPaths);
                for (const path of paths) {
                    try {
                        const result: { success_count: number, skip_count: number } = await invoke(
                            action === 'move' ? 'move_media_item' : 'copy_media_item',
                            {
                                oldPath: path,
                                newParentPath: destinationPath,
                                galleryRoot: initialPath
                            }
                        );
                        totalSuccess += result.success_count;
                        totalSkip += result.skip_count;
                    } catch (err) {
                    }
                }
                setSelectedPaths(new Set());
                setBulkActionType(null);
            } else if (itemToMoveCopy) {
                const result: { success_count: number, skip_count: number } = await invoke(
                    action === 'move' ? 'move_media_item' : 'copy_media_item',
                    {
                        oldPath: itemToMoveCopy.path,
                        newParentPath: destinationPath,
                        galleryRoot: initialPath
                    }
                );
                totalSuccess = result.success_count;
                totalSkip = result.skip_count;
                setItemToMoveCopy(null);
            }

            if (totalSkip > 0) {
                const summaryKey = action === 'move' ? 'toast.move_summary' : 'toast.copy_summary';
                showToast(t(summaryKey, { success: totalSuccess, skip: totalSkip }), totalSuccess > 0 ? 'success' : 'info');
            } else if (totalSuccess > 0) {
                const successKey = action === 'move' ? 'toast.move_success' : 'toast.copy_success';
                showToast(t(successKey));
            }

            scanFolder(currentPath || '', currentPage);
        } catch (error: any) {
            showToast(t('toast.process_failed') + translateError(error), 'error');
        } finally {
            setIsProcessingAction(false);
        }
    };


    const goBack = async () => {
        if (!currentPath) return;

        const nCur = normalizePath(currentPath);
        const nInit = initialPath ? normalizePath(initialPath) : null;

        if (isGalleryRoot && nInit && isPathsEqual(nCur, nInit)) return;

        const isWin = nCur.includes('\\') || /^[A-Z]:/i.test(nCur);
        const sep = isWin ? '\\' : '/';

        if (isWin && nCur.match(/^[A-Z]:\\?$/i)) return;
        if (!isWin && nCur === '/') return;

        const lastSep = nCur.lastIndexOf(sep);
        if (lastSep !== -1) {
            const parent = nCur.substring(0, lastSep);
            const targetParent = (isWin && parent.match(/^[A-Z]:$/i)) ? parent + '\\' : (parent === '' ? '/' : parent);

            setHighlightedPath(nCur); // Set current folder as highlight in parent
            setSearchQuery(''); // Clear search on navigation
            scanFolder(targetParent, 1, '');
        }
    };

    const handleItemSelect = (file: MediaFile) => {
        setHighlightedPath(file.path);
    };

    const handleItemDoubleClick = (file: MediaFile) => {
        if (file.file_type === 'folder') {
            setSearchQuery(''); // Clear search on entering folder
            scanFolder(file.path, 1, '');
        } else {
            if (onOpenPlayer) onOpenPlayer(file);
        }
    };


    const handlePageChange = (newPage: number) => {
        setHighlightedPath(null);
        if (currentPath) scanFolder(currentPath, newPage);
        if (gridRef.current) gridRef.current.scrollTop = 0;
    };

    const nCur = currentPath ? normalizePath(currentPath) : '';
    const nInit = initialPath ? normalizePath(initialPath) : '';
    const isAtRoot = isGalleryRoot && nInit && isPathsEqual(nCur, nInit);

    // Handle pagination
    const effectiveTotalItems = useMemo(() => {
        if (filterType === 'image') return totalImages;
        if (filterType === 'video') return totalVideos;
        if (filterType === 'audio') return totalAudio;
        return totalItems;
    }, [filterType, totalItems, totalImages, totalVideos, totalAudio]);

    const totalPages = Math.ceil(effectiveTotalItems / pageSize);

    // Keyboard navigation
    const gridItems = useMemo(() => {
        const items: MediaFile[] = [];
        if (!isAtRoot && !loading) {
            items.push({ path: 'UP_FOLDER', file_type: 'folder', filename: '..' } as MediaFile);
        }
        return [...items, ...filteredFiles];
    }, [isAtRoot, filteredFiles, loading]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) return;
            if (showNewFolderModal || fileToDelete || itemToMoveCopy) return;

            const currentIndex = gridItems.findIndex(f =>
                f.path === 'UP_FOLDER' ? highlightedPath === 'UP_FOLDER' : isPathsEqual(f.path, highlightedPath)
            );

            const navigate = (newIdx: number) => {
                const target = gridItems[newIdx];
                if (target) {
                    e.preventDefault();
                    setHighlightedPath(target.path);
                }
            };

            if (e.key === 'ArrowRight') {
                if (currentIndex === -1) navigate(0);
                else if (currentIndex === gridItems.length - 1) {
                    if (currentPage < totalPages) {
                        setPendingHighlight('first');
                        handlePageChange(currentPage + 1);
                    }
                }
                else navigate(currentIndex + 1);
            } else if (e.key === 'ArrowLeft') {
                if (currentIndex === -1) navigate(0);
                else if (currentIndex === 0) {
                    if (currentPage > 1) {
                        setPendingHighlight('last');
                        handlePageChange(currentPage - 1);
                    }
                }
                else navigate(currentIndex - 1);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const grid = gridRef.current?.querySelector('.media-grid');
                if (grid) {
                    const columns = window.getComputedStyle(grid).getPropertyValue('grid-template-columns').split(' ').length;
                    if (currentIndex === -1) navigate(0);
                    else {
                        const step = e.key === 'ArrowDown' ? columns : -columns;
                        const nextIdx = currentIndex + step;
                        if (nextIdx >= 0 && nextIdx < gridItems.length) navigate(nextIdx);
                        else if (e.key === 'ArrowDown') navigate(gridItems.length - 1);
                        else if (e.key === 'ArrowUp') navigate(0);
                    }
                }
            } else if (e.key === 'Enter') {
                if (currentIndex !== -1) {
                    e.preventDefault();
                    const target = gridItems[currentIndex];
                    if (target.path === 'UP_FOLDER') {
                        goBack();
                    } else {
                        handleItemDoubleClick(target);
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [gridItems, highlightedPath, showNewFolderModal, fileToDelete, itemToMoveCopy, goBack]);

    useEffect(() => {
        if (!showPageMenu) return;

        const handleClickOutside = () => setShowPageMenu(false);
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setShowPageMenu(false);
        };

        window.addEventListener('click', handleClickOutside);
        window.addEventListener('keydown', handleEscape);
        return () => {
            window.removeEventListener('click', handleClickOutside);
            window.removeEventListener('keydown', handleEscape);
        };
    }, [showPageMenu]);

    const displayBreadcrumbs = useMemo(() => {
        if (!nInit || !nCur) return nCur.split(/[\\/]/).filter(Boolean);
        const isWin = nCur.includes('\\') || /^[A-Z]:/i.test(nCur);
        const startsWith = isWin ? nCur.toLowerCase().startsWith(nInit.toLowerCase()) : nCur.startsWith(nInit);

        if (!startsWith) return nCur.split(/[\\/]/).filter(Boolean);

        const relative = nCur.substring(nInit.length);
        return relative.split(/[\\/]/).filter(Boolean);
    }, [nCur, nInit]);

    return (
        <div className="main-layout">
            <header className="header">
                <div className="search-container">
                    <Search className="search-icon" size={16} />
                    <input
                        id="browser-search-input"
                        name="search"
                        type="text"
                        placeholder={t('browser.search_placeholder')}
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                        className="search-input"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {searchQuery && (
                        <button
                            className="search-clear-btn"
                            onClick={() => { setSearchQuery(''); setCurrentPage(1); if (currentPath) scanFolder(currentPath, 1, ''); }}
                        >
                            <X size={14} strokeWidth={2.5} />
                        </button>
                    )}
                </div>

                <div className="header-actions">

                    <div style={{ position: 'relative' }}>
                        <Tooltip text={t('browser.create_folder')}>
                            <button
                                className="icon-btn create-folder-btn"
                                onClick={() => {
                                    setNewFolderName('');
                                    setFolderError('');
                                    setShowNewFolderModal(true);
                                }}
                            >
                                <FolderPlus size={18} />
                            </button>
                        </Tooltip>
                    </div>

                    <div
                        style={{ position: 'relative' }}
                        onMouseEnter={() => setShowFilterMenu(true)}
                        onMouseLeave={() => setShowFilterMenu(false)}
                    >
                        <Tooltip text={t('common.filter')}>
                            <button className="icon-btn">
                                <Filter size={18} color={filterType !== 'all' ? 'var(--accent-blue)' : 'currentColor'} />
                            </button>
                        </Tooltip>
                        <AnimatePresence>
                            {showFilterMenu && (
                                <motion.div
                                    initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }}
                                    className="dropdown-menu"
                                >
                                    <div className="dropdown-content">
                                        {[{ id: 'all', label: t('filter.all') }, { id: 'image', label: t('filter.images_only') }, { id: 'video', label: t('filter.videos_only') }, { id: 'audio', label: t('filter.audio_only') }].map(f => (
                                            <div key={f.id} onClick={() => { setFilterType(f.id as any); setShowFilterMenu(false); setCurrentPage(1); }}
                                                className={`dropdown-item ${filterType === f.id ? 'active' : ''}`}
                                            >
                                                {f.label}
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <div
                        style={{ position: 'relative' }}
                        onMouseEnter={() => setShowSortMenu(true)}
                        onMouseLeave={() => setShowSortMenu(false)}
                    >
                        <Tooltip text={t('common.sort')}>
                            <button className="icon-btn">
                                <SortAsc size={18} color={sortBy !== 'name' || sortOrder !== 'asc' ? 'var(--accent-blue)' : 'currentColor'} />
                            </button>
                        </Tooltip>
                        <AnimatePresence>
                            {showSortMenu && (
                                <motion.div
                                    initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }}
                                    className="dropdown-menu dropdown-menu-wide"
                                >
                                    <div className="dropdown-content">
                                        <span className="dropdown-label">{t('sort.criteria')}</span>
                                        {[{ id: 'name', label: t('sort.by_name') }, { id: 'type', label: t('sort.by_type') }, { id: 'date', label: t('sort.by_date') }, { id: 'size', label: t('sort.by_size') }].map(s => (
                                            <div key={s.id} onClick={() => setSortBy(s.id as any)}
                                                className={`dropdown-item ${sortBy === s.id ? 'active' : ''}`}
                                            >
                                                {s.label}
                                            </div>
                                        ))}
                                        <div className="dropdown-divider" />
                                        <div className="sort-buttons">
                                            <button onClick={() => setSortOrder('asc')} className={`sort-btn ${sortOrder === 'asc' ? 'active' : ''}`}>ASC (A-Z)</button>
                                            <button onClick={() => setSortOrder('desc')} className={`sort-btn ${sortOrder === 'desc' ? 'active' : ''}`}>DESC (Z-A)</button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    <div className="thumb-slider-wrapper">
                        <Tooltip text={t('editor.size')}>
                            <input
                                type="range"
                                min="120"
                                max="400"
                                value={thumbSize}
                                onChange={(e) => setThumbSize(Number(e.target.value))}
                                className="thumb-slider"
                            />
                        </Tooltip>
                    </div>

                    <Tooltip text={t('common.refresh')}>
                        <button className="icon-btn" onClick={() => currentPath && scanFolder(currentPath, currentPage)}>
                            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </Tooltip>
                </div>
            </header>

            {/* Breadcrumb Navigation & Bulk Actions */}
            {currentPath && (
                <div className="breadcrumbs-bar">
                    <div className="breadcrumbs">
                        <Home
                            size={18}
                            className="breadcrumb-home"
                            onClick={() => {
                                if (initialPath) {
                                    if (displayBreadcrumbs.length > 0) {
                                        const isWin = nCur.includes('\\') || /^[A-Z]:/i.test(nCur);
                                        const sep = isWin ? '\\' : '/';
                                        const initParts = nInit ? nInit.split(/[\\/]/).filter(Boolean) : [];
                                        let highlightTarget = [...initParts, displayBreadcrumbs[0]].join(sep);
                                        if (isWin && /^[A-Z]:/i.test(nCur)) {
                                            if (highlightTarget.length === 2) highlightTarget += '\\';
                                        } else if (!isWin && nCur.startsWith('/')) {
                                            highlightTarget = '/' + highlightTarget;
                                        }
                                        setHighlightedPath(highlightTarget);
                                    }
                                    setSearchQuery('');
                                    scanFolder(initialPath, 1, '');
                                }
                            }}
                        />
                        {displayBreadcrumbs.length === 0 && <span key="root-notice" style={{ fontSize: '0.75rem', opacity: 0.5 }}>{t('browser.root_contents')}</span>}
                        {displayBreadcrumbs.map((part, i) => (
                            <React.Fragment key={i}>
                                <span
                                    className={`breadcrumb-item ${i === displayBreadcrumbs.length - 1 ? 'active' : ''}`}
                                    onClick={() => {
                                        if (i === displayBreadcrumbs.length - 1) return;
                                        const isWin = nCur.includes('\\') || /^[A-Z]:/i.test(nCur);
                                        const sep = isWin ? '\\' : '/';
                                        const initParts = nInit ? nInit.split(/[\\/]/).filter(Boolean) : [];
                                        const clickedParts = displayBreadcrumbs.slice(0, i + 1);
                                        let target = [...initParts, ...clickedParts].join(sep);
                                        if (isWin && /^[A-Z]:/i.test(nCur)) {
                                            if (target.length === 2) target += '\\';
                                        } else if (!isWin && nCur.startsWith('/')) {
                                            target = '/' + target;
                                        }
                                        const nextPart = displayBreadcrumbs[i + 1];
                                        if (nextPart) {
                                            let highlightTarget = [...initParts, ...clickedParts, nextPart].join(sep);
                                            if (isWin && /^[A-Z]:/i.test(nCur)) {
                                                if (highlightTarget.length === 2) highlightTarget += '\\';
                                            } else if (!isWin && nCur.startsWith('/')) {
                                                highlightTarget = '/' + highlightTarget;
                                            }
                                            setHighlightedPath(highlightTarget);
                                        }
                                        setSearchQuery('');
                                        scanFolder(target, 1, '');
                                    }}
                                >
                                    {part}
                                </span>
                                {i < displayBreadcrumbs.length - 1 && <ChevronRight size={12} />}
                            </React.Fragment>
                        ))}
                    </div>

                    <div className="bulk-actions">
                        {selectedPaths.size > 0 && (
                            <>
                                <Tooltip text={t('card.copy_move_selected')}>
                                    <button
                                        className="bulk-action-btn"
                                        onClick={() => setBulkActionType('copy')}
                                    >
                                        <Copy size={18} />
                                    </button>
                                </Tooltip>
                                <Tooltip text={t('card.delete_selected')}>
                                    <button
                                        className="bulk-action-btn bulk-btn-delete"
                                        onClick={() => setIsBulkDelete(true)}
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </Tooltip>
                                <div style={{ width: 1, height: 16, background: 'var(--border-color)', margin: '0 4px' }} />
                            </>
                        )}

                        <Tooltip text={t('common.select_all')}>
                            <div className="bulk-select-all" onClick={handleSelectAll}>
                                {selectedPaths.size === filteredFiles.length && filteredFiles.length > 0 ? (
                                    <CheckSquare size={18} color="var(--accent-purple)" />
                                ) : (
                                    <Square size={18} color="var(--text-tertiary)" />
                                )}
                            </div>
                        </Tooltip>
                    </div>
                </div>
            )}

            <main className="content-area" ref={gridRef}>
                {loading && (
                    <div className="loading-overlay">
                        <RefreshCw className="animate-spin" size={32} />
                    </div>
                )}
                {(files.length === 0 && isAtRoot) && !loading ? (
                    <div className="empty-state">
                        <FolderOpen size={48} className="empty-state-icon" />
                        <div className="empty-state-text">
                            <h3 className="empty-state-title">{t('browser.no_media')}</h3>
                            <p className="empty-state-desc">{t('browser.no_media_desc')}</p>
                        </div>
                    </div>
                ) : (
                    <div className="media-grid" style={{ '--thumb-size': `${thumbSize}px` } as React.CSSProperties}>
                        <AnimatePresence>
                            {/* Go Back Card - Up Folder */}
                            {!isAtRoot && !loading && (
                                <Tooltip key="parent-folder" text={t('browser.parent_folder')}>
                                    <motion.div
                                        id="media-item-UP_FOLDER"
                                        whileHover={{ y: -4 }}
                                        className={`media-card folder-back flex-center ${highlightedPath === 'UP_FOLDER' ? 'highlighted' : ''}`}
                                        onClick={() => setHighlightedPath('UP_FOLDER')}
                                        onDoubleClick={goBack}
                                    >
                                        <div className="media-preview flex-center"><CornerLeftUp size={48} className="folder-back-icon" /></div>
                                        <div className="media-info folder-back-info"><p className="media-title">...</p></div>
                                    </motion.div>
                                </Tooltip>
                            )}

                            {files.length === 0 && !loading && !isAtRoot && (
                                <div key="empty-folder-notice" className="empty-folder-notice" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
                                    <FolderOpen size={32} style={{ opacity: 0.3, marginBottom: '8px' }} />
                                    <p>{t('browser.no_media')}</p>
                                </div>
                            )}
                            {filteredFiles.map((file) => (
                                <MediaCard
                                    key={file.path}
                                    file={file}
                                    onSelect={() => handleItemSelect(file)}
                                    onDoubleClick={() => handleItemDoubleClick(file)}
                                    highlighted={isPathsEqual(file.path, highlightedPath)}
                                    galleryRoot={initialPath}
                                    onUpdate={(updatedFile: MediaFile, silent?: boolean) => {
                                        setFiles(prev => prev.map(f => f.path === file.path ? updatedFile : f));
                                        if (updatedFile.path !== file.path) {
                                            scanFolder(currentPath || '', currentPage);
                                        }
                                        if (!silent) showToast(t('toast.info_updated'));
                                    }}
                                    onDelete={(f: MediaFile) => setFileToDelete(f)}
                                    onMoveCopy={(f: MediaFile) => setItemToMoveCopy(f)}
                                    onEdit={() => onFileSelect(file)}
                                    selected={selectedPaths.has(file.path)}
                                    onToggleSelect={() => handleToggleSelect(file.path)}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </main>

            <footer className="footer">
                <div className="footer-info">
                    <span>{effectiveTotalItems} {t('browser.items_listed')} {filterType !== 'all' ? `(${t('filter.' + filterType + '_only')})` : ''}</span>
                    <div className="footer-divider" />
                    <span>{activeTab === 'all' ? t('sidebar.all_media') : t(`sidebar.${activeTab === 'images' ? 'photos' : activeTab}`)}</span>
                </div>

                {totalPages > 1 && (
                    <div className="pagination">
                        <button disabled={currentPage === 1} onClick={(e) => { e.stopPropagation(); handlePageChange(currentPage - 1); }} className="icon-btn pagination-btn"><ArrowLeft size={16} /></button>
                        <div className="pagination-text-wrapper" style={{ position: 'relative' }}>
                            <div
                                className="pagination-text clickable"
                                onClick={(e) => { e.stopPropagation(); setShowPageMenu(!showPageMenu); }}
                            >
                                <span className="page-current">{currentPage}</span> / {totalPages}
                            </div>
                            <AnimatePresence>
                                {showPageMenu && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                        className="page-select-menu"
                                    >
                                        <div className="page-menu-header">{t('browser.go_to_page')}</div>
                                        <div className="page-menu-grid">
                                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                                                <button
                                                    key={p}
                                                    className={`page-menu-item ${currentPage === p ? 'active' : ''}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handlePageChange(p);
                                                        setShowPageMenu(false);
                                                    }}
                                                >
                                                    {p}
                                                </button>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        <button disabled={currentPage === totalPages} onClick={(e) => { e.stopPropagation(); handlePageChange(currentPage + 1); }} className="icon-btn pagination-btn"><ChevronRight size={16} /></button>
                    </div>
                )}
                <div className="version-text">MediaBrowser v1.0.0</div>
            </footer>

            {/* Create Folder Modal */}
            <AnimatePresence>
                {showNewFolderModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="browser-modal-overlay"
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 10 }}
                            className="browser-modal-content"
                        >
                            <div className="browser-modal-header">
                                <h3 className="browser-modal-title">{t('browser.create_folder')}</h3>
                                <button onClick={() => setShowNewFolderModal(false)} className="browser-modal-close-btn"><X size={20} /></button>
                            </div>

                            <div className="modal-body">
                                <label htmlFor="new-folder-name" className="input-label">{t('browser.new_folder_name')}</label>
                                <input
                                    id="new-folder-name"
                                    name="folderName"
                                    type="text"
                                    autoFocus
                                    value={newFolderName}
                                    onChange={(e) => {
                                        setNewFolderName(e.target.value);
                                        if (folderError) setFolderError('');
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleCreateFolder();
                                        if (e.key === 'Escape') setShowNewFolderModal(false);
                                    }}
                                    placeholder={t('browser.folder_name_placeholder')}
                                    className={`modal-input ${folderError ? 'error' : ''}`}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                                {folderError && (
                                    <span className="input-error-text">{folderError}</span>
                                )}
                            </div>

                            <div className="browser-modal-footer">
                                <button
                                    onClick={() => setShowNewFolderModal(false)}
                                    className="browser-btn-cancel"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    onClick={handleCreateFolder}
                                    disabled={!newFolderName.trim()}
                                    className="browser-btn-confirm"
                                >
                                    {t('common.create')}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Delete Confirmation Modal */}
            <AnimatePresence>
                {(fileToDelete || isBulkDelete) && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="browser-modal-overlay"
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 10 }}
                            className="browser-modal-content delete-modal"
                        >
                            <div className="browser-modal-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#ef4444' }}>
                                    <Trash2 size={20} />
                                    <h3 className="browser-modal-title">{t('modal.delete_title')}</h3>
                                </div>
                                <button onClick={() => { setFileToDelete(null); setIsBulkDelete(false); }} className="browser-modal-close-btn"><X size={20} /></button>
                            </div>

                            <div className="modal-body delete-modal-body">
                                <p className="delete-desc">
                                    {isBulkDelete ?
                                        t('modal.delete_selected_desc', { count: selectedPaths.size }) :
                                        t(fileToDelete?.file_type === 'folder' ? 'modal.delete_folder_desc' : 'modal.delete_file_desc', {
                                            filename: fileToDelete?.filename || ''
                                        })
                                    }
                                </p>

                                <div className="deletion-settings" style={{ marginTop: '1rem', position: 'relative' }}>
                                    <label className="input-label" style={{ display: 'block', marginBottom: '8px' }}>
                                        {t('settings.delete_method_label')}
                                    </label>

                                    <div
                                        className="custom-select-trigger modal-input"
                                        onClick={() => setShowDeletionMenu(!showDeletionMenu)}
                                    >
                                        <span>{t(`settings.delete_${{ DoD3: 'dod', DoD7: 'dod_7' }[deletionMethod] || deletionMethod.toLowerCase()}`)}</span>
                                        <ChevronDown size={16} className={`select-arrow ${showDeletionMenu ? 'open' : ''}`} />
                                    </div>

                                    <AnimatePresence>
                                        {showDeletionMenu && (
                                            <motion.div
                                                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                                className="custom-select-menu"
                                            >
                                                {['Trash', 'Standard', 'Fast', 'Random', 'DoD3', 'DoD7', 'NSA', 'NAVSO', 'VSITR', 'Gutmann'].map(method => (
                                                    <div
                                                        key={method}
                                                        className={`custom-select-item ${deletionMethod === method ? 'active' : ''}`}
                                                        onClick={() => {
                                                            setDeletionMethod(method);
                                                            setShowDeletionMenu(false);
                                                        }}
                                                    >
                                                        {t(`settings.delete_${{ DoD3: 'dod', DoD7: 'dod_7' }[method] || method.toLowerCase()}`)}
                                                    </div>
                                                ))}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>

                            <div className="browser-modal-footer">
                                <button
                                    onClick={() => { setFileToDelete(null); setIsBulkDelete(false); }}
                                    disabled={isDeleting}
                                    className="browser-btn-cancel"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    onClick={handleDeleteConfirm}
                                    disabled={isDeleting}
                                    className="browser-btn-delete"
                                >
                                    {isDeleting ? (
                                        <RefreshCw size={18} className="animate-spin" />
                                    ) : (
                                        t('modal.yes_delete')
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {(itemToMoveCopy || bulkActionType) && (
                    <FolderPickerModal
                        isOpen={!!itemToMoveCopy || !!bulkActionType}
                        onClose={() => { setItemToMoveCopy(null); setBulkActionType(null); }}
                        onSelect={handleMoveCopySelect}
                        initialPath={currentPath || initialPath || ''}
                        galleryRoot={initialPath || ''}
                        title={bulkActionType
                            ? t('card.copy_move_selected_count', { count: selectedPaths.size })
                            : t('card.copy_move_title', { filename: itemToMoveCopy?.filename || '' })}
                        isLoading={isProcessingAction}
                        excludePath={itemToMoveCopy?.path}
                        excludePaths={selectedPaths}
                    />
                )}
            </AnimatePresence>

            {/* Toast System */}
            <div className="toast-container">
                <AnimatePresence>
                    {toasts.map(toast => (
                        <motion.div
                            key={toast.id}
                            initial={{ opacity: 0, x: 20, scale: 0.9 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: 20, scale: 0.9 }}
                            className={`toast ${toast.type === 'success' ? 'toast-success' : (toast.type === 'error' ? 'toast-error' : 'toast-info')}`}
                        >
                            {toast.type === 'success' && <div className="toast-icon"><RefreshCw size={14} /></div>}
                            {toast.message}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div >
    );
};

export default MediaBrowser;
