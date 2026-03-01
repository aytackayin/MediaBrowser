import React, { useState } from 'react';
import { Folder, Settings, LibraryBig, Loader2, Wrench, Scissors, Film, RefreshCcw } from 'lucide-react';
import Tooltip from './Tooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from './LanguageContext';
import './Sidebar.css';

interface SidebarProps {
    view: 'browser' | 'editor' | 'video_editor' | 'settings';
    setView: (view: 'browser' | 'editor' | 'video_editor' | 'settings') => void;
    galleries: { id: string, name: string, path: string }[];
    activeGalleryId: string | null;
    setActiveGalleryId: (id: string) => void;
    busyGalleryIds: string[];
    onOpenExternalImage: () => void;
    onOpenExternalVideo: () => void;
    onOpenExternalConverter: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ view, setView, galleries, activeGalleryId, setActiveGalleryId, busyGalleryIds, onOpenExternalImage, onOpenExternalVideo, onOpenExternalConverter }) => {
    const { t } = useLanguage();
    const [showGalleries, setShowGalleries] = useState(false);
    const [showTools, setShowTools] = useState(false);

    return (
        <aside className="sidebar">
            <div className="sidebar-brand">
                <img src={`/images/favicon.png?v=${Date.now()}`} className="brand-logo" alt="MediaBrowser Logo" />
            </div>

            <nav className="sidebar-nav">
                <div
                    key="galleries-menu"
                    className="gallery-btn-wrapper"
                    onMouseEnter={() => setShowGalleries(true)}
                    onMouseLeave={() => setShowGalleries(false)}
                >
                    <button
                        className={`gallery-btn ${showGalleries ? 'active' : ''}`}
                        onClick={() => {
                            if (galleries.length > 0) {
                                setActiveGalleryId(galleries[0].id);
                            }
                            setShowGalleries(!showGalleries);
                        }}
                    >
                        <div className="btn-content-full">
                            <LibraryBig size={24} />
                        </div>
                    </button>

                    {/* POPOUT GALLERY LIST */}
                    <AnimatePresence>
                        {showGalleries && (
                            <motion.div
                                key="galleries-popout"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                                transition={{ duration: 0.2 }}
                                className="gallery-popout"
                            >
                                <div className="popout-header">
                                    {t('sidebar.galleries')}
                                </div>
                                <div className="popout-list">
                                    {galleries.map((g, index) => {
                                        const isBusy = busyGalleryIds.includes(g.id);
                                        return (
                                            <button
                                                key={g.id || `gallery-${index}`}
                                                onClick={() => !isBusy && setActiveGalleryId(g.id)}
                                                className={`popout-item ${activeGalleryId === g.id ? 'active' : ''} ${isBusy ? 'busy' : ''}`}
                                                disabled={isBusy}
                                                style={{ cursor: isBusy ? 'not-allowed' : 'pointer' }}
                                            >
                                                {isBusy ? (
                                                    <Loader2 size={16} className="animate-spin" />
                                                ) : (
                                                    <Folder size={16} />
                                                )}
                                                <span>{g.name}</span>
                                            </button>
                                        );
                                    })}
                                    {galleries.length === 0 && (
                                        <div key="no-galleries-msg" className="no-galleries">
                                            {t('sidebar.no_galleries')}
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* TOOLS MENU */}
                <div
                    key="tools-menu"
                    className="gallery-btn-wrapper"
                    onMouseEnter={() => setShowTools(true)}
                    onMouseLeave={() => setShowTools(false)}
                >
                    <button className={`gallery-btn ${showTools ? 'active' : ''}`}>
                        <div className="btn-content-full">
                            <Wrench size={24} />
                        </div>
                    </button>

                    <AnimatePresence>
                        {showTools && (
                            <motion.div
                                key="tools-popout"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                                transition={{ duration: 0.2 }}
                                className="gallery-popout"
                            >
                                <div className="popout-header">
                                    {t('sidebar.tools')}
                                </div>
                                <div className="popout-list">
                                    <button
                                        key="ext-editor-btn"
                                        onClick={() => {
                                            setShowTools(false);
                                            onOpenExternalImage();
                                        }}
                                        className="popout-item tool-image"
                                    >
                                        <Scissors size={16} />
                                        <span>{t('sidebar.external_image_editor')}</span>
                                    </button>
                                    <button
                                        key="ext-video-btn"
                                        onClick={() => {
                                            setShowTools(false);
                                            onOpenExternalVideo();
                                        }}
                                        className="popout-item tool-video"
                                    >
                                        <Film size={16} />
                                        <span>{t('sidebar.external_video_editor')}</span>
                                    </button>
                                    <button
                                        key="ext-converter-btn"
                                        onClick={() => {
                                            setShowTools(false);
                                            onOpenExternalConverter();
                                        }}
                                        className="popout-item tool-converter"
                                    >
                                        <RefreshCcw size={16} />
                                        <span>{t('sidebar.external_video_converter')}</span>
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </nav>

            <div className="sidebar-footer">
                <button
                    className={`nav-item ${view === 'settings' ? 'active' : ''}`}
                    onClick={() => setView('settings')}
                >
                    <Tooltip text={t('sidebar.settings')}>
                        <div className="btn-content-full">
                            <Settings size={18} />
                        </div>
                    </Tooltip>
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
