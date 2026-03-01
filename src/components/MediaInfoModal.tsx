import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Save, Info, FileText, Type, Maximize, Activity, Speaker, HardDrive, AlertCircle, Loader2, Folder, Copy, ExternalLink, Clock } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useLanguage } from './LanguageContext';
import Tooltip from './Tooltip';
import './MediaInfoModal.css';

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

interface MediaInfoModalProps {
    file: MediaFile;
    galleryRoot: string;
    onClose: () => void;
    onUpdate: (updatedFile: MediaFile, silent?: boolean) => void;
}

const MediaInfoModal: React.FC<MediaInfoModalProps> = ({ file, galleryRoot, onClose, onUpdate }) => {
    const { t } = useLanguage();

    const [currentFile, setCurrentFile] = useState<MediaFile>(file);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const isFolder = currentFile.file_type === 'folder';

    // Get raw name without extension (only for files)
    const dotIndex = currentFile.filename.lastIndexOf('.');
    const nameOnly = (isFolder || dotIndex === -1) ? currentFile.filename : currentFile.filename.substring(0, dotIndex);
    const extension = (isFolder || dotIndex === -1) ? '' : currentFile.filename.substring(dotIndex + 1);

    const [newName, setNewName] = useState(nameOnly);
    const [notes, setNotes] = useState(currentFile.notes || '');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [nameConflict, setNameConflict] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [showCopyFeedback, setShowCopyFeedback] = useState(false);

    useEffect(() => {
        if (isFolder) return; // Folders don't need technical details fetch
        const fetchDetails = async () => {
            setIsLoadingDetails(true);
            try {
                const details = await invoke('get_file_details', {
                    path: file.path,
                    galleryRoot: galleryRoot
                }) as MediaFile;

                setCurrentFile(details);
                setNotes(details.notes || '');
                onUpdate(details, true);
            } catch (err) {
            } finally {
                setIsLoadingDetails(false);
            }
        };

        fetchDetails();
    }, [file.path, galleryRoot, isFolder]);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizeNames = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizeNames[i];
    };

    const formatDuration = (seconds?: number) => {
        if (seconds === undefined || seconds === null || seconds === 0) return null;
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleSave = async () => {
        if (isSaving) return;
        setIsSaving(true);
        setError('');
        setNameConflict(false);

        try {
            let updatedFileState = { ...currentFile };

            // 1. Rename if name changed
            if (newName !== nameOnly) {
                try {
                    const result = await invoke('rename_media_file', {
                        oldPath: currentFile.path,
                        newFilename: newName,
                        galleryRoot: galleryRoot
                    }) as MediaFile;
                    updatedFileState = result;
                } catch (err: any) {
                    if (err.toString().includes("already exists")) {
                        setNameConflict(true);
                        setIsSaving(false);
                        return;
                    }
                    throw err;
                }
            }

            // 2. Save notes if changed
            if (notes !== (updatedFileState.notes || '')) {
                await invoke('save_note', {
                    path: updatedFileState.path,
                    galleryRoot: galleryRoot,
                    note: notes
                });
                updatedFileState.notes = notes;
            }

            onUpdate(updatedFileState);
            setShowSuccess(true);
            setTimeout(() => {
                onClose();
            }, 1000);
        } catch (err: any) {
            setError(err.toString());
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="media-info-overlay"
        >
            <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="media-info-modal"
                onClick={(e) => e.stopPropagation()}
            >
                {showSuccess && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="media-info-success"
                    >
                        <div className="media-info-success-icon">
                            <Save size={32} color="#10b981" />
                        </div>
                        <span className="media-info-success-text">{t('common.saved_success')}</span>
                    </motion.div>
                )}

                {/* Header */}
                <div className="media-info-header">
                    <div className="media-info-header-left">
                        <div className={`media-info-icon ${isFolder ? 'folder' : 'file'}`}>
                            {isFolder ? <Folder size={20} color="#a855f7" /> : <Info size={20} color="#3b82f6" />}
                        </div>
                        <h2 className="media-info-title">{isFolder ? t('card.folder_info') : t('card.info')}</h2>
                    </div>
                    <button onClick={onClose} className="media-info-close-btn">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="media-info-body">

                    {/* Metadata Grid (Only for files) */}
                    {!isFolder && (
                        <>
                            <div className="media-info-metadata">
                                {isLoadingDetails && (
                                    <div className="media-info-loading">
                                        <Loader2 className="animate-spin" size={24} color="#a855f7" />
                                    </div>
                                )}
                                <div className={`media-info-grid ${isLoadingDetails ? 'loading' : ''}`}>
                                    <InfoItem icon={<Type size={14} />} label={t('media.type')} value={currentFile.file_type} color="blue" />
                                    <InfoItem icon={<Maximize size={14} />} label={t('media.resolution')} value={currentFile.width && currentFile.height ? `${currentFile.width} x ${currentFile.height}` : '-'} color="purple" />
                                    {currentFile.duration && currentFile.duration > 0 && (
                                        <InfoItem icon={<Clock size={14} />} label={t('media.duration')} value={formatDuration(currentFile.duration) || '-'} color="orange" />
                                    )}
                                    <InfoItem icon={<HardDrive size={14} />} label={t('media.size')} value={formatSize(currentFile.size)} color="emerald" />

                                    {currentFile.fps && <InfoItem icon={<Activity size={14} />} label={t('media.fps')} value={`${currentFile.fps!.toFixed(2)} fps`} color="rose" />}
                                    {currentFile.video_codec && <InfoItem icon={<FileText size={14} />} label={t('media.video_codec')} value={currentFile.video_codec!} color="cyan" />}
                                    {currentFile.audio_codec && <InfoItem icon={<Speaker size={14} />} label={t('media.audio_codec')} value={currentFile.audio_codec!} color="yellow" />}
                                    {currentFile.bitrate && <InfoItem icon={<Activity size={14} />} label={t('media.bitrate')} value={`${(currentFile.bitrate! / 1000).toFixed(0)} kbps`} color="indigo" />}
                                    {currentFile.sample_rate && <InfoItem icon={<Speaker size={14} />} label={t('media.sample_rate')} value={`${currentFile.sample_rate} Hz`} color="sky" />}
                                </div>
                            </div>
                            <div className="media-info-divider" />
                        </>
                    )}

                    {/* Edit Form */}
                    <div className="media-info-form">
                        {/* Full Path Actions */}
                        <div className="media-info-form-group">
                            <span className="media-info-label">{t('media.full_path')}</span>
                            <div className="media-info-path-box">
                                <Tooltip text={currentFile.path}>
                                    <span className="media-info-path-text">{currentFile.path}</span>
                                </Tooltip>
                                <div className="media-info-path-actions">
                                    <Tooltip text={t('media.copy_path')}>
                                        <button
                                            className={`path-action-btn copy-btn ${showCopyFeedback ? 'copy-success' : ''}`}
                                            onClick={async () => {
                                                await navigator.clipboard.writeText(currentFile.path);
                                                setShowCopyFeedback(true);
                                                setTimeout(() => setShowCopyFeedback(false), 2000);
                                            }}
                                        >
                                            <motion.div
                                                animate={showCopyFeedback ? { scale: [1, 1.4, 1], color: ['#fff', '#10b981', '#fff'] } : {}}
                                                transition={{ duration: 0.5 }}
                                            >
                                                {showCopyFeedback ? <Save size={14} /> : <Copy size={14} />}
                                            </motion.div>
                                        </button>
                                    </Tooltip>
                                    <Tooltip text={t('media.open_in_explorer')}>
                                        <button
                                            className="path-action-btn explorer-btn"
                                            onClick={() => invoke('reveal_in_explorer', { path: currentFile.path })}
                                        >
                                            <ExternalLink size={14} />
                                        </button>
                                    </Tooltip>
                                </div>
                            </div>
                        </div>

                        {/* Filename */}
                        <div className="media-info-form-group">
                            <label htmlFor="media-info-name-input" className="media-info-label">{isFolder ? t('media.folder_name') : t('media.file_name')}</label>
                            <div className="media-info-input-wrapper">
                                <div className={`media-info-input-row ${nameConflict ? 'error' : ''}`}>
                                    <input
                                        id="media-info-name-input"
                                        name="filename"
                                        type="text"
                                        value={newName}
                                        onChange={(e) => { setNewName(e.target.value); setNameConflict(false); }}
                                        className="media-info-input"
                                        autoComplete="off"
                                    />
                                    {extension && (
                                        <div className="media-info-extension">.{extension}</div>
                                    )}
                                </div>
                                {nameConflict && (
                                    <div className="media-info-error">
                                        <AlertCircle size={12} />
                                        <span>{t('media.name_conflict_error')}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Notes */}
                        <div className="media-info-form-group">
                            <label htmlFor="media-info-notes-textarea" className="media-info-label">{t('media.notes')}</label>
                            <textarea
                                id="media-info-notes-textarea"
                                name="notes"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder={t('media.add_note_placeholder')}
                                className="media-info-textarea"
                                autoComplete="off"
                            />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="media-info-footer">
                    <button onClick={onClose} className="media-info-cancel-btn">
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className={`media-info-save-btn ${isFolder ? 'folder' : ''}`}
                    >
                        {isSaving ? t('common.saving') : <><Save size={18} /> {t('common.save')}</>}
                    </button>
                </div>

                {error && (
                    <div className="media-info-error-banner">
                        {t('common.error_prefix')}{error}
                    </div>
                )}
            </motion.div>
        </motion.div>
    );
};

const InfoItem = ({ icon, label, value, color }: { icon: React.ReactNode, label: string, value: string, color: string }) => (
    <div className={`info-item ${color}`}>
        <div className="info-item-header">
            {icon}
            <span className="info-item-label">{label}</span>
        </div>
        <div className="info-item-value">{value}</div>
    </div>
);

export default MediaInfoModal;
