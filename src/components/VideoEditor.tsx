import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { X, Save, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, ChevronLeft, ChevronRight, MousePointer2, Maximize2, Undo2, Redo2, Scissors, Crop, Folder, Info } from 'lucide-react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { useLanguage } from './LanguageContext';
import Tooltip from './Tooltip';
import Preview from './video-editor/Preview';
import Properties from './video-editor/Properties';
import TextPropertiesPanel from './video-editor/TextPropertiesPanel';
import Timeline from './video-editor/Timeline';
import DraggableHistory from './video-editor/DraggableHistory';
import DraggableDock from './video-editor/DraggableDock';
import TransformPanel from './video-editor/TransformPanel';
import ColorBalancePanel from './video-editor/ColorBalancePanel';
import AudioSettingsPanel from './video-editor/AudioSettingsPanel';
import { DEFAULT_SETTINGS } from './video-editor/types';
import type { Track, Clip, VideoEditorProps, VideoSettings } from './video-editor/types';
import './VideoEditor.css';

// ─── Main Component ───
const VideoEditor: React.FC<VideoEditorProps> = ({ file, onClose, onSaveSuccess, galleryRoot }) => {
    const { t } = useLanguage();

    // === State ===
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [zoom, setZoom] = useState(10);
    const [selectedClipId, setSelectedClipId] = useState<number | null>(null);
    const [timelineHeight, setTimelineHeight] = useState(() => {
        const saved = localStorage.getItem('ve_timeline_height');
        return saved ? parseInt(saved) : 300;
    });
    const [settings, setSettings] = useState<VideoSettings>({ ...DEFAULT_SETTINGS });
    const [canvasSize, setCanvasSize] = useState({ w: 1920, h: 1080 });
    const [isLocked, setIsLocked] = useState(true);
    const [activeTool, setActiveTool] = useState<'select' | 'transform' | 'crop'>('select');

    const [tracks, setTracks] = useState<Track[]>([
        { id: 1, type: 'video', name: t('video.track_video') + ' 1', clips: [] },
        { id: 2, type: 'audio', name: t('video.track_audio') + ' 1', clips: [] },
    ]);
    const latestTracksRef = useRef(tracks);
    useEffect(() => { latestTracksRef.current = tracks; }, [tracks]);
    const isMovingWithKeys = useRef(false);

    const selectedClip = useMemo(() => {
        if (!selectedClipId) return null;
        for (const track of tracks) {
            const clip = track.clips.find(c => c.id === selectedClipId);
            if (clip) return clip;
        }
        return null;
    }, [selectedClipId, tracks]);

    const [localCrop, setLocalCrop] = useState<{ x: number, y: number, w: number, h: number } | null>(null);

    // ─── Save Modal States ───
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [savePath, setSavePath] = useState('');
    const [saveFormat, setSaveFormat] = useState<'mp4' | 'webm' | 'mp3'>('mp4');
    const [isSaving, setIsSaving] = useState(false);
    const [renderProgress, setRenderProgress] = useState(0);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
    const [saveMessage, setSaveMessage] = useState('');
    const [comparisonVideoPath, setComparisonVideoPath] = useState<string | null>(null);
    const [exportTime, setExportTime] = useState(0);
    const [showInfoModal, setShowInfoModal] = useState(false);

    // Listen for render progress from backend
    useEffect(() => {
        const unlisten = listen<number>('video-render-progress', (event) => {
            setRenderProgress(event.payload);
        });
        return () => {
            unlisten.then(f => f());
        };
    }, []);

    // Sync localCrop when entering crop mode
    useEffect(() => {
        if (activeTool === 'crop' && selectedClip) {
            setLocalCrop(selectedClip.crop || { x: 0, y: 0, w: 1, h: 1 });
            // User Hack: Start Free then immediately Lock
            setIsLocked(false);
            const t = setTimeout(() => setIsLocked(true), 50);
            return () => clearTimeout(t);
        } else {
            setLocalCrop(null);
        }
    }, [activeTool, selectedClip?.id]);

    // ─── History System ───
    const [undoStack, setUndoStack] = useState<any[]>([]);
    const [redoStack, setRedoStack] = useState<any[]>([]);
    const loadedFileRef = useRef<string | null>(null);

    const lastSavedState = useRef<string>(JSON.stringify({
        tracks: [
            { id: 1, type: 'video', name: t('video.track_video') + ' 1', clips: [] },
            { id: 2, type: 'audio', name: t('video.track_audio') + ' 1', clips: [] },
        ],
        settings: { ...DEFAULT_SETTINGS },
        canvasSize: { w: 1920, h: 1080 },
        _historyLabel: t('history.initial') || 'Initial'
    }));

    // -- Font Loading (Borrowed from ImageEditor logic) --
    useEffect(() => {
        const GOOGLE_FONTS = [
            'Inter', 'Roboto', 'Montserrat', 'Open Sans', 'Lato', 'Poppins', 'Ubuntu', 'Oswald', 'Raleway',
            'Playfair Display', 'Merriweather', 'Lora', 'Libre Baskerville', 'Dancing Script', 'Pacifico',
            'Caveat', 'Satisfy', 'Great Vibes', 'Permanent Marker', 'Lobster', 'Righteous', 'Fredoka One',
            'Abel', 'Anton', 'Bebas Neue', 'Exo 2', 'Cinzel', 'Quicksand', 'Josefin Sans',
            'Fira Code', 'Roboto Mono', 'Source Code Pro', 'VT323'
        ];

        const addedLinks: string[] = [];
        GOOGLE_FONTS.forEach(font => {
            if (!font) return;
            const fontId = `ve-google-font-${font.replace(/\s+/g, '-').toLowerCase()}`;
            if (!document.getElementById(fontId)) {
                const link = document.createElement('link');
                link.id = fontId;
                link.rel = 'stylesheet';
                const fontQuery = font.replace(/\s+/g, '+');
                link.href = `https://fonts.googleapis.com/css2?family=${fontQuery}:wght@100;300;400;500;600;700;800;900&display=swap`;
                document.head.appendChild(link);
                addedLinks.push(fontId);
            }
        });

        return () => {
            addedLinks.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.remove();
            });
        };
    }, []);

    // Clear large history stacks, comparison state, and temp backups on unmount
    useEffect(() => {
        return () => {
            setUndoStack([]);
            setRedoStack([]);
            setComparisonVideoPath(null);
            // Clean gallery temp folder when leaving editor
            if (galleryRoot) {
                invoke('clean_gallery_temp', { galleryRoot }).catch(() => { });
            }
        };
    }, [galleryRoot]);

    const canUndo = undoStack.length > 0;
    const canRedo = redoStack.length > 0;

    const [pendingHistoryLabel, setPendingHistoryLabel] = useState<string | null>(null);

    const performSaveHistory = useCallback((label: string, overrideTracks?: Track[], overrideSettings?: VideoSettings, overrideCanvasSize?: { w: number, h: number }) => {
        const nextState = {
            tracks: overrideTracks ? JSON.parse(JSON.stringify(overrideTracks)) : JSON.parse(JSON.stringify(tracks)),
            settings: overrideSettings ? { ...overrideSettings } : { ...settings },
            canvasSize: overrideCanvasSize ? { ...overrideCanvasSize } : { ...canvasSize },
            _historyLabel: label || 'Edit'
        };
        const lastFull = JSON.parse(lastSavedState.current);
        const nextCmp = JSON.stringify({ tracks: nextState.tracks, settings: nextState.settings, canvasSize: nextState.canvasSize });
        const lastCmp = JSON.stringify({ tracks: lastFull.tracks, settings: lastFull.settings, canvasSize: lastFull.canvasSize });

        if (nextCmp === lastCmp) return;

        setUndoStack(prev => [...prev.slice(-49), lastFull]);
        setRedoStack([]);
        lastSavedState.current = JSON.stringify(nextState);
    }, [tracks, settings, canvasSize]);

    const saveHistory = useCallback((label?: string, overrideTracks?: Track[], overrideSettings?: VideoSettings, overrideCanvasSize?: { w: number, h: number }) => {
        if (overrideTracks || overrideSettings || overrideCanvasSize) {
            performSaveHistory(label || 'Düzenleme', overrideTracks, overrideSettings, overrideCanvasSize);
        } else {
            setPendingHistoryLabel(label || 'Düzenleme');
        }
    }, [performSaveHistory]);

    useEffect(() => {
        if (pendingHistoryLabel) {
            performSaveHistory(pendingHistoryLabel);
            setPendingHistoryLabel(null);
        }
    }, [pendingHistoryLabel, performSaveHistory]);

    const undo = useCallback(() => {
        if (undoStack.length === 0) return;
        const currentData = {
            tracks: JSON.parse(JSON.stringify(tracks)),
            settings: { ...settings },
            canvasSize: { ...canvasSize },
            _historyLabel: JSON.parse(lastSavedState.current)._historyLabel
        };
        const prev = undoStack[undoStack.length - 1];
        setRedoStack(rs => [...rs, currentData]);
        setTracks(prev.tracks);
        setSettings(prev.settings);
        setCanvasSize(prev.canvasSize || { w: 1920, h: 1080 });
        setUndoStack(us => us.slice(0, -1));
        lastSavedState.current = JSON.stringify(prev);
    }, [undoStack, tracks, settings, canvasSize]);

    const redo = useCallback(() => {
        if (redoStack.length === 0) return;
        const currentData = {
            tracks: JSON.parse(JSON.stringify(tracks)),
            settings: { ...settings },
            canvasSize: { ...canvasSize },
            _historyLabel: JSON.parse(lastSavedState.current)._historyLabel
        };
        const next = redoStack[redoStack.length - 1];
        setUndoStack(us => [...us, currentData]);
        setTracks(next.tracks);
        setSettings(next.settings);
        setCanvasSize(next.canvasSize || { w: 1920, h: 1080 });
        setRedoStack(rs => rs.slice(0, -1));
        lastSavedState.current = JSON.stringify(next);
    }, [redoStack, tracks, settings, canvasSize]);

    const revertToState = useCallback((index: number) => {
        const fullStack = [...undoStack, JSON.parse(lastSavedState.current), ...[...redoStack].reverse()];
        const target = fullStack[index];
        if (!target) return;
        const newUndo = fullStack.slice(0, index);
        const newRedo = fullStack.slice(index + 1).reverse();
        setTracks(target.tracks);
        setSettings(target.settings);
        setCanvasSize(target.canvasSize || { w: 1920, h: 1080 });
        setUndoStack(newUndo);
        setRedoStack(newRedo);
        lastSavedState.current = JSON.stringify(target);
    }, [undoStack, redoStack]);

    // Calculate content duration
    const contentDuration = useMemo(() => {
        let max = 0;
        tracks.forEach(t => {
            t.clips.forEach(c => {
                const end = c.timelineStart + c.duration;
                if (end > max) max = end;
            });
        });
        return Math.max(max, 0.1);
    }, [tracks]);

    // Find active clips at current time
    const activeClips = useMemo(() => {
        const active: Clip[] = [];
        const OVERLAP = 0.5; // 500ms overlap to prevent flicker/mount lag
        [...tracks].reverse().forEach(track => {
            track.clips.forEach(c => {
                const end = c.timelineStart + c.duration;
                if (currentTime >= c.timelineStart - OVERLAP && currentTime < end + OVERLAP) {
                    active.push(c);
                }
            });
        });
        return active;
    }, [tracks, currentTime]);


    const currentDims = useMemo(() => {
        if (selectedClip) {
            const baseW = selectedClip.width || 1280;
            const baseH = selectedClip.height || 720;
            const sx = selectedClip.transform?.scaleX ?? 1;
            const sy = selectedClip.transform?.scaleY ?? 1;
            return {
                w: Math.round(baseW * sx),
                h: Math.round(baseH * sy),
                x: Math.round(selectedClip.transform?.x || 0),
                y: Math.round(selectedClip.transform?.y || 0),
                baseW,
                baseH
            };
        }
        return { w: canvasSize.w, h: canvasSize.h, x: 0, y: 0, baseW: 0, baseH: 0 };
    }, [selectedClip, canvasSize]);

    const updateClipTransform = useCallback((id: number, t: any) => {
        setTracks(prev => prev.map(track => ({
            ...track,
            clips: track.clips.map(clip => clip.id === id ? { ...clip, transform: { ...clip.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1 }, ...t } } : clip)
        })));
    }, []);

    const updateClipCrop = useCallback((id: number, c: any) => {
        setTracks(prev => prev.map(track => ({
            ...track,
            clips: track.clips.map(clip => clip.id === id ? { ...clip, crop: { ...clip.crop || { x: 0, y: 0, w: 1, h: 1 }, ...c } } : clip)
        })));
    }, []);

    useEffect(() => {
        setDuration(contentDuration > 0 ? contentDuration : 10);
    }, [contentDuration]);

    useEffect(() => {
        const isSamePath = file?.path && loadedFileRef.current &&
            file.path.replace(/\\/g, '/').toLowerCase() === loadedFileRef.current.replace(/\\/g, '/').toLowerCase();

        if (file && (file.file_type === 'video' || file.file_type === 'audio' || file.file_type === 'image') && !isSamePath) {
            loadedFileRef.current = file.path;
            const clipId = Date.now();
            const initialTracks: Track[] = [
                { id: 1, type: 'video', name: t('video.track_video') + ' 1', clips: [] },
                { id: 2, type: 'audio', name: t('video.track_audio') + ' 1', clips: [] },
            ];

            const targetTrack = file.file_type === 'audio' ? 1 : 0;
            const newClip: Clip = {
                id: clipId,
                path: file.path,
                mtime: file.mtime,
                name: file.filename,
                timelineStart: 0,
                sourceStart: 0,
                duration: file.duration || 10,
                width: file.width,
                height: file.height
            };
            initialTracks[targetTrack].clips = [newClip];

            // Update baseline history so clicking "Start" returns to the loaded clip, not empty tracks
            const initialCanvasSize = (file.width && file.height) ? { w: file.width, h: file.height } : { w: 1920, h: 1080 };
            lastSavedState.current = JSON.stringify({
                tracks: initialTracks,
                settings: { ...DEFAULT_SETTINGS },
                canvasSize: initialCanvasSize,
                _historyLabel: t('history.initial') || 'Initial'
            });

            setTracks(initialTracks);
            setSelectedClipId(clipId);
            setCanvasSize(initialCanvasSize);

            // Prepare proxy
            invoke<{ path: string, width?: number, height?: number, duration?: number }>('ensure_video_proxy', { path: file.path }).then(proxyData => {
                const proxyPath = proxyData.path;
                const proxyW = proxyData.width;
                const proxyH = proxyData.height;
                const proxyDur = proxyData.duration;

                // Sync canvas size if it was default and proxy has different metadata
                if (proxyW && proxyH) {
                    setCanvasSize(prev => {
                        if (prev.w === 1920 && prev.h === 1080 && (proxyW !== 1920 || proxyH !== 1080)) {
                            return { w: proxyW, h: proxyH };
                        }
                        return prev;
                    });
                }

                setTracks(prev => {
                    const next = prev.map(tr => ({
                        ...tr,
                        clips: tr.clips.map(c => c.id === clipId ? {
                            ...c,
                            path: proxyPath,
                            width: c.width || proxyW,
                            height: c.height || proxyH,
                            duration: (c.duration === 10 && proxyDur) ? proxyDur : c.duration
                        } : c)
                    }));

                    // Update baseline history
                    try {
                        const currentHistory = JSON.parse(lastSavedState.current);
                        if (currentHistory._historyLabel === (t('history.initial') || 'Initial')) {
                            lastSavedState.current = JSON.stringify({
                                ...currentHistory,
                                tracks: next,
                                canvasSize: (proxyW && proxyH && currentHistory.canvasSize.w === 1920) ? { w: proxyW, h: proxyH } : currentHistory.canvasSize
                            });
                        }
                    } catch (e) { /* ignore */ }

                    return next;
                });
            }).catch(() => { });
        }
    }, [file, t]); // Safe dependency list: triggers only on file load or language change

    // Playhead sync handled via Preview.tsx

    const handlePlayPause = useCallback(() => {
        if (!isPlaying) {
            // Başlatma mantığı
            if (selectedClip) {
                const clipEnd = selectedClip.timelineStart + selectedClip.duration;
                // İmleç klibin sonunda veya sonrasındaysa başa dön
                if (currentTime >= clipEnd - 0.05) {
                    setCurrentTime(selectedClip.timelineStart);
                }
            } else {
                // Hiçbir klip seçili değilse ve imleç sondaysa başa dön
                if (currentTime >= duration - 0.05) {
                    setCurrentTime(0);
                }
            }
        }
        setIsPlaying(prev => !prev);
    }, [isPlaying, selectedClip, currentTime, duration]);


    const deleteSelectedClip = useCallback(() => {
        if (selectedClipId === null) return;
        const newTracks = tracks.map(track => ({ ...track, clips: track.clips.filter(c => c.id !== selectedClipId) }));
        setTracks(newTracks);
        setSelectedClipId(null);
        saveHistory(t('history.delete_clip') || 'Klibi Sil', newTracks);
    }, [selectedClipId, setTracks, tracks, saveHistory, t]);

    const splitSelectedClip = useCallback(() => {
        if (selectedClipId === null) return;
        let splitDone = false;
        const newTracks = tracks.map(track => {
            const idx = track.clips.findIndex(c => c.id === selectedClipId);
            if (idx === -1) return track;
            const clip = track.clips[idx];
            if (currentTime <= clip.timelineStart || currentTime >= clip.timelineStart + clip.duration) return track;
            const splitOffset = currentTime - clip.timelineStart;
            const clipSpeed = clip.speed || 1;
            // Rounding to 4 decimal places to avoid micro-gaps
            const clipADuration = Math.round(splitOffset * 10000) / 10000;
            const clipBDuration = Math.round((clip.duration - splitOffset) * 10000) / 10000;
            const clipBTimelineStart = Math.round(currentTime * 10000) / 10000;
            const clipBSourceStart = Math.round((clip.sourceStart + (splitOffset * clipSpeed)) * 10000) / 10000;

            const clipA: Clip = { ...clip, duration: clipADuration };
            const clipB: Clip = { ...clip, id: Date.now() + Math.random(), mtime: clip.mtime, timelineStart: clipBTimelineStart, sourceStart: clipBSourceStart, duration: clipBDuration };
            const newClips = [...track.clips];
            newClips.splice(idx, 1, clipA, clipB);
            splitDone = true;
            return { ...track, clips: newClips };
        });

        if (splitDone) {
            setTracks(newTracks);
            saveHistory(t('history.split_clip') || 'Klibi Böl', newTracks);
        }
    }, [selectedClipId, currentTime, setTracks, tracks, saveHistory, t]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

            if (e.key === 'Escape') {
                setSelectedClipId(null);
                return;
            }

            switch (e.code) {
                case 'Space': e.preventDefault(); handlePlayPause(); break;
                case 'ArrowUp':
                case 'ArrowDown':
                case 'ArrowLeft':
                case 'ArrowRight':
                    if (selectedClipId !== null && !e.altKey) {
                        e.preventDefault();
                        isMovingWithKeys.current = true;
                        const dx = e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0;
                        const dy = e.code === 'ArrowUp' ? -1 : e.code === 'ArrowDown' ? 1 : 0;
                        const multiplier = e.shiftKey ? 10 : 1;

                        setTracks(prev => prev.map(track => ({
                            ...track,
                            clips: track.clips.map(clip => {
                                if (clip.id === selectedClipId) {
                                    const oldT = clip.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1 };
                                    return {
                                        ...clip,
                                        transform: {
                                            ...oldT,
                                            x: oldT.x + dx * multiplier,
                                            y: oldT.y + dy * multiplier
                                        }
                                    };
                                }
                                return clip;
                            })
                        })));
                    } else {
                        if (e.code === 'ArrowLeft') {
                            e.preventDefault();
                            setCurrentTime(prev => Math.max(0, prev - 5));
                        } else if (e.code === 'ArrowRight') {
                            e.preventDefault();
                            setCurrentTime(prev => Math.min(duration, prev + 5));
                        }
                    }
                    break;
                case 'Delete':
                case 'Backspace':
                    if (selectedClipId !== null) { e.preventDefault(); deleteSelectedClip(); }
                    break;
                case 'KeyB': if (e.ctrlKey && selectedClipId !== null) { e.preventDefault(); splitSelectedClip(); } break;
                case 'KeyZ':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        if (e.shiftKey) redo();
                        else undo();
                    }
                    break;
                case 'KeyY': if (e.ctrlKey) { e.preventDefault(); redo(); } break;
                case 'KeyV': if (!e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); setActiveTool('select'); } break;
                case 'KeyT': if (!e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); setActiveTool('transform'); } break;
                case 'KeyC': if (!e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); setActiveTool('crop'); } break;
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (isMovingWithKeys.current) {
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
                    isMovingWithKeys.current = false;
                    saveHistory(t('history.move_clip') || 'Klip Taşıma', latestTracksRef.current);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [selectedClipId, duration, handlePlayPause, deleteSelectedClip, splitSelectedClip, undo, redo, t, saveHistory]);

    // ─── Save Modal Handlers ───
    const handleSaveClick = useCallback(() => {
        // Set default values (add _edited to prevent accidental source overwrites)
        const defaultName = file?.filename ? `${file.filename.replace(/\.[^/.]+$/, '')}_edited` : 'edited_video';
        setSaveName(defaultName);
        // Default to same directory as source or gallery root
        const defaultDir = file?.path ? file.path.substring(0, file.path.lastIndexOf('\\')) : (galleryRoot || '');
        setSavePath(defaultDir);
        setSaveStatus('idle');
        setSaveMessage('');
        setRenderProgress(0);
        setShowSaveModal(true);
    }, [file, galleryRoot]);

    const handleSelectSaveFolder = useCallback(async () => {
        const selected = await open({
            directory: true,
            multiple: false,
            title: t('editor.select_folder') || 'Select Destination Folder'
        });
        if (selected) {
            setSavePath(selected as string);
        }
    }, [t]);

    const handleSaveFormatChange = useCallback((format: 'mp4' | 'webm' | 'mp3') => {
        setSaveFormat(format);
    }, []);

    const renderTextToImage = useCallback((clip: Clip): Promise<string | null> => {
        return new Promise((resolve) => {
            if (clip.type !== 'text' || !clip.textData) {
                resolve(null);
                return;
            }
            const td = clip.textData;
            const canvas = document.createElement('canvas');
            // Use high resolution for text rendering if possible, or match clip dimensions
            const baseW = clip.width || 1920;
            const baseH = clip.height || 1080;
            canvas.width = baseW;
            canvas.height = baseH;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(null);
                return;
            }

            ctx.clearRect(0, 0, baseW, baseH);
            ctx.font = `${td.fontWeight || 'normal'} ${td.fontSize}px "${td.fontFamily || 'Inter'}", sans-serif`;
            ctx.fillStyle = td.color || '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (td.letterSpacing) {
                (ctx as any).letterSpacing = `${td.letterSpacing}px`;
            }

            const lines = td.text.split('\n');
            const lineHeight = td.fontSize * 1.2;
            const totalHeight = lineHeight * lines.length;
            const startY = (baseH - totalHeight) / 2 + (lineHeight / 2);

            lines.forEach((line, i) => {
                ctx.fillText(line, baseW / 2, startY + i * lineHeight);
            });

            resolve(canvas.toDataURL('image/png'));
        });
    }, []);

    // Helper: replace a path in all history entries (undo stack, redo stack, lastSavedState)
    const replacePathInHistory = useCallback((oldPath: string, newPath: string) => {
        const normOld = oldPath.replace(/\\/g, '/').toLowerCase();

        const replaceInTracks = (hTracks: Track[]): Track[] =>
            hTracks.map(tr => ({
                ...tr,
                clips: tr.clips.map(c => {
                    if (c.path.replace(/\\/g, '/').toLowerCase() === normOld) {
                        return { ...c, path: newPath };
                    }
                    return c;
                })
            }));

        setUndoStack(prev => prev.map(entry => ({
            ...entry,
            tracks: replaceInTracks(entry.tracks)
        })));

        setRedoStack(prev => prev.map(entry => ({
            ...entry,
            tracks: replaceInTracks(entry.tracks)
        })));

        // Update lastSavedState ref
        try {
            const parsed = JSON.parse(lastSavedState.current);
            parsed.tracks = replaceInTracks(parsed.tracks);
            lastSavedState.current = JSON.stringify(parsed);
        } catch { /* ignore */ }
    }, []);

    const performSave = useCallback(async () => {
        if (!saveName.trim() || !savePath) return;

        setComparisonVideoPath(null); // Unmount video before export to prevent locking/cache
        setIsSaving(true);
        setSaveStatus('saving');
        setSaveMessage('');
        setRenderProgress(0);

        try {
            const outputPath = `${savePath}\\${saveName.trim()}.${saveFormat}`;
            const normOutput = outputPath.replace(/\\/g, '/').toLowerCase();

            // Check if we're overwriting a source file used in the timeline
            // If so, back up the original first so history (undo/redo) remains functional
            const affectedClipPaths = new Set<string>();
            for (const tr of tracks) {
                for (const c of tr.clips) {
                    if (c.path.replace(/\\/g, '/').toLowerCase() === normOutput) {
                        affectedClipPaths.add(c.path);
                    }
                }
            }

            const pathReplacements: { oldPath: string; newPath: string }[] = [];

            for (const originalPath of affectedClipPaths) {
                try {
                    const backupPath: string = await invoke('backup_source_file', { sourcePath: originalPath, galleryRoot: galleryRoot || '' });
                    pathReplacements.push({ oldPath: originalPath, newPath: backupPath });
                } catch (backupErr) {
                    setIsSaving(false);
                    setSaveStatus('error');
                    setSaveMessage(`Kaynak dosya yedeklenemedi: ${backupErr}`);
                    return;
                }
            }

            // Redirect all clips to backup paths (current tracks + history)
            if (pathReplacements.length > 0) {
                // Update current tracks
                setTracks(prev => {
                    let next = prev;
                    for (const { oldPath, newPath } of pathReplacements) {
                        const normOld = oldPath.replace(/\\/g, '/').toLowerCase();
                        next = next.map(tr => ({
                            ...tr,
                            clips: tr.clips.map(c => {
                                if (c.path.replace(/\\/g, '/').toLowerCase() === normOld) {
                                    return { ...c, path: newPath };
                                }
                                return c;
                            })
                        }));
                    }
                    return next;
                });

                // Update history stacks
                for (const { oldPath, newPath } of pathReplacements) {
                    replacePathInHistory(oldPath, newPath);
                }

                // Also update loadedFileRef so the editor doesn't re-initialize
                if (loadedFileRef.current) {
                    for (const { oldPath, newPath } of pathReplacements) {
                        if (loadedFileRef.current.replace(/\\/g, '/').toLowerCase() === oldPath.replace(/\\/g, '/').toLowerCase()) {
                            loadedFileRef.current = newPath;
                        }
                    }
                }
            }

            // Use the latest tracks (with backup paths) for export
            const latestTracks = latestTracksRef.current;

            // Process clips and render text to images
            const exportClipsRaw = [];
            for (const t of latestTracks) {
                const trackIdx = latestTracks.indexOf(t);
                for (const c of t.clips) {
                    let base64_image = undefined;
                    if (c.type === 'text') {
                        base64_image = await renderTextToImage(c) || undefined;
                    }
                    exportClipsRaw.push({
                        path: c.path,
                        timeline_start: c.timelineStart,
                        source_start: c.sourceStart,
                        duration: c.duration,
                        width: c.width ?? canvasSize.w,
                        height: c.height ?? canvasSize.h,
                        trackIndex: trackIdx,
                        transformX: c.transform?.x ?? 0,
                        transformY: c.transform?.y ?? 0,
                        scaleX: c.transform?.scaleX ?? 1,
                        scaleY: c.transform?.scaleY ?? 1,
                        cropX: c.crop?.x ?? 0,
                        cropY: c.crop?.y ?? 0,
                        cropW: c.crop?.w ?? 1,
                        cropH: c.crop?.h ?? 1,
                        rotation: c.transform?.rotation ?? 0,
                        flipX: c.transform?.flipX ?? false,
                        flipY: c.transform?.flipY ?? false,
                        settings: c.settings || settings,
                        clip_type: c.type,
                        text_data: c.textData,
                        base64_image,
                        speed: c.speed || 1,
                        volume: c.volume ?? 1,
                        fadeIn: c.fadeIn ?? 0,
                        fadeOut: c.fadeOut ?? 0
                    });
                }
            }

            const result: string = await invoke('render_video_progress', {
                clips: exportClipsRaw,
                settings: {
                    brightness: settings.brightness,
                    contrast: settings.contrast,
                    saturation: settings.saturation,
                    exposure: settings.exposure,
                    temp: settings.temp,
                    tint: settings.tint,
                    vignette: settings.vignette,
                    gamma: settings.gamma,
                    vibrance: settings.vibrance,
                    clarity: settings.clarity,
                    sepia: settings.sepia,
                    hue: settings.hue,
                    blur: settings.blur,
                    dehaze: settings.dehaze,
                    opacity: settings.opacity,
                    shR: settings.shR,
                    shG: settings.shG,
                    shB: settings.shB,
                    midR: settings.midR,
                    midG: settings.midG,
                    midB: settings.midB,
                    hiR: settings.hiR,
                    hiG: settings.hiG,
                    hiB: settings.hiB,
                    canvasWidth: canvasSize.w,
                    canvasHeight: canvasSize.h,
                },
                outputPath: outputPath,
                galleryRoot: galleryRoot
            });

            setIsSaving(false);
            setSaveStatus('success');
            setSaveMessage(result);
            setExportTime(Date.now());
            setComparisonVideoPath(outputPath);

            if (onSaveSuccess) {
                onSaveSuccess({
                    path: outputPath,
                    filename: `${saveName.trim()}.${saveFormat}`,
                    file_type: saveFormat === 'mp3' ? 'audio' : 'video',
                    size: 0,
                    mtime: Date.now()
                });
            }
        } catch (err) {
            setIsSaving(false);
            setSaveStatus('error');
            setSaveMessage(String(err));
        }
    }, [tracks, settings, saveName, savePath, saveFormat, canvasSize, replacePathInHistory]);


    // Keep handleExport for backwards compatibility but use save modal
    const handleExport = useCallback(async () => {
        handleSaveClick();
    }, [handleSaveClick]);

    const handleResize = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startH = timelineHeight;
        const startY = e.clientY;

        const onMove = (ev: MouseEvent) => {
            // Mouse yukarı çekildikçe (startY - ev.clientY pozitif) timeline büyümeli
            const delta = startY - ev.clientY;
            const nextH = Math.max(150, Math.min(window.innerHeight - 300, startH + delta));
            setTimelineHeight(nextH);
        };

        const onUp = (ev: MouseEvent) => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const delta = startY - ev.clientY;
            const finalH = Math.max(150, Math.min(window.innerHeight - 300, startH + delta));
            localStorage.setItem('ve_timeline_height', finalH.toString());
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [timelineHeight]);

    const formatTime = useCallback((seconds: number) => {
        const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60); const f = Math.floor((seconds % 1) * 100);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${f.toString().padStart(2, '0')}`;
    }, []);

    return (
        <div className="video-editor">
            <header className="ve-header">
                <div className="ve-header-left">
                    <div className="ve-editor-logo">
                        <Scissors size={20} />
                    </div>
                    <div className="ve-file-info">
                        <span className="ve-file-name">{file?.filename || t('video.editor_title')}</span>
                        {duration > 0 && <span className="ve-file-meta">{file?.file_type} • {formatTime(duration)}</span>}
                    </div>
                </div>

                <div className="ve-header-center">
                    <div className="ve-header-toolbar">
                        <Tooltip text={t('tooltip.select')}>
                            <button className={`ve-tool-btn ${activeTool === 'select' ? 'active' : ''}`} onClick={() => setActiveTool('select')}><MousePointer2 size={16} /></button>
                        </Tooltip>
                        <Tooltip text={t('tooltip.transform')}>
                            <button className={`ve-tool-btn ${activeTool === 'transform' ? 'active' : ''}`} onClick={() => setActiveTool('transform')}><Maximize2 size={16} /></button>
                        </Tooltip>
                        <Tooltip text={t('tooltip.crop')}>
                            <button className={`ve-tool-btn ${activeTool === 'crop' ? 'active' : ''}`} onClick={() => setActiveTool('crop')}><Crop size={16} /></button>
                        </Tooltip>
                        <div className="ve-tool-divider" />
                        <Tooltip text={t('tooltip.undo')}>
                            <button className="ve-tool-btn" onClick={undo} disabled={!canUndo}><Undo2 size={16} /></button>
                        </Tooltip>
                        <Tooltip text={t('tooltip.redo')}>
                            <button className="ve-tool-btn" onClick={redo} disabled={!canRedo}><Redo2 size={16} /></button>
                        </Tooltip>
                    </div>
                </div>

                <div className="ve-header-right">
                    <Tooltip text={t('player.shortcuts')}>
                        <button className="ve-info-btn" onClick={() => setShowInfoModal(true)}><Info size={16} /></button>
                    </Tooltip>
                    <button className="ve-export-btn" onClick={handleExport}><Save size={14} />{t('editor.save')}</button>
                    <div className="ve-header-divider" />
                    <Tooltip text={t('common.close')}>
                        <button onClick={onClose} className="ve-close-btn"><X size={20} /></button>
                    </Tooltip>
                </div>
            </header>

            <div className="ve-workspace" style={{ flex: 1, height: 'auto' }}>
                <Preview
                    activeClips={activeClips}
                    settings={settings}
                    isPlaying={isPlaying}
                    setIsPlaying={setIsPlaying}
                    currentTime={currentTime}
                    setCurrentTime={setCurrentTime}
                    duration={duration}
                    canvasSize={canvasSize}
                    setCanvasSize={setCanvasSize}
                    isLocked={isLocked}
                    volume={volume}
                    setVolume={setVolume}
                    isMuted={isMuted}
                    setIsMuted={setIsMuted}
                    selectedClipId={selectedClipId}
                    setSelectedClipId={setSelectedClipId}
                    tracks={tracks}
                    setTracks={setTracks}
                    activeTool={activeTool}
                    setActiveTool={setActiveTool}
                    onTransformCommit={saveHistory}
                    localCrop={localCrop}
                    setLocalCrop={setLocalCrop}
                />

                {selectedClip && (
                    <DraggableDock
                        id="adjustments"
                        title={selectedClip ? t('editor.clip_properties') || 'Clip' : t('video.adjustments')}
                        initialPos={{ x: window.innerWidth - 300, y: 80 }}
                        panelWidth={260}
                    >
                        <Properties
                            settings={settings}
                            setSettings={setSettings}
                            selectedClip={selectedClip}
                            tracks={tracks}
                            setTracks={setTracks}
                            onCommit={saveHistory}
                        />
                    </DraggableDock>
                )}

                {selectedClip?.type === 'text' && (
                    <DraggableDock
                        id="text-properties"
                        title={t('editor.text_properties') || 'Text Ayarları'}
                        initialPos={{ x: window.innerWidth - 300, y: 400 }}
                        panelWidth={260}
                    >
                        <TextPropertiesPanel
                            selectedClip={selectedClip}
                            tracks={tracks}
                            setTracks={setTracks}
                            onCommit={saveHistory}
                        />
                    </DraggableDock>
                )}

                {selectedClip && (
                    <DraggableDock
                        id="audio-settings"
                        title={t('video.clip_audio_settings') || 'Clip Audio Settings'}
                        initialPos={{ x: window.innerWidth - 600, y: 400 }}
                        panelWidth={260}
                    >
                        <AudioSettingsPanel
                            selectedClip={selectedClip}
                            tracks={tracks}
                            setTracks={setTracks}
                            onCommit={saveHistory}
                        />
                    </DraggableDock>
                )}

                {selectedClip && (
                    <DraggableDock
                        id="color-balance"
                        title={t('editor.color_balance')}
                        initialPos={{ x: window.innerWidth - 600, y: 80 }}
                        panelWidth={260}
                    >
                        <ColorBalancePanel
                            settings={settings}
                            setSettings={setSettings}
                            selectedClip={selectedClip}
                            tracks={tracks}
                            setTracks={setTracks}
                            onCommit={saveHistory}
                        />
                    </DraggableDock>
                )}

                {(activeTool === 'transform' || activeTool === 'crop') && (
                    <DraggableDock
                        id="transform"
                        title={activeTool === 'crop' ? t('editor.crop') : (selectedClip ? t('editor.clip_transform') : t('editor.transform'))}
                        initialPos={{ x: window.innerWidth - 300, y: 400 }}
                        panelWidth={260}
                    >
                        <TransformPanel
                            selectedClip={selectedClip}
                            canvasSize={canvasSize}
                            setCanvasSize={setCanvasSize}
                            isLocked={isLocked}
                            setIsLocked={setIsLocked}
                            activeTool={activeTool}
                            onCommit={saveHistory}
                            currentDims={currentDims}
                            updateClipTransform={updateClipTransform}
                            updateClipCrop={updateClipCrop}
                            localCrop={localCrop}
                            setLocalCrop={setLocalCrop}
                        />
                    </DraggableDock>
                )}

                <DraggableHistory undoStack={undoStack} redoStack={redoStack} lastSavedState={lastSavedState} revertToState={revertToState} />
            </div>

            <div className="ve-playback-bar">
                <div className="ve-playback-left"><span className="ve-time-display"><span className="ve-time-current">{formatTime(currentTime)}</span><span className="ve-time-separator">/</span><span className="ve-time-total">{formatTime(duration)}</span></span></div>
                <div className="ve-playback-center">
                    <Tooltip text={t('tooltip.previous_frame')}>
                        <button className="ve-pb-btn" onClick={() => setCurrentTime(Math.max(0, currentTime - 0.033))}><ChevronLeft size={16} /></button>
                    </Tooltip>
                    <Tooltip text={t('tooltip.skip_back')}>
                        <button className="ve-pb-btn" onClick={() => setCurrentTime(Math.max(0, currentTime - 5))}><SkipBack size={16} /></button>
                    </Tooltip>
                    <button className="ve-play-btn" onClick={handlePlayPause}>{isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ve-play-icon-offset" />}</button>
                    <Tooltip text={t('tooltip.skip_forward')}>
                        <button className="ve-pb-btn" onClick={() => setCurrentTime(Math.min(duration, currentTime + 5))}><SkipForward size={16} /></button>
                    </Tooltip>
                    <Tooltip text={t('tooltip.next_frame')}>
                        <button className="ve-pb-btn" onClick={() => setCurrentTime(Math.min(duration, currentTime + 0.033))}><ChevronRight size={16} /></button>
                    </Tooltip>
                </div>
                <div className="ve-playback-right">
                    <div className="ve-volume-group">
                        <Tooltip text={isMuted ? t('tooltip.unmute') : t('tooltip.mute')}>
                            <button className="ve-pb-btn" onClick={() => setIsMuted(!isMuted)}>{isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
                        </Tooltip>
                        <input
                            id="ve-volume-slider"
                            name="volume"
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={isMuted ? 0 : volume}
                            onChange={e => { setVolume(parseFloat(e.target.value)); setIsMuted(false); }}
                            className="ve-volume-slider"
                            autoComplete="off"
                        />
                        <span className="ve-volume-label">{Math.round((isMuted ? 0 : volume) * 100)}%</span>
                    </div>
                </div>
            </div>

            <div className="ve-resize-handle" onMouseDown={handleResize}><div className="ve-resize-grip" /></div>
            <div style={{ height: timelineHeight, flex: 'none', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <Timeline tracks={tracks} setTracks={setTracks} zoom={zoom} setZoom={setZoom} currentTime={currentTime} duration={duration} selectedClipId={selectedClipId} setSelectedClipId={setSelectedClipId} splitSelectedClip={splitSelectedClip} deleteSelectedClip={deleteSelectedClip} setCurrentTime={setCurrentTime} galleryRoot={galleryRoot} undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} onCommit={saveHistory} />
            </div>

            {/* Save Modal */}
            {showSaveModal && (
                <div className="ve-save-modal-overlay">
                    <div className="ve-save-modal-content">
                        <div className="ve-save-modal-header">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#3b82f6' }}>
                                    <Save size={20} />
                                    <h3 className="ve-save-modal-title">{t('editor.save_video')}</h3>
                                </div>
                                {!isSaving && (
                                    <button onClick={() => setShowSaveModal(false)} className="ve-close-btn" style={{ marginRight: -10 }}>
                                        <X size={18} />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="modal-body">
                            <div className="prop-section">
                                <label htmlFor="save-filename-input" className="prop-label">{t('editor.filename')}</label>
                                <input
                                    id="save-filename-input"
                                    name="saveFilename"
                                    autoComplete="off"
                                    autoFocus
                                    type="text"
                                    value={saveName}
                                    onChange={(e) => setSaveName(e.target.value)}
                                    onFocus={(e) => e.target.select()}
                                    className="prop-input"
                                />
                            </div>

                            <div className="prop-section">
                                <label htmlFor="save-path-input" className="prop-label">{t('editor.destination_folder')}</label>
                                <div className="path-selector-wrapper">
                                    <Tooltip text={savePath}>
                                        <input
                                            id="save-path-input"
                                            name="savePath"
                                            type="text"
                                            readOnly
                                            value={savePath}
                                            className="prop-input path-display-input"
                                            autoComplete="off"
                                        />
                                    </Tooltip>
                                    <Tooltip text={t('tooltip.change_folder')}>
                                        <button
                                            onClick={handleSelectSaveFolder}
                                            className="path-browse-btn"
                                        >
                                            <Folder size={20} />
                                        </button>
                                    </Tooltip>
                                </div>
                            </div>

                            <div className="prop-section">
                                <span className="prop-label">{t('editor.output_format')}</span>
                                <div className="format-selector">
                                    {['mp4', 'webm', 'mp3'].map(ext => (
                                        <button
                                            key={ext}
                                            onClick={() => handleSaveFormatChange(ext as any)}
                                            className={`format-btn ${ext} ${saveFormat === ext ? 'active' : ''}`}
                                        >
                                            {ext}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Progress Bar & Status Messages */}
                            {(isSaving || saveStatus !== 'idle') && (
                                <div className="prop-section" style={{ marginTop: 16 }}>
                                    <label className="prop-label">
                                        {isSaving ? (t('editor.rendering') || 'Rendering...') :
                                            saveStatus === 'success' ? (t('common.success') || 'Success') :
                                                (t('common.error') || 'Error')}
                                    </label>
                                    <div className="render-progress-container">
                                        <div
                                            className="render-progress-bar"
                                            style={{
                                                width: `${renderProgress}%`,
                                                backgroundColor: saveStatus === 'success' ? '#22c55e' : saveStatus === 'error' ? '#ef4444' : '#3b82f6'
                                            }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                                        <span className="render-progress-text">{renderProgress}%</span>
                                    </div>

                                    {saveMessage && (
                                        <p style={{
                                            fontSize: '0.8rem',
                                            marginTop: 10,
                                            color: saveStatus === 'success' ? '#22c55e' : '#ef4444',
                                            wordBreak: 'break-all',
                                            lineHeight: '1.4'
                                        }}>
                                            {saveMessage}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="ve-save-modal-footer">
                            <button
                                onClick={() => setShowSaveModal(false)}
                                className="cancel-btn"
                                disabled={isSaving}
                            >
                                {saveStatus === 'success' ? (t('common.close') || 'Close') : (t('common.cancel') || 'Cancel')}
                            </button>
                            {saveStatus !== 'success' && (
                                <button
                                    onClick={performSave}
                                    disabled={isSaving || !saveName.trim() || !savePath}
                                    className="confirm-action-btn"
                                >
                                    {isSaving ? (
                                        <>
                                            <div className="saving-spinner" />
                                            {t('editor.saving')}
                                        </>
                                    ) : (
                                        <>
                                            <Save size={16} />
                                            <span>{saveStatus === 'error' ? (t('common.retry') || 'Retry') : (t('editor.save') || 'Save')}</span>
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Comparison Player Panel */}
            {comparisonVideoPath && (
                <DraggableDock
                    id="comparison"
                    title={t('video.comparison_player') || 'Comparison Player'}
                    initialPos={{ x: window.innerWidth - 450, y: 100 }}
                    panelWidth={400}
                    onClose={() => setComparisonVideoPath(null)}
                    resizable
                    aspectRatio={canvasSize.w / canvasSize.h}
                >
                    <div style={{ background: '#000', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
                        <video
                            key={exportTime}
                            src={`${convertFileSrc(comparisonVideoPath)}?t=${exportTime}`}
                            controls
                            muted
                            loop
                            style={{ width: '100%', display: 'block' }}
                        />
                    </div>
                </DraggableDock>
            )}

            {/* Info Modal */}
            {showInfoModal && (
                <div className="ve-save-modal-overlay">
                    <div className="ve-info-modal-content">
                        <div className="ve-save-modal-header">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#a855f7' }}>
                                    <Info size={20} />
                                    <h3 className="ve-save-modal-title">{t('editor.shortcuts_title')}</h3>
                                </div>
                                <button onClick={() => setShowInfoModal(false)} className="ve-close-btn" style={{ marginRight: -10 }}>
                                    <X size={18} />
                                </button>
                            </div>
                        </div>
                        <div className="ve-info-modal-body">
                            <div className="ve-info-section">
                                <h4 className="ve-info-section-title">{t('section.general')}</h4>
                                <div className="ve-shortcut-grid">
                                    <div className="ve-shortcut-item"><span className="ve-key">Space</span><span className="ve-desc">{t('shortcut.play_pause')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">Ctrl + Z</span><span className="ve-desc">{t('shortcut.undo')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">Ctrl + Shift + Z</span><span className="ve-desc">{t('shortcut.redo')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">Del / Backspace</span><span className="ve-desc">{t('shortcut.delete')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">Ctrl + B</span><span className="ve-desc">{t('shortcut.split')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">V / T / C</span><span className="ve-desc">{t('shortcut.tool_v')} / {t('shortcut.tool_t')} / {t('shortcut.tool_c')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">, / .</span><span className="ve-desc">{t('shortcut.prev_frame')} / {t('shortcut.next_frame')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">← / →</span><span className="ve-desc">{t('shortcut.skip_back')} / {t('shortcut.skip_forward')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">Esc</span><span className="ve-desc">{t('shortcut.deselect')}</span></div>
                                </div>
                            </div>

                            <div className="ve-info-section">
                                <h4 className="ve-info-section-title">{t('section.preview')}</h4>
                                <div className="ve-shortcut-grid">
                                    <div className="ve-shortcut-item"><span className="ve-key">{t('mouse.wheel')}</span><span className="ve-desc">{t('shortcut.zoom_preview')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">{t('mouse.drag')} (Arkaplan)</span><span className="ve-desc">{t('shortcut.pan')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">Arrow Keys</span><span className="ve-desc">{t('shortcut.move_clip')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">Shift + Arrow Keys</span><span className="ve-desc">{t('shortcut.move_clip_fast')}</span></div>
                                </div>
                            </div>

                            <div className="ve-info-section">
                                <h4 className="ve-info-section-title">{t('section.timeline')}</h4>
                                <div className="ve-shortcut-grid">
                                    <div className="ve-shortcut-item"><span className="ve-key">Ctrl + {t('mouse.wheel')}</span><span className="ve-desc">{t('shortcut.zoom_timeline')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">Ctrl + {t('mouse.drag')}</span><span className="ve-desc">{t('shortcut.duplicate_clip')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">{t('mouse.drag')} (Ruler)</span><span className="ve-desc">{t('shortcut.seek')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">{t('mouse.alt_drag')} (Trim)</span><span className="ve-desc">{t('shortcut.rate_stretch')}</span></div>
                                    <div className="ve-shortcut-item"><span className="ve-key">{t('mouse.double_click')} (Trim)</span><span className="ve-desc">{t('shortcut.reset_duration')}</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VideoEditor;
