import React, { useState } from 'react';
import { useLanguage } from './LanguageContext';
import Tooltip from './Tooltip';
import { Globe, Moon, Sun, Monitor, Plus, Folder, Trash2, X, RotateCcw, Eraser, CheckCircle2, AlertTriangle, Shield, GripVertical, Loader2, Lock, Play, Film, Captions } from 'lucide-react';
import { Reorder } from 'framer-motion';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import './SettingsPage.css';

interface Gallery {
    id: string;
    name: string;
    path: string;
}

interface SettingsPageProps {
    galleries: Gallery[];
    setGalleries: React.Dispatch<React.SetStateAction<Gallery[]>>;
    onGallerySelected?: (id: string) => void;
    busyGalleryIds: string[];
    setBusyGalleryIds: React.Dispatch<React.SetStateAction<string[]>>;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ galleries, setGalleries, onGallerySelected, busyGalleryIds, setBusyGalleryIds }) => {
    const { t, language, setLanguage } = useLanguage();
    const [theme, setTheme] = useState<'dark' | 'light' | 'system'>(() => {
        return (localStorage.getItem('app_theme') as any) || 'dark';
    });
    const [showAddModal, setShowAddModal] = useState(false);
    const [showResetModal, setShowResetModal] = useState<{ show: boolean, galleryId: string | null, all: boolean }>({ show: false, galleryId: null, all: false });
    const [showSuccessModal, setShowSuccessModal] = useState<{ show: boolean, count?: number }>({ show: false });
    const [newGallery, setNewGallery] = useState({ name: '', path: '' });
    const [shredMethod, setShredMethod] = useState<string>(() => {
        return localStorage.getItem('shred_method') || 'DoD3';
    });
    const [isResetting, setIsResetting] = useState(false);

    // Player Settings
    const [autoPlay, setAutoPlay] = useState(() => localStorage.getItem('player_autoplay') === 'true');
    const [loop, setLoop] = useState(() => localStorage.getItem('player_loop') === 'true');
    const [loopCount, setLoopCount] = useState(() => parseInt(localStorage.getItem('player_loop_count') || '0'));
    const [autoSlideshow, setAutoSlideshow] = useState(() => localStorage.getItem('player_auto_slideshow') === 'true');
    const [slideshowDuration, setSlideshowDuration] = useState(() => parseInt(localStorage.getItem('player_slideshow_duration') || '5'));

    // Subtitle Customization States
    const [subFontSize, setSubFontSize] = useState(() => parseInt(localStorage.getItem('player_sub_font_size') || '24'));
    const [subFontColor, setSubFontColor] = useState(() => localStorage.getItem('player_sub_font_color') || '#ffffff');
    const [subBgColor, setSubBgColor] = useState(() => localStorage.getItem('player_sub_bg_color') || '#000000');
    const [subBgOpacity, setSubBgOpacity] = useState(() => parseFloat(localStorage.getItem('player_sub_bg_opacity') || '0.75'));
    const [subBgBlur, setSubBgBlur] = useState(() => parseInt(localStorage.getItem('player_sub_bg_blur') || '10'));
    const [activeTab, setActiveTab] = useState<'general' | 'viewer' | 'galleries'>('general');

    // Refs for scroll prevention
    const loopInputRef = React.useRef<HTMLInputElement>(null);
    const slideInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        const handleLoopWheel = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY < 0 ? 1 : -1;
            setLoopCount(prev => {
                const newVal = Math.max(0, Math.min(999, prev + delta));
                localStorage.setItem('player_loop_count', String(newVal));
                return newVal;
            });
        };

        const handleSlideWheel = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY < 0 ? 1 : -1;
            setSlideshowDuration(prev => {
                const newVal = Math.max(1, Math.min(999, prev + delta));
                localStorage.setItem('player_slideshow_duration', String(newVal));
                return newVal;
            });
        };

        const lInput = loopInputRef.current;
        const sInput = slideInputRef.current;

        if (lInput) lInput.addEventListener('wheel', handleLoopWheel, { passive: false });
        if (sInput) sInput.addEventListener('wheel', handleSlideWheel, { passive: false });

        return () => {
            if (lInput) lInput.removeEventListener('wheel', handleLoopWheel);
            if (sInput) sInput.removeEventListener('wheel', handleSlideWheel);
        };
    }, []);

    const handleThemeChange = (newTheme: 'dark' | 'light' | 'system') => {
        setTheme(newTheme);
        localStorage.setItem('app_theme', newTheme);
    };

    const handleShredMethodChange = (method: string) => {
        setShredMethod(method);
        localStorage.setItem('shred_method', method);
    };

    const handleReset = async () => {
        const id = showResetModal.galleryId;
        const all = showResetModal.all;

        setIsResetting(true);
        // Add to busy list
        if (all) {
            setBusyGalleryIds(galleries.map(g => g.id));
        } else if (id) {
            setBusyGalleryIds(prev => [...prev, id]);
        }

        try {
            if (all) {
                for (const g of galleries) {
                    await invoke('reset_gallery', { galleryRoot: g.path, method: shredMethod });
                }
            } else if (id) {
                const g = galleries.find(x => x.id === id);
                if (g) await invoke('reset_gallery', { galleryRoot: g.path, method: shredMethod });
            }
            setShowResetModal({ show: false, galleryId: null, all: false });
        } catch (err) {
        } finally {
            setIsResetting(false);
            // Remove from busy list
            if (all) {
                setBusyGalleryIds([]);
            } else if (id) {
                setBusyGalleryIds(prev => prev.filter(x => x !== id));
            }
        }
    };

    const handleClear = async (galleryId?: string) => {
        // Set busy
        if (!galleryId) {
            setBusyGalleryIds(galleries.map(g => g.id));
        } else {
            setBusyGalleryIds(prev => [...prev, galleryId]);
        }

        try {
            let totalDeleted = 0;
            if (!galleryId) {
                // All
                for (const g of galleries) {
                    const count: number = await invoke('clear_thumbnails', { galleryRoot: g.path, method: shredMethod });
                    totalDeleted += count;
                }
            } else {
                const g = galleries.find(x => x.id === galleryId);
                if (g) {
                    const count: number = await invoke('clear_thumbnails', { galleryRoot: g.path, method: shredMethod });
                    totalDeleted = count;
                }
            }
            setShowSuccessModal({ show: true, count: totalDeleted });
        } catch (err) {
        } finally {
            // Unset busy
            if (!galleryId) {
                setBusyGalleryIds([]);
            } else {
                setBusyGalleryIds(prev => prev.filter(x => x !== galleryId));
            }
        }
    };

    const addGallery = () => {
        const name = newGallery.name.trim();
        const path = newGallery.path.trim();
        if (!name || !path) return;
        const id = Math.random().toString(36).substr(2, 9);
        const updated = [...galleries, { id, name, path }];
        setGalleries(updated);
        localStorage.setItem('app_galleries', JSON.stringify(updated));
        setNewGallery({ name: '', path: '' });
        setShowAddModal(false);
        if (onGallerySelected) onGallerySelected(id);
    };

    const selectPath = async () => {
        const selected = await open({
            directory: true,
            multiple: false,
        });
        if (selected) {
            const path = typeof selected === 'string' ? selected : selected[0];
            setNewGallery((prev: any) => ({ ...prev, path }));
            if (!newGallery.name) {
                // Set default name from path
                const name = path.split(/[\\/]/).filter(Boolean).pop() || 'New Gallery';
                setNewGallery((prev: any) => ({ ...prev, name }));
            }
        }
    };

    const deleteGallery = (id: string) => {
        const updated = galleries.filter(g => g.id !== id);
        setGalleries(updated);
        localStorage.setItem('app_galleries', JSON.stringify(updated));
    };

    const handleReorder = (newOrder: Gallery[]) => {
        setGalleries(newOrder);
        localStorage.setItem('app_galleries', JSON.stringify(newOrder));
    };

    return (
        <div className="content-area settings-container">
            <h1 className="settings-title">{t('settings.title')}</h1>

            <div className="settings-tabs">
                <button
                    className={`settings-tab-btn ${activeTab === 'general' ? 'active' : ''}`}
                    onClick={() => setActiveTab('general')}
                >
                    <Shield size={18} />
                    {t('settings.tab_general')}
                </button>
                <button
                    className={`settings-tab-btn ${activeTab === 'viewer' ? 'active' : ''}`}
                    onClick={() => setActiveTab('viewer')}
                >
                    <Play size={18} />
                    {t('settings.tab_viewer')}
                </button>
                <button
                    className={`settings-tab-btn ${activeTab === 'galleries' ? 'active' : ''}`}
                    onClick={() => setActiveTab('galleries')}
                >
                    <Folder size={18} />
                    {t('settings.tab_galleries')}
                </button>
            </div>

            <div className="settings-content-wrapper">
                {/* Galleries Section */}
                {activeTab === 'galleries' && (
                    <div className="settings-card" style={{ marginBottom: '24px' }}>
                        <div className="galleries-header">
                            <div className="galleries-header-left">
                                <Folder size={20} className="settings-card-icon" />
                                <h3 className="settings-card-title">{t('settings.galleries')}</h3>
                            </div>
                            <div className="galleries-header-right">
                                <div className="galleries-actions">
                                    <Tooltip text={t('settings.clear_all')}>
                                        <button className="settings-icon-btn clear-btn" onClick={() => handleClear()}>
                                            <Eraser size={18} />
                                        </button>
                                    </Tooltip>
                                    <Tooltip text={t('settings.reset_all')}>
                                        <button className="settings-icon-btn reset-btn" onClick={() => setShowResetModal({ show: true, galleryId: null, all: true })}>
                                            <RotateCcw size={18} />
                                        </button>
                                    </Tooltip>
                                </div>
                                <div className="header-divider" />
                                <Tooltip text={t('settings.add_gallery')}>
                                    <button
                                        onClick={() => setShowAddModal(true)}
                                        className="settings-icon-btn add-btn"
                                    >
                                        <Plus size={18} />
                                    </button>
                                </Tooltip>
                            </div>
                        </div>

                        <Reorder.Group axis="y" values={galleries} onReorder={handleReorder} className="gallery-list">
                            {galleries.length === 0 ? (
                                <div className="gallery-empty">
                                    <Folder size={32} className="gallery-empty-icon" />
                                    <p className="gallery-empty-text">{t('settings.no_galleries')}</p>
                                </div>
                            ) : (
                                galleries.map((g, index) => {
                                    const isBusy = busyGalleryIds.includes(g.id);
                                    return (
                                        <Reorder.Item key={g.id || `settings-gallery-${index}`} value={g} className={`gallery-item ${isBusy ? 'busy' : ''}`} dragListener={!isBusy}>
                                            <div className="gallery-item-info">
                                                <div className="drag-handle" style={{ cursor: isBusy ? 'not-allowed' : 'grab' }}>
                                                    {isBusy ? <Lock size={18} className="lock-icon" /> : <GripVertical size={20} />}
                                                </div>
                                                <div className="gallery-item-text">
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <span className="gallery-item-name">{g.name}</span>
                                                        {isBusy && <Loader2 size={14} className="animate-spin text-blue" />}
                                                    </div>
                                                    <span className="gallery-item-path">{g.path}</span>
                                                </div>
                                            </div>
                                            <div className="gallery-item-actions">
                                                <Tooltip text={t('settings.clear_gallery')}>
                                                    <button
                                                        className="gallery-action-btn clear"
                                                        onClick={() => handleClear(g.id)}
                                                        disabled={isBusy}
                                                    >
                                                        <Eraser size={16} />
                                                    </button>
                                                </Tooltip>
                                                <Tooltip text={t('settings.reset_gallery')}>
                                                    <button
                                                        className="gallery-action-btn reset"
                                                        onClick={() => setShowResetModal({ show: true, galleryId: g.id, all: false })}
                                                        disabled={isBusy}
                                                    >
                                                        <RotateCcw size={16} />
                                                    </button>
                                                </Tooltip>
                                                <div className="action-divider" />
                                                <Tooltip text={t('settings.delete_gallery')}>
                                                    <button
                                                        onClick={() => !isBusy && deleteGallery(g.id)}
                                                        className="gallery-action-btn delete"
                                                        disabled={isBusy}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </Tooltip>
                                            </div>
                                        </Reorder.Item>
                                    );
                                })
                            )}
                        </Reorder.Group>
                    </div>
                )}

                <div className="settings-grid">
                    {activeTab === 'general' && (
                        <>
                            <div className="settings-card">
                                <div className="settings-card-header">
                                    <Globe size={20} className="settings-card-icon" />
                                    <h3 className="settings-card-title">{t('settings.language')}</h3>
                                </div>
                                <div className="settings-btn-group">
                                    {['tr', 'en'].map(lang => (
                                        <button
                                            key={lang}
                                            onClick={() => setLanguage(lang as any)}
                                            className={`settings-btn ${language === lang ? 'active' : ''}`}
                                        >
                                            {lang === 'tr' ? 'Türkçe' : 'English'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="settings-card">
                                <div className="settings-card-header">
                                    <Sun size={20} className="settings-card-icon" />
                                    <h3 className="settings-card-title">{t('settings.theme')}</h3>
                                </div>
                                <div className="settings-btn-group">
                                    {[
                                        { id: 'dark', icon: Moon, label: t('settings.theme_dark') },
                                        { id: 'light', icon: Sun, label: t('settings.theme_light') },
                                        { id: 'system', icon: Monitor, label: t('settings.theme_system') }
                                    ].map(t_item => (
                                        <button
                                            key={t_item.id}
                                            onClick={() => handleThemeChange(t_item.id as any)}
                                            className={`theme-btn ${theme === t_item.id ? 'active' : ''}`}
                                        >
                                            <t_item.icon size={14} />
                                            {t_item.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="settings-card full-width">
                                <div className="settings-card-header">
                                    <Shield size={20} className="settings-card-icon" />
                                    <h3 className="settings-card-title">{t('settings.delete_method_label')}</h3>
                                </div>
                                <div className="shred-method-list">
                                    {[
                                        { id: 'Trash', label: t('settings.delete_trash') },
                                        { id: 'Standard', label: t('settings.delete_standard') },
                                        { id: 'Fast', label: t('settings.delete_fast') },
                                        { id: 'Random', label: t('settings.delete_random') },
                                        { id: 'NSA', label: t('settings.delete_nsa') },
                                        { id: 'DoD3', label: t('settings.delete_dod') },
                                        { id: 'NAVSO', label: t('settings.delete_navso') },
                                        { id: 'DoD7', label: t('settings.delete_dod_7') },
                                        { id: 'VSITR', label: t('settings.delete_vsitr') },
                                        { id: 'Gutmann', label: t('settings.delete_gutmann') }
                                    ].map(m => (
                                        <label htmlFor={`shred-${m.id}`} key={m.id} className={`shred-option ${shredMethod === m.id ? 'active' : ''}`}>
                                            <input
                                                id={`shred-${m.id}`}
                                                type="radio"
                                                name="shredMethod"
                                                value={m.id}
                                                checked={shredMethod === m.id}
                                                onChange={(e) => handleShredMethodChange(e.target.value)}
                                                autoComplete="off"
                                            />
                                            <span className="shred-option-label">{m.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {activeTab === 'viewer' && (
                        <>
                            {/* Player Settings */}
                            <div className="settings-card">
                                <div className="settings-card-header">
                                    <Play size={20} className="settings-card-icon" />
                                    <h3 className="settings-card-title">{t('settings.player')}</h3>
                                </div>
                                <div className="settings-rows">
                                    <div className="settings-row">
                                        <div className="settings-row-info">
                                            <span className="settings-row-label">{t('settings.player_autoplay')}</span>
                                            <span className="settings-row-desc">{t('settings.player_autoplay_desc')}</span>
                                        </div>
                                        <button
                                            className={`settings-toggle ${autoPlay ? 'active' : ''}`}
                                            onClick={() => {
                                                const next = !autoPlay;
                                                setAutoPlay(next);
                                                localStorage.setItem('player_autoplay', String(next));
                                            }}
                                        >
                                            <span className="settings-toggle-slider" />
                                        </button>
                                    </div>
                                    <div className="settings-row">
                                        <div className="settings-row-info">
                                            <span className="settings-row-label">{t('settings.player_loop')}</span>
                                            <span className="settings-row-desc">{t('settings.player_loop_desc')}</span>
                                        </div>
                                        <div className="settings-row-controls">
                                            <input
                                                id="settings-loop-count"
                                                name="loopCount"
                                                type="number"
                                                className="settings-number-input"
                                                min={0}
                                                max={999}
                                                value={loopCount}
                                                disabled={!loop}
                                                onChange={(e) => {
                                                    const v = Math.max(0, Math.min(999, parseInt(e.target.value) || 0));
                                                    setLoopCount(v);
                                                    localStorage.setItem('player_loop_count', String(v));
                                                }}
                                                autoComplete="off"
                                                ref={loopInputRef}
                                            />
                                            <button
                                                className={`settings-toggle ${loop ? 'active' : ''}`}
                                                onClick={() => {
                                                    const next = !loop;
                                                    setLoop(next);
                                                    localStorage.setItem('player_loop', String(next));
                                                }}
                                            >
                                                <span className="settings-toggle-slider" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Slideshow Settings */}
                            <div className="settings-card">
                                <div className="settings-card-header">
                                    <Film size={20} className="settings-card-icon" />
                                    <h3 className="settings-card-title">{t('settings.slideshow')}</h3>
                                </div>
                                <div className="settings-rows">
                                    <div className="settings-row">
                                        <div className="settings-row-info">
                                            <span className="settings-row-label">{t('settings.slideshow_auto')}</span>
                                            <span className="settings-row-desc">{t('settings.slideshow_auto_desc')}</span>
                                        </div>
                                        <button
                                            className={`settings-toggle ${autoSlideshow ? 'active' : ''}`}
                                            onClick={() => {
                                                const next = !autoSlideshow;
                                                setAutoSlideshow(next);
                                                localStorage.setItem('player_auto_slideshow', String(next));
                                            }}
                                        >
                                            <span className="settings-toggle-slider" />
                                        </button>
                                    </div>
                                    <div className="settings-row">
                                        <div className="settings-row-info">
                                            <span className="settings-row-label">{t('settings.slideshow_duration')}</span>
                                            <span className="settings-row-desc">{t('settings.slideshow_duration_desc')}</span>
                                        </div>
                                        <input
                                            id="settings-slideshow-duration"
                                            name="slideshowDuration"
                                            type="number"
                                            className="settings-number-input"
                                            min={1}
                                            max={999}
                                            value={slideshowDuration}
                                            disabled={!autoSlideshow}
                                            onChange={(e) => {
                                                const v = Math.max(1, Math.min(999, parseInt(e.target.value) || 5));
                                                setSlideshowDuration(v);
                                                localStorage.setItem('player_slideshow_duration', String(v));
                                            }}
                                            ref={slideInputRef}
                                            autoComplete="off"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Subtitle Settings */}
                            <div className="settings-card full-width">
                                <div className="settings-card-header">
                                    <Captions size={20} className="settings-card-icon" />
                                    <h3 className="settings-card-title">{t('settings.subtitles')}</h3>
                                </div>
                                <div className="settings-rows">
                                    <div className="settings-row">
                                        <div className="settings-row-info">
                                            <span className="settings-row-label">{t('settings.sub_font_size')}</span>
                                        </div>
                                        <div className="settings-row-controls">
                                            <input
                                                id="settings-sub-font-size"
                                                name="subFontSize"
                                                type="number"
                                                className="settings-number-input"
                                                min={12}
                                                max={120}
                                                value={subFontSize}
                                                onChange={(e) => {
                                                    const v = Math.max(12, Math.min(120, parseInt(e.target.value) || 12));
                                                    setSubFontSize(v);
                                                    localStorage.setItem('player_sub_font_size', String(v));
                                                }}
                                                autoComplete="off"
                                            />
                                            <span className="unit-label">px</span>
                                        </div>
                                    </div>
                                    <div className="settings-row">
                                        <div className="settings-row-info">
                                            <span className="settings-row-label">{t('settings.sub_font_color')}</span>
                                        </div>
                                        <input
                                            id="settings-sub-font-color"
                                            name="subFontColor"
                                            type="color"
                                            className="color-picker"
                                            value={subFontColor}
                                            onChange={(e) => {
                                                setSubFontColor(e.target.value);
                                                localStorage.setItem('player_sub_font_color', e.target.value);
                                            }}
                                            autoComplete="off"
                                        />
                                    </div>
                                    <div className="settings-row">
                                        <div className="settings-row-info">
                                            <span className="settings-row-label">{t('settings.sub_bg_color')}</span>
                                        </div>
                                        <input
                                            id="settings-sub-bg-color"
                                            name="subBgColor"
                                            type="color"
                                            className="color-picker"
                                            value={subBgColor}
                                            onChange={(e) => {
                                                setSubBgColor(e.target.value);
                                                localStorage.setItem('player_sub_bg_color', e.target.value);
                                            }}
                                            autoComplete="off"
                                        />
                                    </div>
                                    <div className="settings-row">
                                        <div className="settings-row-info">
                                            <span className="settings-row-label">{t('settings.sub_bg_opacity')}</span>
                                        </div>
                                        <div className="settings-row-controls">
                                            <input
                                                id="settings-sub-bg-opacity"
                                                name="subBgOpacity"
                                                type="range"
                                                min="0"
                                                max="1"
                                                step="0.05"
                                                value={subBgOpacity}
                                                onChange={(e) => {
                                                    const v = parseFloat(e.target.value);
                                                    setSubBgOpacity(v);
                                                    localStorage.setItem('player_sub_bg_opacity', String(v));
                                                }}
                                                autoComplete="off"
                                            />
                                            <span className="unit-label" style={{ minWidth: '45px', textAlign: 'right' }}>
                                                {Math.round(subBgOpacity * 100)}%
                                            </span>
                                        </div>
                                    </div>
                                    <div className="settings-row">
                                        <div className="settings-row-info">
                                            <span className="settings-row-label">{t('settings.sub_bg_blur')}</span>
                                        </div>
                                        <div className="settings-row-controls">
                                            <input
                                                id="settings-sub-bg-blur"
                                                name="subBgBlur"
                                                type="range"
                                                min="0"
                                                max="40"
                                                step="1"
                                                value={subBgBlur}
                                                onChange={(e) => {
                                                    const v = parseInt(e.target.value);
                                                    setSubBgBlur(v);
                                                    localStorage.setItem('player_sub_bg_blur', String(v));
                                                }}
                                                autoComplete="off"
                                            />
                                            <span className="unit-label" style={{ minWidth: '45px', textAlign: 'right' }}>
                                                {subBgBlur}px
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Add Gallery Modal */}
            {
                showAddModal && (
                    <div className="settings-modal-overlay">
                        <div className="settings-modal">
                            <div className="settings-modal-header">
                                <h3 className="settings-modal-title">{t('settings.add_gallery')}</h3>
                                <button onClick={() => setShowAddModal(false)} className="settings-modal-close">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="settings-form">
                                <div className="settings-form-group">
                                    <label htmlFor="new-gallery-name" className="settings-form-label">{t('settings.gallery_name')}</label>
                                    <input
                                        id="new-gallery-name"
                                        name="galleryName"
                                        type="text"
                                        value={newGallery.name}
                                        onChange={(e) => setNewGallery(prev => ({ ...prev, name: e.target.value }))}
                                        placeholder={t('settings.gallery_name_placeholder')}
                                        className="settings-form-input"
                                        autoComplete="off"
                                    />
                                </div>

                                <div className="settings-form-group">
                                    <label htmlFor="new-gallery-path" className="settings-form-label">{t('settings.gallery_path')}</label>
                                    <div className="settings-form-row">
                                        <input
                                            id="new-gallery-path"
                                            name="galleryPath"
                                            type="text"
                                            readOnly
                                            value={newGallery.path}
                                            placeholder={t('settings.gallery_path_placeholder')}
                                            className="settings-form-input"
                                            style={{ flex: 1 }}
                                            autoComplete="off"
                                        />
                                        <button onClick={selectPath} className="browse-btn">
                                            {t('settings.browse')}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={addGallery}
                                disabled={!newGallery.name || !newGallery.path}
                                className="settings-submit-btn"
                            >
                                {t('settings.save_gallery')}
                            </button>
                        </div>
                    </div>
                )
            }
            {/* Reset Confirmation Modal */}
            {
                showResetModal.show && (
                    <div className="settings-modal-overlay">
                        <div className="settings-modal reset-modal">
                            <div className="reset-modal-icon">
                                <AlertTriangle size={48} color="#ef4444" />
                            </div>
                            <h3 className="settings-modal-title" style={{ textAlign: 'center' }}>
                                {t('modal.reset_title')}
                            </h3>
                            <p className="reset-modal-desc">
                                {t('modal.reset_desc').replace('{method}', t('settings.delete_' + shredMethod.toLowerCase()))}
                            </p>
                            <div className="reset-modal-actions">
                                <button
                                    className="modal-btn-secondary"
                                    onClick={() => setShowResetModal({ show: false, galleryId: null, all: false })}
                                    disabled={isResetting}
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    className="modal-btn-danger"
                                    onClick={handleReset}
                                    disabled={isResetting}
                                >
                                    {isResetting ? (
                                        <>
                                            <Loader2 size={18} className="animate-spin" style={{ marginRight: '8px' }} />
                                            {t('editor.reset')}...
                                        </>
                                    ) : (
                                        t('editor.reset')
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Clear Success Modal */}
            {
                showSuccessModal.show && (
                    <div className="settings-modal-overlay">
                        <div className="settings-modal success-modal">
                            <div className="success-modal-icon">
                                <CheckCircle2 size={48} color="var(--accent-blue)" />
                            </div>
                            <h3 className="settings-modal-title" style={{ textAlign: 'center' }}>
                                {t('modal.clear_title')}
                            </h3>
                            <p className="success-modal-desc">
                                {t('modal.clear_desc')
                                    .replace('{count}', (showSuccessModal.count || 0).toString())
                                    .replace('{method}', t('settings.delete_' + shredMethod.toLowerCase()))}
                            </p>
                            <button className="settings-submit-btn" onClick={() => setShowSuccessModal({ show: false })}>
                                {t('common.close')}
                            </button>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default SettingsPage;
