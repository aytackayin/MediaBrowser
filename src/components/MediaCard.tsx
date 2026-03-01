import React, { useState, useEffect } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Image as ImageIcon, Video, Music, Folder,
    Info, Copy, Scissors, Trash2, Play, Check
} from 'lucide-react';
import Tooltip from './Tooltip';
import { useLanguage } from './LanguageContext';
import MediaInfoModal from './MediaInfoModal';
import './MediaCard.css';

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
    fps?: number;
    video_codec?: string;
    audio_codec?: string;
    bitrate?: number;
    sample_rate?: number;
}

interface MediaCardProps {
    file: MediaFile;
    onSelect: () => void;
    highlighted?: boolean;
    galleryRoot?: string;
    onUpdate?: (updatedFile: MediaFile, silent?: boolean) => void;
    onDelete?: (file: MediaFile) => void;
    onMoveCopy?: (file: MediaFile) => void;
    onEdit?: () => void;
    selected?: boolean;
    onToggleSelect?: () => void;
    onDoubleClick?: () => void;
}

const MediaCard: React.FC<MediaCardProps> = ({
    file, onSelect, highlighted, galleryRoot, onUpdate, onDelete, onMoveCopy, onEdit,
    selected, onToggleSelect, onDoubleClick
}) => {
    const { t } = useLanguage();
    const [thumbnail, setThumbnail] = useState<string | null>(null);
    const [error, setError] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [showInfoModal, setShowInfoModal] = useState(false);
    const [retryCount, setRetryCount] = useState(0);

    const fetchThumbnail = async () => {
        if (file.file_type === 'folder' || !galleryRoot) return;
        try {
            if (file.file_type === 'image' || file.file_type === 'video') {
                const thumbPath: string = await invoke('get_thumbnail', {
                    originalPath: file.path,
                    galleryRoot: galleryRoot
                });
                // Tauri v2 on Windows works better with forward slashes for URLs
                const normalizedThumbPath = thumbPath.replace(/\\/g, '/');
                const assetUrl = convertFileSrc(normalizedThumbPath);
                setThumbnail(assetUrl + `?t=${file.mtime}${retryCount > 0 ? `&r=${retryCount}` : ''}`);
                setError(false);
            }
        } catch (err) {
            setError(true);
        }
    };

    useEffect(() => {
        fetchThumbnail();
    }, [file.path, file.file_type, file.mtime, galleryRoot, retryCount]);

    const handleImageError = () => {
        if (retryCount < 3) {
            setTimeout(() => {
                setRetryCount(prev => prev + 1);
            }, 1000); // Retry after 1s
        } else {
            setError(true);
        }
    };

    const Icon = file.file_type === 'image' ? ImageIcon : file.file_type === 'video' ? Video : file.file_type === 'folder' ? Folder : Music;
    const isFolder = file.file_type === 'folder';

    return (
        <>
            <div
                id={`media-item-${file.path}`}
            >
                <motion.div
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                    onClick={(e) => {
                        if (e.ctrlKey || e.metaKey) {
                            onToggleSelect?.();
                        } else {
                            onSelect();
                        }
                    }}
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        // Çift tıklamada seçim işlemi zaten click ile ateşlendiği için direkt onDoubleClick çağrılır
                        if (onDoubleClick) onDoubleClick();
                    }}
                    className={`media-card ${highlighted ? 'highlighted' : ''}`}
                >
                    <div
                        className="card-inner"
                    >
                        {isFolder ? (
                            <div className="folder-container">
                                <div className="folder-icon-wrapper">
                                    <motion.div animate={{ scale: isHovered ? 1.1 : 1, rotate: isHovered ? 5 : 0 }}>
                                        <Folder size={64} className="folder-icon" />
                                    </motion.div>
                                </div>
                                <div className="folder-label">
                                    <p className="folder-name">
                                        {file.filename}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <>
                                <AnimatePresence>
                                    {!isHovered && (
                                        <motion.div
                                            initial={{ opacity: 0, x: -5 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -5 }}
                                            className="extension-badge"
                                            style={{
                                                backgroundColor: (() => {
                                                    const ext = file.filename.split('.').pop()?.toLowerCase();
                                                    if (['jpg', 'jpeg', 'mp4', 'mp3'].includes(ext || '')) return '#3b82f6'; // Mavi
                                                    if (ext === 'png') return '#a855f7'; // Mor
                                                    return '#eab308'; // Sarı
                                                })()
                                            }}
                                        >
                                            {file.filename.split('.').pop()}
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                {thumbnail && !error ? (
                                    <img
                                        src={thumbnail}
                                        alt={file.filename}
                                        onError={handleImageError}
                                        className={`media-thumbnail ${isHovered ? 'hovered' : ''}`}
                                    />
                                ) : (
                                    <div className="placeholder-wrapper">
                                        <Icon size={48} className="placeholder-icon" />
                                    </div>
                                )}

                                {/* VIDEO PLAY ICON */}
                                {file.file_type === 'video' && (
                                    <div className="video-play-icon">
                                        <Play size={22} fill="white" className="play-icon-offset" />
                                    </div>
                                )}
                            </>
                        )}

                        {/* Selection Checkbox */}
                        <div
                            className={`selection-checkbox ${selected ? 'selected' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelect();
                                onToggleSelect?.();
                            }}
                        >
                            {selected && <Check size={14} strokeWidth={3} color="white" />}
                        </div>

                        <AnimatePresence>
                            {isHovered && (
                                <div className="hover-overlay">
                                    {/* Filename Floating Badge */}
                                    {!isFolder && (
                                        <motion.div
                                            initial={{ y: 10, opacity: 0, scale: 0.95 }}
                                            animate={{ y: 0, opacity: 1, scale: 1 }}
                                            exit={{ y: 10, opacity: 0, scale: 0.95 }}
                                            transition={{ duration: 0.2 }}
                                            className="floating-badge filename-badge"
                                        >
                                            <div className="filename-text">
                                                {file.filename}
                                            </div>
                                        </motion.div>
                                    )}

                                    {/* Actions Floating Badge */}
                                    <motion.div
                                        initial={{ y: 10, opacity: 0, scale: 0.95 }}
                                        animate={{ y: 0, opacity: 1, scale: 1 }}
                                        exit={{ y: 10, opacity: 0, scale: 0.95 }}
                                        transition={{ duration: 0.2, delay: 0.05 }}
                                        className="floating-badge action-bar"
                                    >
                                        <Tooltip text={t('card.info')}>
                                            <button
                                                className="c-btn btn-info"
                                                onClick={(e) => { e.stopPropagation(); onSelect(); setShowInfoModal(true); }}
                                            >
                                                <Info size={16} />
                                            </button>
                                        </Tooltip>
                                        <Tooltip text={t('card.copy_move')}>
                                            <button className="c-btn btn-copy" onClick={(e) => { e.stopPropagation(); onSelect(); if (onMoveCopy) onMoveCopy(file); }}><Copy size={16} /></button>
                                        </Tooltip>
                                        {!isFolder && (
                                            <Tooltip text={t('card.edit')}>
                                                <button className="c-btn btn-edit" onClick={(e) => { e.stopPropagation(); onSelect(); if (onEdit) onEdit(); }}><Scissors size={16} /></button>
                                            </Tooltip>
                                        )}
                                        <Tooltip text={t('card.delete')}>
                                            <button
                                                className="c-btn btn-delete"
                                                onClick={(e) => { e.stopPropagation(); onSelect(); if (onDelete) onDelete(file); }}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </Tooltip>
                                    </motion.div>
                                </div>
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>
            </div>

            <AnimatePresence>
                {showInfoModal && (
                    <MediaInfoModal
                        file={file}
                        galleryRoot={galleryRoot || ''}
                        onClose={() => setShowInfoModal(false)}
                        onUpdate={(updatedFile, silent) => {
                            if (onUpdate) onUpdate(updatedFile, silent);
                        }}
                    />
                )}
            </AnimatePresence>
        </>
    );
};

export default React.memo(MediaCard, (prevProps, nextProps) => {
    return prevProps.file.path === nextProps.file.path &&
        prevProps.file.mtime === nextProps.file.mtime &&
        prevProps.highlighted === nextProps.highlighted &&
        prevProps.selected === nextProps.selected &&
        prevProps.galleryRoot === nextProps.galleryRoot;
});
