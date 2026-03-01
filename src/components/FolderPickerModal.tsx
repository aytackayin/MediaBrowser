import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Folder, ArrowLeft, X, Loader2, Home, Copy, Move } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useLanguage } from './LanguageContext';
import './FolderPickerModal.css';

interface MediaFile {
    path: string;
    filename: string;
    file_type: string;
}

interface PagedResult {
    items: MediaFile[];
    total: number;
}

interface FolderPickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (path: string, action: 'copy' | 'move') => void;
    initialPath: string;
    galleryRoot: string;
    title?: string;
    isLoading?: boolean;
    excludePath?: string;
    excludePaths?: Set<string> | string[];
}

const FolderPickerModal: React.FC<FolderPickerModalProps> = ({
    isOpen, onClose, onSelect, initialPath, galleryRoot, title, isLoading = false, excludePath, excludePaths
}) => {
    const { t } = useLanguage();
    const displayTitle = title || t('browser.select_target_folder');
    const [currentPath, setCurrentPath] = useState(initialPath);
    const [folders, setFolders] = useState<MediaFile[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadFolders(currentPath);
        }
    }, [currentPath, isOpen]);

    const loadFolders = async (path: string) => {
        setLoading(true);
        try {
            const result = await invoke('scan_folder', {
                path,
                galleryRoot,
                page: 1,
                pageSize: 1000, // Fetch many to ensure we see folders
                sortBy: 'name',
                sortDirection: 'asc',
                searchQuery: ''
            }) as PagedResult;

            // Filter only folders AND exclude the current item being moved/copied
            const folderList = result.items.filter(f =>
                f.file_type === 'folder' &&
                (!excludePath || f.path !== excludePath) &&
                (!excludePaths || (excludePaths instanceof Set ? !excludePaths.has(f.path) : !excludePaths.includes(f.path)))
            );
            setFolders(folderList);
        } catch (error) {
        } finally {
            setLoading(false);
        }
    };

    const handleFolderClick = (path: string) => {
        setCurrentPath(path);
    };

    // Improved Back Logic: use substring based on separator
    const goUp = () => {
        if (currentPath === galleryRoot) return;

        const isWindows = currentPath.includes('\\');
        const separator = isWindows ? '\\' : '/';
        const lastIndex = currentPath.lastIndexOf(separator);

        if (lastIndex > -1) {
            // Keep the root drive like C:\
            if (lastIndex === 2 && currentPath[1] === ':') {
                setCurrentPath(currentPath.substring(0, 3));
                return;
            }
            let newPath = currentPath.substring(0, lastIndex);
            if (newPath.length === 0) newPath = separator; // Root
            // Don't go above drive root logic if needed, but for now simple
            setCurrentPath(newPath);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="folder-picker-overlay"
            >
                <motion.div
                    initial={{ scale: 0.95, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 20 }}
                    className="folder-picker-modal"
                >
                    {/* Header */}
                    <div className="folder-picker-header">
                        <div className="folder-picker-header-left">
                            <Folder size={20} color="#3b82f6" />
                            <h3 className="folder-picker-title">{displayTitle}</h3>
                        </div>
                        <button onClick={onClose} className="folder-picker-close-btn">
                            <X size={20} />
                        </button>
                    </div>

                    {/* Navbar */}
                    <div className="folder-picker-navbar">
                        <button
                            onClick={goUp}
                            disabled={currentPath.length <= galleryRoot.length}
                            className="folder-picker-nav-btn nav-back"
                        >
                            <ArrowLeft size={16} />
                        </button>
                        <div className="folder-picker-path">
                            {currentPath}
                        </div>
                        <button
                            onClick={() => setCurrentPath(galleryRoot)}
                            className="folder-picker-nav-btn nav-home"
                        >
                            <Home size={16} />
                        </button>
                    </div>

                    {/* List */}
                    <div className="folder-picker-list">
                        {loading ? (
                            <div className="folder-picker-loading">
                                <Loader2 className="animate-spin" color="#3b82f6" />
                            </div>
                        ) : (
                            <div className="folder-picker-folders">
                                {folders.length === 0 && (
                                    <div className="folder-picker-empty">{t('browser.no_subfolders')}</div>
                                )}
                                {folders.map(folder => (
                                    <div
                                        key={folder.path}
                                        onClick={() => handleFolderClick(folder.path)}
                                        className="folder-picker-item"
                                    >
                                        <Folder size={18} color="#fbbf24" fill="#fbbf24" fillOpacity={0.2} />
                                        <span className="folder-picker-item-name">{folder.filename}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="folder-picker-footer">
                        <button
                            onClick={onClose}
                            disabled={isLoading}
                            className="folder-picker-cancel-btn"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            onClick={() => onSelect(currentPath, 'copy')}
                            disabled={isLoading}
                            className="folder-picker-action-btn copy"
                        >
                            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Copy size={18} />}
                            {t('browser.copy_here')}
                        </button>
                        <button
                            onClick={() => onSelect(currentPath, 'move')}
                            disabled={isLoading}
                            className="folder-picker-action-btn move"
                        >
                            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Move size={18} />}
                            {t('browser.move_here')}
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default FolderPickerModal;
