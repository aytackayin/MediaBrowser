import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Play, Pause, Volume2, VolumeX, Trash2, Scissors, Copy, Info, Settings, Captions, Camera } from 'lucide-react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

import { motion, AnimatePresence } from 'framer-motion';
import { thumbnailGenerator } from '../utils/ThumbnailGenerator';
import Tooltip from './Tooltip';
import { useLanguage } from './LanguageContext';
import './MediaPlayer.css';

interface MediaFile {
    path: string;
    filename: string;
    file_type: string;
    size: number;
    mtime: number;
    width?: number;
    height?: number;
    duration?: number;
    fps?: number;
    bit_rate?: number;
    bitrate?: number;    // Alternative name
    sample_rate?: number;
    samplerate?: number; // Alternative name
}

interface MediaPlayerProps {
    file: MediaFile;
    galleryRoot: string;
    onClose: () => void;
    onNext: () => void;
    onPrev: () => void;
    hasNext: boolean;
    hasPrev: boolean;
    onDelete?: () => void;
    onEdit?: () => void;
    onInfo?: () => void;
    onCopy?: () => void;
}

const MediaPlayer: React.FC<MediaPlayerProps> = ({
    file,
    galleryRoot,
    onClose,
    onNext,
    onPrev,
    hasNext,
    hasPrev,
    onDelete,
    onEdit,
    onInfo,
    onCopy
}) => {
    // Media Types
    const isImage = file.file_type === 'image';
    const isVideo = file.file_type === 'video';
    const isAudio = file.file_type === 'audio';

    const [streamingPort, setStreamingPort] = useState<number | null>(null);

    useEffect(() => {
        invoke<number>('get_streaming_port').then(setStreamingPort);
    }, []);

    const isUnsupportedVideo = (path: string) => {
        const ext = path.split('.').pop()?.toLowerCase();
        return ['avi', 'wmv', 'flv', 'mpg', 'mpeg', 'm4v', '3gp', 'ts'].includes(ext || '');
    };

    const getMediaUrl = (path: string, mtime?: number) => {
        const query = mtime ? `?t=${mtime}` : '';
        if (isVideo && isUnsupportedVideo(path) && streamingPort) {
            return `http://localhost:${streamingPort}/stream?path=${encodeURIComponent(path)}${query.replace('?', '&')}`;
        }
        // Tauri v2 on Windows works better with forward slashes for URLs
        const normalized = path.replace(/\\/g, '/');
        const assetUrl = convertFileSrc(normalized);
        return assetUrl + query;
    };

    const { t } = useLanguage();

    // State
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem('player_volume');
        return saved !== null ? parseFloat(saved) : 1;
    });
    const [playbackRate, setPlaybackRate] = useState(1);
    const [isMuted, setIsMuted] = useState(() => {
        return localStorage.getItem('player_muted') === 'true';
    });
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
    const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
    const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
    const [activeCues, setActiveCues] = useState<{ text: string; id: string }[]>([]);
    const [isBuffering, setIsBuffering] = useState(false);

    // Local settings (Modal) initialized from props/localStorage
    const [autoPlaySettingLocal, setAutoPlaySettingLocal] = useState(localStorage.getItem('player_autoplay') === 'true');
    const [loopEnabledLocal, setLoopEnabledLocal] = useState(localStorage.getItem('player_loop') === 'true');
    const [loopCountLocal, setLoopCountLocal] = useState(parseInt(localStorage.getItem('player_loop_count') || '0'));
    const [autoSlideshowLocal, setAutoSlideshowLocal] = useState(localStorage.getItem('player_auto_slideshow') === 'true');
    const [slideshowDurationLocal, setSlideshowDurationLocal] = useState(parseInt(localStorage.getItem('player_slideshow_duration') || '5'));

    // Subtitle customization
    const [subFontSize, setSubFontSize] = useState(parseInt(localStorage.getItem('player_sub_font_size') || '24'));
    const [subFontColor, setSubFontColor] = useState(localStorage.getItem('player_sub_font_color') || '#ffffff');
    const [subBgColor, setSubBgColor] = useState(localStorage.getItem('player_sub_bg_color') || '#000000');
    const [subBgOpacity, setSubBgOpacity] = useState(parseFloat(localStorage.getItem('player_sub_bg_opacity') || '0.75'));
    const [subBgBlur, setSubBgBlur] = useState(parseInt(localStorage.getItem('player_sub_bg_blur') || '10'));

    // Refs for modal scroll prevention
    const modalLoopInputRef = useRef<HTMLInputElement>(null);
    const modalSlideInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!showSettingsModal) return;

        const handleLoopWheel = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY < 0 ? 1 : -1;
            setLoopCountLocal(prev => {
                const newVal = Math.max(0, Math.min(999, prev + delta));
                localStorage.setItem('player_loop_count', String(newVal));
                loopRemainingRef.current = newVal > 0 ? newVal - 1 : 0;
                return newVal;
            });
        };

        const handleSlideWheel = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY < 0 ? 1 : -1;
            setSlideshowDurationLocal(prev => {
                const newVal = Math.max(1, Math.min(999, prev + delta));
                localStorage.setItem('player_slideshow_duration', String(newVal));
                return newVal;
            });
        };

        // Wait for refs to populate (AnimatePresence)
        const timer = setTimeout(() => {
            const lInput = modalLoopInputRef.current;
            const sInput = modalSlideInputRef.current;

            if (lInput) lInput.addEventListener('wheel', handleLoopWheel, { passive: false });
            if (sInput) sInput.addEventListener('wheel', handleSlideWheel, { passive: false });
        }, 100);

        return () => {
            clearTimeout(timer);
            const lInput = modalLoopInputRef.current;
            const sInput = modalSlideInputRef.current;
            if (lInput) lInput.removeEventListener('wheel', handleLoopWheel);
            if (sInput) sInput.removeEventListener('wheel', handleSlideWheel);
        };
    }, [showSettingsModal, loopEnabledLocal, autoSlideshowLocal]);

    // Preview states
    const [previewTime, setPreviewTime] = useState<number | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewX, setPreviewX] = useState<number>(0);
    const lastThumbnailRequestRef = useRef<number>(0);
    const [modalActiveTab, setModalActiveTab] = useState<'viewer' | 'shortcuts'>('viewer');

    // Runtime metadata detection
    const [runtimeMeta, setRuntimeMeta] = useState({
        width: file.width || 0,
        height: file.height || 0,
        duration: file.duration || 0,
        fps: file.fps || 0,
        bitrate: file.bitrate || file.bit_rate || 0,
        sample_rate: file.sample_rate || file.samplerate || 0
    });

    // UI visibility state
    const [uiVisible, setUiVisible] = useState({
        top: false,
        bottom: false,
        prev: false,
        next: false
    });

    // Zoom State
    const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [hasDragged, setHasDragged] = useState(false);

    const videoRef = useRef<HTMLMediaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // Settings from localStorage
    const autoPlaySetting = localStorage.getItem('player_autoplay') === 'true';
    const loopEnabled = localStorage.getItem('player_loop') === 'true';
    const loopCountSetting = parseInt(localStorage.getItem('player_loop_count') || '0');
    const loopRemainingRef = useRef(loopCountSetting);

    const isZoomed = zoom.s > 1;

    // Mouse proximity logic
    const handleGlobalMouseMove = (e: React.MouseEvent) => {
        const { clientX, clientY } = e;
        const { innerWidth, innerHeight } = window;
        const threshold = 50;
        const bottomThreshold = 80;
        const stayOpenArea = 150;
        const sideThreshold = 60;

        setUiVisible(prev => {
            const nextTop = clientY < threshold || (prev.top && clientY < stayOpenArea);
            const nextBottom = showSpeedMenu || showSubtitleMenu || clientY > innerHeight - bottomThreshold || (prev.bottom && clientY > innerHeight - stayOpenArea);
            const nextPrev = !isZoomed && (clientX < sideThreshold || (prev.prev && clientX < stayOpenArea));
            const nextNext = !isZoomed && (clientX > innerWidth - sideThreshold || (prev.next && clientX > innerWidth - stayOpenArea));

            if (prev.top === nextTop && prev.bottom === nextBottom && prev.prev === nextPrev && prev.next === nextNext) {
                return prev; // Skip re-render if no change
            }
            return { top: nextTop, bottom: nextBottom, prev: nextPrev, next: nextNext };
        });

        if (isPanning) {
            const dx = clientX - dragStart.x;
            const dy = clientY - dragStart.y;
            // Drag threshold
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                setHasDragged(true);
            }
            setZoom(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
            setDragStart({ x: clientX, y: clientY });
        }
    };

    // Zoom handler
    useEffect(() => {
        const contentEl = contentRef.current;
        if (!contentEl) return;

        const handleManualWheel = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const rect = contentEl.getBoundingClientRect();
            const mx = e.clientX - rect.left - rect.width / 2;
            const my = e.clientY - rect.top - rect.height / 2;

            const zoomStep = 1.2;
            const factor = e.deltaY > 0 ? (1 / zoomStep) : zoomStep;

            setZoom(prev => {
                let nextS = prev.s * factor;
                if (nextS <= 1.02) return { s: 1, x: 0, y: 0 };
                if (nextS > 16) nextS = 16;
                const nextX = mx - (mx - prev.x) * (nextS / prev.s);
                const nextY = my - (my - prev.y) * (nextS / prev.s);
                return { s: nextS, x: nextX, y: nextY };
            });
        };

        contentEl.addEventListener('wheel', handleManualWheel, { passive: false });
        return () => contentEl.removeEventListener('wheel', handleManualWheel);
    }, []);

    // Pan Handlers
    const handlePanStart = (e: React.MouseEvent) => {
        if (zoom.s <= 1) return;
        if ((e.target as HTMLElement).closest('button, input, .player-header, .player-footer')) return;
        setIsPanning(true);
        setHasDragged(false);
        setDragStart({ x: e.clientX, y: e.clientY });
    };

    const handlePanEnd = () => {
        setIsPanning(false);
        // Delay reset to allow click events
        setTimeout(() => setHasDragged(false), 100);
    };

    // Double-click to reset zoom
    const handleDoubleClick = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button, input, .player-header, .player-footer')) return;
        setZoom(zoom.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 3, x: 0, y: 0 });
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Check if any input/textarea is focused
            const isInputFocused = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '');
            const isContentEditable = (document.activeElement as HTMLElement)?.isContentEditable;

            if (isInputFocused || isContentEditable) {
                if (e.key === 'Escape') (document.activeElement as HTMLElement)?.blur();
                return;
            }

            if (e.key === 'Escape') zoom.s > 1 ? setZoom({ s: 1, x: 0, y: 0 }) : onClose();

            if (e.key === 'PageUp' && !isZoomed) onPrev();
            if (e.key === 'PageDown' && !isZoomed) onNext();

            if (isVideo || isAudio) {
                const step = e.ctrlKey ? (1 / 30) : 5;
                if (e.key === 'ArrowRight') {
                    if (videoRef.current) videoRef.current.currentTime += step;
                }
                if (e.key === 'ArrowLeft') {
                    if (videoRef.current) videoRef.current.currentTime -= step;
                }
            }

            if (e.key === ' ') { e.preventDefault(); setIsPlaying(prev => !prev); }

            if (e.key === 'Delete') {
                if (onDelete && !showSettingsModal) onDelete();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose, onNext, onPrev, zoom.s, isZoomed, isVideo, isAudio, onDelete, showSettingsModal]);

    const formatTimeWithMs = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);

        const parts = [
            m.toString().padStart(2, '0'),
            s.toString().padStart(2, '0')
        ];
        if (h > 0) parts.unshift(h.toString().padStart(2, '0'));
        return `${parts.join(':')}.${ms.toString().padStart(3, '0')}`;
    };

    // Reset state when file changes
    useEffect(() => {
        setIsPlaying((autoPlaySetting && (isVideo || isAudio)) || (isImage && autoSlideshowLocal));
        setProgress(0);
        setPlaybackRate(1);
        setShowSpeedMenu(false);
        loopRemainingRef.current = loopCountSetting > 0 ? loopCountSetting - 1 : 0;
        setPreviewUrl(null);
        setPreviewTime(null);
        setRuntimeMeta({
            width: file.width || 0,
            height: file.height || 0,
            duration: file.duration || 0,
            fps: file.fps || 0,
            bitrate: file.bitrate || file.bit_rate || 0,
            sample_rate: file.sample_rate || file.samplerate || 0
        });

        // Fetch deep metadata if missing
        const fetchDetails = async () => {
            try {
                const details: MediaFile = await invoke('get_file_details', {
                    path: file.path,
                    galleryRoot
                });
                setRuntimeMeta(prev => ({
                    ...prev,
                    width: details.width || prev.width,
                    height: details.height || prev.height,
                    duration: details.duration || prev.duration,
                    fps: details.fps || prev.fps,
                    bitrate: details.bitrate || details.bit_rate || prev.bitrate,
                    sample_rate: details.sample_rate || details.samplerate || prev.sample_rate
                }));
            } catch (err) {
            }
        };

        fetchDetails();

    }, [file.path, isVideo]);

    const loadSubtitles = async () => {
        try {
            const bytes: number[] | null = await invoke('get_subtitle', { videoPath: file.path });

            if (bytes) {
                const uint8Array = new Uint8Array(bytes);

                let content = '';
                try {
                    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
                    content = utf8Decoder.decode(uint8Array);
                } catch {
                    const trDecoder = new TextDecoder('windows-1254');
                    content = trDecoder.decode(uint8Array);
                }

                const vttContent = srtToVtt(content);
                const blob = new Blob([vttContent], { type: 'text/vtt' });
                const url = URL.createObjectURL(blob);
                setSubtitleUrl(url);
            } else {
                setSubtitleUrl(null);
            }
        } catch (err) {
            setSubtitleUrl(null);
        }
    };

    useEffect(() => {
        const setupGenerator = async () => {
            if (isVideo) {
                await thumbnailGenerator.prepare(file.path);
            }
        };

        if (isVideo) {
            setupGenerator();
            loadSubtitles();
        }

        setZoom({ s: 1, x: 0, y: 0 });
        setUiVisible(prev => ({ ...prev, top: false, bottom: false }));

        return () => {
            thumbnailGenerator.clearCache();
            if (subtitleUrl) URL.revokeObjectURL(subtitleUrl);
        };
    }, [file.path, isVideo]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !isVideo) return;

        const handleCueChange = (e: Event) => {
            const track = e.target as TextTrack;
            if (track.mode === 'hidden' || track.mode === 'showing') {
                const cues = track.activeCues;
                if (cues && cues.length > 0) {
                    // Sort cues chronologically
                    const activeArray = Array.from(cues) as VTTCue[];
                    activeArray.sort((a, b) => b.startTime - a.startTime);

                    const formattedCues = activeArray.map(cue => ({
                        text: cue.text,
                        id: `${cue.startTime}-${cue.endTime}-${cue.text.substring(0, 20)}`
                    }));
                    setActiveCues(formattedCues);
                } else {
                    setActiveCues([]);
                }
            }
        };

        const tracks = video.textTracks;
        const setupTracks = () => {
            for (let i = 0; i < tracks.length; i++) {
                tracks[i].mode = subtitlesEnabled ? 'hidden' : 'disabled';
                tracks[i].removeEventListener('cuechange', handleCueChange);
                tracks[i].addEventListener('cuechange', handleCueChange);
            }
        };

        setupTracks();
        tracks.addEventListener('addtrack', setupTracks);

        return () => {
            for (let i = 0; i < tracks.length; i++) {
                tracks[i].removeEventListener('cuechange', handleCueChange);
            }
            tracks.removeEventListener('addtrack', setupTracks);
        };
    }, [subtitleUrl, isVideo, subtitlesEnabled]);

    const handleProgressMouseMove = async (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isVideo || !videoRef.current) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
        const time = (percent / 100) * (videoRef.current.duration || 0);

        setPreviewTime(time);

        // Keep preview box on screen
        const halfBoxWidth = 85;
        const marginPercent = (halfBoxWidth / rect.width) * 100;
        const boundedPercent = Math.max(marginPercent, Math.min(100 - marginPercent, percent));

        setPreviewX(boundedPercent);

        const url = await thumbnailGenerator.getThumbnail(file.path, time);

        // Throttle for stability
        const now = Date.now();
        if (now - lastThumbnailRequestRef.current > 50 || !previewUrl) {
            setPreviewUrl(url);
            lastThumbnailRequestRef.current = now;
        }
    };

    const handleProgressMouseLeave = () => {
        setPreviewTime(null);
        setPreviewUrl(null);
    };

    // Sync playbackRate
    useEffect(() => {
        if (videoRef.current && (isVideo || isAudio)) {
            videoRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate, isVideo, isAudio]);

    useEffect(() => {
        if (isVideo || isAudio) {
            isPlaying ? videoRef.current?.play().catch(() => { }) : videoRef.current?.pause();
        }
    }, [isPlaying, isVideo, isAudio]);

    // Volume & Mute Persistence
    useEffect(() => {
        localStorage.setItem('player_volume', String(volume));
        if (videoRef.current) videoRef.current.volume = isMuted ? 0 : volume;
    }, [volume, isMuted]);

    useEffect(() => {
        localStorage.setItem('player_muted', String(isMuted));
    }, [isMuted]);


    const handleTimeUpdate = () => {
        if (videoRef.current) setProgress((videoRef.current.currentTime / videoRef.current.duration) * 100);
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = (parseFloat(e.target.value) / 100) * (videoRef.current?.duration || 0);
        if (videoRef.current) videoRef.current.currentTime = time;
        setProgress(parseFloat(e.target.value));
    };

    const handleMediaMetadata = (e: React.SyntheticEvent<HTMLMediaElement>) => {
        const media = e.currentTarget;

        // Sync player settings to the new media element
        media.volume = isMuted ? 0 : volume;
        media.playbackRate = playbackRate;

        setRuntimeMeta(prev => ({
            ...prev,
            width: (media as HTMLVideoElement).videoWidth || 0,
            height: (media as HTMLVideoElement).videoHeight || 0,
            duration: media.duration
        }));
        // Auto-play
        if (autoPlaySetting) {
            setIsPlaying(true);
            media.play().catch(() => { });
        }
    };

    // Handle end of media (loop/slideshow)
    const handleMediaEnded = () => {
        if (loopEnabled) {
            if (loopCountSetting === 0) {
                if (videoRef.current) {
                    videoRef.current.currentTime = 0;
                    videoRef.current.play().catch(() => { });
                }
                return;
            }
            if (loopRemainingRef.current > 0) {
                loopRemainingRef.current--;
                if (videoRef.current) {
                    videoRef.current.currentTime = 0;
                    videoRef.current.play().catch(() => { });
                }
                return;
            }
        }

        // Loop finished or disabled - check slideshow
        if (autoSlideshowLocal && hasNext && isPlaying) {
            onNext();
            return;
        }
        setIsPlaying(false);
    };

    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        setRuntimeMeta(prev => ({
            ...prev,
            width: img.naturalWidth,
            height: img.naturalHeight
        }));
    };

    const handleAddSubtitle = async () => {
        try {
            const selected = await open({
                filters: [{ name: 'Subtitle', extensions: ['srt'] }],
                multiple: false
            });

            if (selected) {
                const srtSourcePath = typeof selected === 'string' ? selected : selected[0];
                await invoke('add_subtitle_file', { videoPath: file.path, srtSourcePath });
                loadSubtitles();
                setShowSubtitleMenu(false);
            }
        } catch (err) {
        }
    };

    // Auto slideshow for images
    useEffect(() => {
        if (!isImage || !autoSlideshowLocal || !hasNext || !isPlaying) return;
        const timer = setTimeout(() => onNext(), slideshowDurationLocal * 1000);
        return () => clearTimeout(timer);
    }, [file.path, isImage, autoSlideshowLocal, hasNext, slideshowDurationLocal, isPlaying]);

    const handleScreenshot = async () => {
        if (!containerRef.current || (!isVideo && !isImage)) return;

        const media = isVideo ? videoRef.current : (containerRef.current.querySelector('.player-image') as HTMLImageElement);
        if (!media) return;

        const contentRect = contentRef.current?.getBoundingClientRect();
        if (!contentRect) return;

        const canvas = document.createElement('canvas');
        canvas.width = contentRect.width;
        canvas.height = contentRect.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Background
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        // Apply zoom/pan transform
        ctx.translate(canvas.width / 2 + zoom.x, canvas.height / 2 + zoom.y);
        ctx.scale(zoom.s, zoom.s);

        // Get source dimensions
        const sourceWidth = isVideo ? (media as HTMLVideoElement).videoWidth : (media as HTMLImageElement).naturalWidth;
        const sourceHeight = isVideo ? (media as HTMLVideoElement).videoHeight : (media as HTMLImageElement).naturalHeight;

        // Aspect ratio logic
        const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
        const dw = sourceWidth * scale;
        const dh = sourceHeight * scale;

        ctx.drawImage(media as unknown as CanvasImageSource, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();

        const dataUrl = canvas.toDataURL('image/png');

        try {
            const fileName = file.filename.replace(/\.[^/.]+$/, "");
            const defaultPath = `${fileName}_screenshot_${Date.now()}.png`;

            const savePath = await save({
                defaultPath,
                filters: [{ name: 'Images', extensions: ['png', 'jpg'] }]
            });

            if (savePath) {
                await invoke('save_image', {
                    path: savePath,
                    dataUrl,
                    galleryRoot: galleryRoot
                });
            }
        } catch (error) {
        }
    };

    return (
        <motion.div
            ref={containerRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`media-player-overlay ${isZoomed ? 'zoomed' : ''}`}
            onMouseMove={handleGlobalMouseMove}
            onMouseUp={handlePanEnd}
            onClick={(e) => {
                if (e.target === e.currentTarget && !isZoomed) onClose();
                if (showSpeedMenu) setShowSpeedMenu(false);
            }}
        >
            {/* Header / Info */}
            <AnimatePresence>
                {uiVisible.top && (
                    <motion.div
                        initial={{ y: -100, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -100, opacity: 0 }}
                        transition={{ type: 'tween', ease: 'easeOut', duration: 0.25 }}
                        className="player-header"
                    >
                        <div className="player-info">
                            <h2 className="player-filename">{file.filename}</h2>
                            <span className="player-meta">
                                {runtimeMeta.width && runtimeMeta.height ? `${runtimeMeta.width}x${runtimeMeta.height}` : ''}
                                {isVideo && runtimeMeta.fps ? ` • ${Math.round(runtimeMeta.fps)} FPS` : ''}
                                {runtimeMeta.bitrate ? ` • ${Math.round(runtimeMeta.bitrate / 1000)} kbps` : ''}
                                {runtimeMeta.sample_rate ? ` • ${(runtimeMeta.sample_rate / 1000).toFixed(1)} kHz` : ''}
                                {` • ${(file.size / (1024 * 1024)).toFixed(2)} MB`}
                            </span>
                        </div>
                        <div className="player-header-actions">
                            {onInfo && (
                                <Tooltip text={t('card.info')}>
                                    <button className="player-action-btn info-btn" onClick={(e) => { e.stopPropagation(); onInfo(); }}>
                                        <Info size={20} />
                                    </button>
                                </Tooltip>
                            )}
                            {onEdit && (
                                <Tooltip text={t('card.edit')}>
                                    <button className="player-action-btn edit-btn" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                                        <Scissors size={20} />
                                    </button>
                                </Tooltip>
                            )}
                            {onCopy && (
                                <Tooltip text={t('card.copy_move')}>
                                    <button className="player-action-btn copy-btn" onClick={(e) => { e.stopPropagation(); onCopy(); }}>
                                        <Copy size={20} />
                                    </button>
                                </Tooltip>
                            )}
                            {onDelete && (
                                <Tooltip text={t('card.delete')}>
                                    <button className="player-action-btn delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
                                        <Trash2 size={20} />
                                    </button>
                                </Tooltip>
                            )}
                            <Tooltip text={t('player.screenshot') || 'Screenshot'}>
                                <button className="player-action-btn screenshot-btn" onClick={(e) => { e.stopPropagation(); handleScreenshot(); }}>
                                    <Camera size={20} />
                                </button>
                            </Tooltip>
                            <Tooltip text={t('sidebar.settings')}>
                                <button className="player-action-btn settings-btn" onClick={(e) => { e.stopPropagation(); setShowSettingsModal(true); }}>
                                    <Settings size={20} />
                                </button>
                            </Tooltip>
                            {autoSlideshowLocal && (
                                <Tooltip text={isPlaying ? t('player.pause_slideshow') : t('player.play_slideshow')}>
                                    <button className="player-action-btn slideshow-btn" onClick={(e) => { e.stopPropagation(); setIsPlaying(!isPlaying); }}>
                                        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                                    </button>
                                </Tooltip>
                            )}
                            <div className="player-divider" />
                            <button className="player-close-btn" onClick={onClose}>
                                <X size={24} />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Content Area */}
            <div
                ref={contentRef}
                className="player-content"
                onMouseDown={handlePanStart}
                onDoubleClick={handleDoubleClick}
                style={{ cursor: isZoomed ? (isPanning ? 'grabbing' : 'grab') : 'default' }}
            >
                <AnimatePresence mode="wait">
                    <motion.div
                        key={file.path}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="player-transition-wrapper"
                    >
                        <div
                            className="player-media-wrapper"
                            style={{
                                transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.s})`,
                                transformOrigin: 'center center',
                                transition: isPanning ? 'none' : 'transform 0.15s cubic-bezier(0.2, 0, 0.2, 1)',
                                '--sub-font-size': `${subFontSize}px`,
                                '--sub-font-color': subFontColor,
                                '--sub-bg-color': subBgColor,
                                '--sub-bg-opacity': subBgOpacity,
                                '--sub-bg-blur': `${subBgBlur}px`,
                                backfaceVisibility: 'hidden',
                                transformStyle: 'preserve-3d',
                            } as any}
                        >
                            {isImage && (
                                <img
                                    src={getMediaUrl(file.path, file.mtime)}
                                    alt={file.filename}
                                    className="player-image"
                                    onLoad={handleImageLoad}
                                    draggable={false}
                                />
                            )}
                            {isVideo && (
                                <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <video
                                        ref={videoRef as React.RefObject<HTMLVideoElement>}
                                        src={getMediaUrl(file.path, file.mtime)}
                                        className="player-video"
                                        onLoadedMetadata={handleMediaMetadata}
                                        onTimeUpdate={handleTimeUpdate}
                                        onEnded={handleMediaEnded}
                                        onWaiting={() => setIsBuffering(true)}
                                        onPlaying={() => setIsBuffering(false)}
                                        onCanPlay={() => setIsBuffering(false)}
                                        onLoadStart={() => setIsBuffering(true)}
                                        onClick={() => {
                                            // Prevent toggle while dragging
                                            if (!hasDragged) {
                                                setIsPlaying(!isPlaying);
                                            }
                                        }}
                                        draggable={false}
                                        crossOrigin="anonymous"
                                    >
                                        {subtitleUrl && (
                                            <track
                                                key={subtitleUrl}
                                                kind="subtitles"
                                                src={subtitleUrl}
                                                srcLang="tr"
                                                label="Türkçe"
                                                default
                                            />
                                        )}
                                    </video>

                                    <AnimatePresence>
                                        {isBuffering && (
                                            <motion.div
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                                style={{
                                                    position: 'absolute',
                                                    top: '50%',
                                                    left: '50%',
                                                    transform: 'translate(-50%, -50%)',
                                                    zIndex: 10,
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    gap: '12px'
                                                }}
                                            >
                                                <motion.div
                                                    animate={{ rotate: 360 }}
                                                    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                                                    style={{
                                                        width: '48px',
                                                        height: '48px',
                                                        border: '4px solid rgba(168, 85, 247, 0.2)',
                                                        borderTop: '4px solid #a855f7',
                                                        borderRadius: '50%',
                                                        filter: 'drop-shadow(0 0 8px rgba(168, 85, 247, 0.4))'
                                                    }}
                                                />
                                                <span style={{
                                                    color: '#ffffff',
                                                    fontSize: '14px',
                                                    fontWeight: 500,
                                                    textShadow: '0 2px 4px rgba(0,0,0,0.5)',
                                                    letterSpacing: '0.05em'
                                                }}>
                                                    {t('player.streaming') || 'Streaming...'}
                                                </span>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            )}

                            {/* Custom Subtitle Overlay */}
                            <AnimatePresence>
                                {subtitlesEnabled && activeCues.length > 0 && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0 }}
                                        className="player-subtitle-overlay"
                                    >
                                        {activeCues.map((cue) => (
                                            <motion.div
                                                key={cue.id}
                                                layout
                                                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.9 }}
                                                className="player-subtitle-cue"
                                            >
                                                {cue.text.split('\n').map((line, lidx) => (
                                                    <div
                                                        key={lidx}
                                                        dangerouslySetInnerHTML={{ __html: line }}
                                                    />
                                                ))}
                                            </motion.div>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {isAudio && (
                                <div className="player-audio-view">
                                    <div className="audio-visualizer">
                                        <div className="audio-icon-pulse">
                                            <Volume2 size={80} />
                                        </div>
                                    </div>
                                    <audio
                                        ref={videoRef as React.RefObject<HTMLAudioElement>}
                                        src={getMediaUrl(file.path)}
                                        onLoadedMetadata={handleMediaMetadata}
                                        onTimeUpdate={handleTimeUpdate}
                                        onEnded={handleMediaEnded}
                                    />
                                </div>
                            )}
                        </div>
                    </motion.div>
                </AnimatePresence>


                {/* Navigation Buttons */}
                <AnimatePresence>
                    {uiVisible.prev && hasPrev && (
                        <motion.button
                            initial={{ x: -25, y: '-50%', opacity: 0 }}
                            animate={{ x: 0, y: '-50%', opacity: 1 }}
                            exit={{ x: -25, y: '-50%', opacity: 0 }}
                            transition={{ type: 'tween', ease: 'easeOut', duration: 0.2 }}
                            className="nav-btn prev"
                            onClick={(e) => { e.stopPropagation(); onPrev(); }}
                        >
                            <ChevronLeft size={48} />
                        </motion.button>
                    )}
                    {uiVisible.next && hasNext && (
                        <motion.button
                            initial={{ x: 25, y: '-50%', opacity: 0 }}
                            animate={{ x: 0, y: '-50%', opacity: 1 }}
                            exit={{ x: 25, y: '-50%', opacity: 0 }}
                            transition={{ type: 'tween', ease: 'easeOut', duration: 0.2 }}
                            className="nav-btn next"
                            onClick={(e) => { e.stopPropagation(); onNext(); }}
                        >
                            <ChevronRight size={48} />
                        </motion.button>
                    )}
                </AnimatePresence>
            </div>

            {/* Footer / Controls */}
            <AnimatePresence>
                {uiVisible.bottom && (isVideo || isAudio) && (
                    <motion.div
                        initial={{ y: 100, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 100, opacity: 0 }}
                        transition={{ type: 'tween', ease: 'easeOut', duration: 0.25 }}
                        className="player-footer"
                    >
                        <div className="player-progress-container">
                            {/* Seek Preview Thumbnail */}
                            <AnimatePresence>
                                {previewTime !== null && isVideo && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10, scale: 0.8, x: '-50%' }}
                                        animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
                                        exit={{ opacity: 0, y: 10, scale: 0.8, x: '-50%' }}
                                        className="player-seek-preview"
                                        style={{ left: `${previewX}%` }}
                                    >
                                        <div className="preview-thumb-container">
                                            {previewUrl ? (
                                                <img src={previewUrl} alt="Preview" className="preview-thumb" />
                                            ) : (
                                                <div className="preview-loading" />
                                            )}
                                        </div>
                                        <span className="preview-time">{formatTimeWithMs(previewTime)}</span>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <input
                                id="player-progress-bar"
                                name="progress"
                                type="range"
                                className="player-progress-bar"
                                step="0.0001"
                                value={progress}
                                onChange={handleSeek}
                                onMouseMove={handleProgressMouseMove}
                                onMouseLeave={handleProgressMouseLeave}
                                style={{ '--progress': `${progress}%` } as any}
                                autoComplete="off"
                            />
                        </div>
                        <div className="player-controls">
                            <div className="controls-left">
                                <button className="control-btn" onClick={() => setIsPlaying(!isPlaying)}>
                                    {isPlaying ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" />}
                                </button>
                                <div className="volume-control">
                                    <button className="control-btn" onClick={() => setIsMuted(!isMuted)}>
                                        {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                                    </button>
                                    <input
                                        id="player-volume-slider"
                                        name="volume"
                                        type="range"
                                        className="volume-slider"
                                        min="0" max="1" step="0.01"
                                        value={isMuted ? 0 : volume}
                                        onChange={(e) => {
                                            const v = parseFloat(e.target.value);
                                            setVolume(v);
                                            setIsMuted(v === 0);
                                        }}
                                        autoComplete="off"
                                    />
                                </div>
                                <span className="time-info">
                                    {videoRef.current ? formatTimeWithMs(videoRef.current.currentTime) : '00:00.000'} / {videoRef.current ? formatTimeWithMs(videoRef.current.duration) : '00:00.000'}
                                </span>
                            </div>
                            <div className="controls-right">
                                <div
                                    className="speed-control-wrapper subtitle-control-wrapper"
                                    onMouseEnter={() => setShowSubtitleMenu(true)}
                                    onMouseLeave={() => setShowSubtitleMenu(false)}
                                >
                                    <button
                                        className={`control-btn captions-btn ${subtitlesEnabled && subtitleUrl ? 'active' : ''}`}
                                        onClick={(e) => { e.stopPropagation(); setShowSubtitleMenu(!showSubtitleMenu); }}
                                    >
                                        <Captions size={20} color={subtitlesEnabled && subtitleUrl ? '#a855f7' : '#ffffff'} />
                                    </button>
                                    <AnimatePresence>
                                        {showSubtitleMenu && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: 10, scale: 0.9 }}
                                                className="speed-menu subtitle-menu"
                                            >
                                                <button
                                                    className={`speed-option ${subtitlesEnabled && subtitleUrl ? 'active' : ''}`}
                                                    onClick={() => { setSubtitlesEnabled(!subtitlesEnabled); setShowSubtitleMenu(false); }}
                                                >
                                                    {t('player.toggle_subtitles')}
                                                </button>
                                                <button
                                                    className="speed-option"
                                                    onClick={handleAddSubtitle}
                                                >
                                                    {t('player.add_subtitle')}
                                                </button>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                <div
                                    className="speed-control-wrapper"
                                    onMouseEnter={() => setShowSpeedMenu(true)}
                                    onMouseLeave={() => setShowSpeedMenu(false)}
                                >
                                    <button className="speed-btn" onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(!showSpeedMenu); }}>
                                        {playbackRate}x
                                    </button>
                                    <AnimatePresence>
                                        {showSpeedMenu && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: 10, scale: 0.9 }}
                                                className="speed-menu"
                                            >
                                                {[0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map(rate => (
                                                    <button
                                                        key={rate}
                                                        className={`speed-option ${playbackRate === rate ? 'active' : ''}`}
                                                        onClick={() => { setPlaybackRate(rate); setShowSpeedMenu(false); }}
                                                    >
                                                        {rate}x
                                                    </button>
                                                ))}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Player Settings Modal */}
            <AnimatePresence>
                {showSettingsModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="modal-overlay"
                        onClick={() => setShowSettingsModal(false)}
                        style={{ zIndex: 10000 }} // Ensure on top of player overlay
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 10 }}
                            className="modal-settings-content"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="modal-header">
                                <h3 className="modal-title">{t('settings.player')}</h3>
                                <button onClick={() => setShowSettingsModal(false)} className="modal-close-btn"><X size={20} /></button>
                            </div>

                            <div className="settings-tabs">
                                <button
                                    className={`settings-tab-btn ${modalActiveTab === 'viewer' ? 'active' : ''}`}
                                    onClick={() => setModalActiveTab('viewer')}
                                >
                                    <Play size={16} />
                                    {t('settings.tab_viewer')}
                                </button>
                                <button
                                    className={`settings-tab-btn ${modalActiveTab === 'shortcuts' ? 'active' : ''}`}
                                    onClick={() => setModalActiveTab('shortcuts')}
                                >
                                    <Captions size={16} />
                                    {t('settings.tab_shortcuts')}
                                </button>
                            </div>

                            <div className="modal-body settings-body">
                                {modalActiveTab === 'viewer' && (
                                    <>
                                        {/* Player Settings Section */}
                                        <div className="settings-section">
                                            <h4 className="settings-subheader">{t('sidebar.settings')}</h4>

                                            <div className="setting-item">
                                                <div className="setting-info">
                                                    <label htmlFor="player-autoplay-toggle" className="setting-label">{t('settings.player_autoplay')}</label>
                                                    <span className="setting-desc">{t('settings.player_autoplay_desc')}</span>
                                                </div>
                                                <label htmlFor="player-autoplay-toggle" className="switch">
                                                    <input
                                                        id="player-autoplay-toggle"
                                                        name="autoplay"
                                                        type="checkbox"
                                                        checked={autoPlaySettingLocal}
                                                        onChange={(e) => {
                                                            const val = e.target.checked;
                                                            setAutoPlaySettingLocal(val);
                                                            localStorage.setItem('player_autoplay', String(val));
                                                        }}
                                                    />
                                                    <span className="slider round"></span>
                                                </label>
                                            </div>

                                            <div className="setting-item">
                                                <div className="setting-info">
                                                    <label htmlFor="player-loop-toggle" className="setting-label">{t('settings.player_loop')}</label>
                                                    <span className="setting-desc">{t('settings.player_loop_desc')}</span>
                                                </div>
                                                <div className="setting-control">
                                                    <label htmlFor="player-loop-toggle" className="switch">
                                                        <input
                                                            id="player-loop-toggle"
                                                            name="loopEnabled"
                                                            type="checkbox"
                                                            checked={loopEnabledLocal}
                                                            onChange={(e) => {
                                                                const val = e.target.checked;
                                                                setLoopEnabledLocal(val);
                                                                localStorage.setItem('player_loop', String(val));
                                                            }}
                                                        />
                                                        <span className="slider round"></span>
                                                    </label>
                                                    {loopEnabledLocal && (
                                                        <input
                                                            id="player-loop-count"
                                                            name="loopCount"
                                                            type="number"
                                                            min="0"
                                                            className="small-input"
                                                            value={loopCountLocal}
                                                            onChange={(e) => {
                                                                const val = parseInt(e.target.value) || 0;
                                                                setLoopCountLocal(val);
                                                                localStorage.setItem('player_loop_count', String(val));
                                                                loopRemainingRef.current = val > 0 ? val - 1 : 0;
                                                            }}
                                                            ref={modalLoopInputRef}
                                                            autoComplete="off"
                                                        />
                                                    )}
                                                </div>
                                            </div>

                                            <div className="setting-item">
                                                <div className="setting-info">
                                                    <label htmlFor="player-slideshow-toggle" className="setting-label">{t('settings.slideshow_auto')}</label>
                                                    <span className="setting-desc">{t('settings.slideshow_auto_desc')}</span>
                                                </div>
                                                <label htmlFor="player-slideshow-toggle" className="switch">
                                                    <input
                                                        id="player-slideshow-toggle"
                                                        name="autoSlideshow"
                                                        type="checkbox"
                                                        checked={autoSlideshowLocal}
                                                        onChange={(e) => {
                                                            const val = e.target.checked;
                                                            setAutoSlideshowLocal(val);
                                                            localStorage.setItem('player_auto_slideshow', String(val));
                                                        }}
                                                    />
                                                    <span className="slider round"></span>
                                                </label>
                                            </div>

                                            {autoSlideshowLocal && (
                                                <div className="setting-item">
                                                    <div className="setting-info">
                                                        <label htmlFor="player-slideshow-duration" className="setting-label">{t('settings.slideshow_duration')}</label>
                                                        <span className="setting-desc">{t('settings.slideshow_duration_desc')}</span>
                                                    </div>
                                                    <div className="setting-control">
                                                        <input
                                                            id="player-slideshow-duration"
                                                            name="slideshowDuration"
                                                            type="number"
                                                            min="1"
                                                            className="small-input"
                                                            value={slideshowDurationLocal}
                                                            onChange={(e) => {
                                                                const val = parseInt(e.target.value) || 5;
                                                                setSlideshowDurationLocal(val);
                                                                localStorage.setItem('player_slideshow_duration', String(val));
                                                            }}
                                                            ref={modalSlideInputRef}
                                                            autoComplete="off"
                                                        />
                                                        <span className="unit-label">sn</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Subtitle Settings Section */}
                                        <div className="settings-section">
                                            <h4 className="settings-subheader">{t('settings.subtitles')}</h4>

                                            <div className="setting-item">
                                                <div className="setting-info">
                                                    <label htmlFor="player-sub-font-size" className="setting-label">{t('settings.sub_font_size')}</label>
                                                </div>
                                                <div className="setting-control">
                                                    <input
                                                        id="player-sub-font-size"
                                                        name="subFontSize"
                                                        type="number"
                                                        min="12"
                                                        max="120"
                                                        className="small-input"
                                                        value={subFontSize}
                                                        onChange={(e) => {
                                                            const val = parseInt(e.target.value) || 12;
                                                            setSubFontSize(val);
                                                            localStorage.setItem('player_sub_font_size', String(val));
                                                        }}
                                                    />
                                                    <span className="unit-label">px</span>
                                                </div>
                                            </div>

                                            <div className="setting-item">
                                                <div className="setting-info">
                                                    <label htmlFor="player-sub-font-color" className="setting-label">{t('settings.sub_font_color')}</label>
                                                </div>
                                                <div className="setting-control">
                                                    <input
                                                        id="player-sub-font-color"
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
                                            </div>

                                            <div className="setting-item">
                                                <div className="setting-info">
                                                    <label htmlFor="player-sub-bg-color" className="setting-label">{t('settings.sub_bg_color')}</label>
                                                </div>
                                                <div className="setting-control">
                                                    <input
                                                        id="player-sub-bg-color"
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
                                            </div>

                                            <div className="setting-item">
                                                <div className="setting-info">
                                                    <label htmlFor="player-sub-bg-opacity" className="setting-label">{t('settings.sub_bg_opacity')}</label>
                                                </div>
                                                <div className="setting-control">
                                                    <input
                                                        id="player-sub-bg-opacity"
                                                        name="subBgOpacity"
                                                        type="range"
                                                        min="0"
                                                        max="1"
                                                        step="0.05"
                                                        className="volume-slider" // Reusing volume-slider style for consistency
                                                        value={subBgOpacity}
                                                        onChange={(e) => {
                                                            const val = parseFloat(e.target.value);
                                                            setSubBgOpacity(val);
                                                            localStorage.setItem('player_sub_bg_opacity', String(val));
                                                        }}
                                                        autoComplete="off"
                                                    />
                                                    <span className="unit-label" style={{ minWidth: '40px', textAlign: 'right' }}>
                                                        {Math.round(subBgOpacity * 100)}%
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="setting-item">
                                                <div className="setting-info">
                                                    <label htmlFor="player-sub-bg-blur" className="setting-label">{t('settings.sub_bg_blur')}</label>
                                                </div>
                                                <div className="setting-control">
                                                    <input
                                                        id="player-sub-bg-blur"
                                                        name="subBgBlur"
                                                        type="range"
                                                        min="0"
                                                        max="40"
                                                        step="1"
                                                        className="volume-slider"
                                                        value={subBgBlur}
                                                        onChange={(e) => {
                                                            const val = parseInt(e.target.value);
                                                            setSubBgBlur(val);
                                                            localStorage.setItem('player_sub_bg_blur', String(val));
                                                        }}
                                                        autoComplete="off"
                                                    />
                                                    <span className="unit-label" style={{ minWidth: '40px', textAlign: 'right' }}>
                                                        {subBgBlur}px
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}

                                {modalActiveTab === 'shortcuts' && (
                                    <>
                                        {/* Shortcuts Section */}
                                        <div className="settings-section">
                                            <h4 className="settings-subheader">{t('player.shortcuts')}</h4>
                                            <div className="shortcuts-list">
                                                <div className="shortcut-row">
                                                    <span className="shortcut-action">{t('player.play_pause')}</span>
                                                    <span className="shortcut-key space">{t('player.space')}</span>
                                                </div>
                                                <div className="shortcut-row">
                                                    <span className="shortcut-action">{t('player.seek')}</span>
                                                    <span className="shortcut-key">{t('player.arrows')}</span>
                                                </div>
                                                <div className="shortcut-row">
                                                    <span className="shortcut-action">{t('player.seek_precise')}</span>
                                                    <span className="shortcut-key">{t('player.ctrl_arrows')}</span>
                                                </div>
                                                <div className="shortcut-row">
                                                    <span className="shortcut-action">{t('player.zoom')}</span>
                                                    <span className="shortcut-key">{t('player.wheel')}</span>
                                                </div>
                                                <div className="shortcut-row">
                                                    <span className="shortcut-action">{t('player.pan')}</span>
                                                    <span className="shortcut-key">{t('player.drag')}</span>
                                                </div>
                                                <div className="shortcut-row">
                                                    <span className="shortcut-action">{t('player.nav')}</span>
                                                    <span className="shortcut-key">{t('player.page_keys')}</span>
                                                </div>
                                                <div className="shortcut-row">
                                                    <span className="shortcut-action">{t('player.delete')}</span>
                                                    <span className="shortcut-key danger">{t('player.del_key')}</span>
                                                </div>
                                                <div className="shortcut-row">
                                                    <span className="shortcut-action">{t('player.close')}</span>
                                                    <span className="shortcut-key">{t('player.esc_key')}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default MediaPlayer;

// Helpers
const srtToVtt = (srt: string) => {
    let vtt = "WEBVTT\n\n";
    let content = srt.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const parseMs = (t: string) => {
        const parts = t.replace(',', '.').split(':');
        const s_ms = parts[2].split('.');
        return (parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(s_ms[0])) * 1000 + parseInt(s_ms[1] || '0');
    };

    const formatMs = (ms: number) => {
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        const milli = Math.round(ms % 1000);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${milli.toString().padStart(3, '0')}`;
    };

    const blocks = content.split('\n\n');
    const processed = blocks.map(block => {
        const lines = block.split('\n');
        const timeIndex = lines.findIndex(l => l.includes('-->'));
        if (timeIndex === -1) return block;

        const [start, end] = lines[timeIndex].split(' --> ');
        const text = lines.slice(timeIndex + 1).join(' ').replace(/<[^>]*>/g, '');

        const startMs = parseMs(start.trim());
        const endMs = parseMs(end.trim());

        // Extension based on length (1s base + 50ms per char)
        const minDuration = 1000 + (text.length * 50);
        const newEndMs = Math.max(endMs, startMs + minDuration);

        lines[timeIndex] = `${formatMs(startMs)} --> ${formatMs(newEndMs)}`;
        return lines.join('\n');
    });

    return vtt + processed.join('\n\n');
};
