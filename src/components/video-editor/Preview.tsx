import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useLanguage } from '../LanguageContext';
import { Check, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Clip, VideoSettings, Track, ExportSettings } from './types';

interface PreviewProps {
    activeClips: Clip[];
    settings: VideoSettings;
    isPlaying: boolean;
    setIsPlaying: (v: boolean) => void;
    currentTime: number;
    setCurrentTime: (v: number | ((prev: number) => number)) => void;
    duration: number;
    canvasSize: { w: number, h: number };
    setCanvasSize: (size: { w: number, h: number }) => void;
    isLocked: boolean;
    volume: number;
    setVolume: (v: number) => void;
    isMuted: boolean;
    setIsMuted: (v: boolean | ((prev: boolean) => boolean)) => void;
    selectedClipId: number | null;
    setSelectedClipId: (id: number | null) => void;
    tracks: Track[];
    setTracks: (tracks: Track[] | ((prev: Track[]) => Track[])) => void;
    activeTool: 'select' | 'transform' | 'crop';
    setActiveTool: (tool: 'select' | 'transform' | 'crop') => void;
    onTransformCommit: (label: string) => void;
    localCrop: { x: number, y: number, w: number, h: number } | null;
    setLocalCrop: (crop: { x: number, y: number, w: number, h: number } | null) => void;
}

const Preview: React.FC<PreviewProps> = ({
    activeClips, settings, isPlaying, setIsPlaying,
    currentTime, setCurrentTime, duration, canvasSize, setCanvasSize, isLocked,
    volume, isMuted,
    selectedClipId, setSelectedClipId, tracks, setTracks,
    activeTool, setActiveTool, onTransformCommit, localCrop, setLocalCrop
}) => {
    const { t } = useLanguage();
    const OVERLAP = 0.5; // Match VideoEditor.tsx


    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [view, setView] = useState({ cx: 0, cy: 0, scale: 0.5 });
    const stageRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // FFmpeg Preview State
    const [previewImage, setPreviewImage] = useState<HTMLImageElement | null>(null);
    const [isRendering, setIsRendering] = useState(false);


    const [isPanning, setIsPanning] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const isDraggingRef = useRef(false);
    const [isBuffering, setIsBuffering] = useState(false);
    const [showLoader, setShowLoader] = useState(false);
    const [fontsReady, setFontsReady] = useState(false);
    const isScrubbingRef = useRef(false);
    const scrubTimeoutRef = useRef<any>(null);

    // Media Resource Cleanup on Unmount
    useEffect(() => {
        return () => {
            // Force release video resources from memory
            if (containerRef.current) {
                const videos = containerRef.current.querySelectorAll('video');
                videos.forEach(video => {
                    video.pause();
                    video.src = "";
                    video.load();
                    video.remove();
                });
            }
            // Clear pending states
            setPreviewImage(null);
            setIsRendering(false);
        };
    }, []);

    useEffect(() => {
        document.fonts.ready.then(() => setFontsReady(prev => !prev));
        const handleFontsChange = () => setFontsReady(prev => !prev);
        document.fonts.addEventListener('loadingdone', handleFontsChange);
        return () => document.fonts.removeEventListener('loadingdone', handleFontsChange);
    }, []);

    useEffect(() => {
        let timer: any;
        if (isBuffering) {
            timer = setTimeout(() => setShowLoader(true), 500);
        } else {
            setShowLoader(false);
        }
        return () => clearTimeout(timer);
    }, [isBuffering]);

    const isImageFile = (path: string) => {
        const ext = path.split('.').pop()?.toLowerCase();
        return ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'gif', 'webp', 'bmp'].includes(ext || '');
    };

    const isAudioFile = (path: string) => {
        const ext = path.split('.').pop()?.toLowerCase();
        return ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'aiff', 'alac'].includes(ext || '');
    };

    const getMediaUrl = (path: string, mtime?: number) => {
        const query = mtime ? `?t=${mtime}` : '';
        const normalized = path.replace(/\\/g, '/');
        return convertFileSrc(normalized) + query;
    };

    const actionRef = useRef<{
        type: 'pan' | 'resize' | 'move' | 'resize-clip' | 'crop' | null;
        handle: string | null;
        startX: number;
        startY: number;
        startW: number;
        startH: number;
        startCX: number;
        startCY: number;
        startTX: number;
        startTY: number;
        startScaleX: number;
        startScaleY: number;
        startCrop: { x: number, y: number, w: number, h: number };
    }>({
        type: null, handle: null, startX: 0, startY: 0, startW: 0, startH: 0,
        startCX: 0, startCY: 0, startTX: 0, startTY: 0, startScaleX: 1, startScaleY: 1,
        startCrop: { x: 0, y: 0, w: 1, h: 1 }
    });

    const dragOriginRef = useRef<{ x: number, y: number, scaleX: number, scaleY: number, canvasW: number, canvasH: number }>({
        x: 0, y: 0, scaleX: 1, scaleY: 1, canvasW: 0, canvasH: 0
    });

    // View Center Handling with ResizeObserver
    useEffect(() => {
        if (!stageRef.current) return;

        const updateView = () => {
            const rect = stageRef.current?.getBoundingClientRect();
            if (rect) {
                // Determine if we should maintain relative offset or re-center.
                // For now, re-centering is the most robust simple fix for the reported "broken" layout.
                // ideally we maintain the offset, but let's fix the glitch first.
                setView(prev => ({
                    ...prev,
                    cx: rect.width / 2,
                    cy: rect.height / 2
                    // optional: scale adjustment if needed, but not requested
                    // scale: prev.scale 
                }));
            }
        };

        // Initial set
        updateView();

        const observer = new ResizeObserver(updateView);
        observer.observe(stageRef.current);

        return () => observer.disconnect();
    }, []);



    const selectedClipObj = useMemo(() => {
        if (selectedClipId === null) return null;
        for (const tr of tracks) {
            const found = tr.clips.find(c => c.id === selectedClipId);
            if (found) return found;
        }
        return null;
    }, [tracks, selectedClipId]);

    const lastSeekTimeRef = useRef<Map<number, number>>(new Map());

    // Audio / Sync Logic
    useEffect(() => {
        const videos = containerRef.current?.querySelectorAll('video');
        if (!videos) return;

        videos.forEach(video => {
            const attrId = video.getAttribute('data-clip-id');
            const clip = activeClips.find(c => String(c.id) === attrId) || (selectedClipObj && String(selectedClipObj.id) === attrId ? selectedClipObj : null);
            if (!clip) return;
            const isClippedActive = currentTime >= clip.timelineStart - OVERLAP && currentTime < clip.timelineStart + clip.duration + OVERLAP;
            if (!isClippedActive) {
                video.volume = 0;
                video.pause();
                return;
            }

            const speed = clip.speed || 1;
            // Seek even if not strictly active (during overlap) to be ready
            const clipLocalTime = (currentTime - clip.timelineStart) * speed + clip.sourceStart;
            const targetTime = Math.max(0, Math.min(
                clipLocalTime,
                clip.sourceStart + (clip.duration * speed) - 0.001
            ));

            // Strictly active check for audio and playing state
            const isStrictlyActive = currentTime >= clip.timelineStart - 0.001 && currentTime < clip.timelineStart + clip.duration + 0.001;

            if (!isStrictlyActive) {
                video.volume = 0;
                if (!video.paused) video.pause();
            } else {
                // Calculate per-clip volume with fades
                const clipVolume = clip.volume ?? 1.0;
                const fadeIn = clip.fadeIn ?? 0;
                const fadeOut = clip.fadeOut ?? 0;
                const elapsed = currentTime - clip.timelineStart;
                const remaining = clip.timelineStart + clip.duration - currentTime;

                let fadeMultiplier = 1.0;
                if (fadeIn > 0 && elapsed < fadeIn) {
                    fadeMultiplier = Math.max(0, elapsed / fadeIn);
                } else if (fadeOut > 0 && remaining < fadeOut) {
                    fadeMultiplier = Math.max(0, remaining / fadeOut);
                }

                // Multi-track audio: allow all active clips to be heard if not muted
                video.volume = (isMuted ? 0 : volume) * clipVolume * fadeMultiplier;
                video.muted = isMuted;
                video.playbackRate = speed;

                const diff = Math.abs(video.currentTime - targetTime);

                if (isPlaying) {
                    if (diff > 0.2) {
                        video.currentTime = targetTime;
                    }
                    if (video.paused) video.play().catch(() => { });
                } else {
                    // Audio scrubbing logic: if not playing, but time is updated, play for a short burst
                    const now = performance.now();
                    const lastSeek = lastSeekTimeRef.current.get(Number(clip.id)) || 0;

                    // Only scrub if the time difference is significant and we are actually seeking
                    if (diff > 0.05 && (now - lastSeek > 16)) {
                        video.currentTime = targetTime;
                        lastSeekTimeRef.current.set(Number(clip.id), now);

                        if (!isMuted && volume > 0) {
                            if (!isScrubbingRef.current) {
                                isScrubbingRef.current = true;
                            }
                            video.play().catch(() => { });

                            if (scrubTimeoutRef.current) clearTimeout(scrubTimeoutRef.current);
                            scrubTimeoutRef.current = setTimeout(() => {
                                isScrubbingRef.current = false;
                                const currentVideos = containerRef.current?.querySelectorAll('video');
                                currentVideos?.forEach(v => {
                                    if (!isPlaying) v.pause();
                                });
                            }, 80); // Slightly shorter burst for tighter control
                        }
                    } else if (diff < 0.01) {
                        // If very close and not playing, just make sure it's paused
                        if (!video.paused && !isScrubbingRef.current) {
                            video.pause();
                        }
                    }
                }
            }
        });
    }, [currentTime, isPlaying, activeClips, selectedClipObj, volume, isMuted, selectedClipId]);

    // Immediate stop on pause
    useEffect(() => {
        if (!isPlaying) {
            const currentVideos = containerRef.current?.querySelectorAll('video');
            currentVideos?.forEach(v => v.pause());
            if (scrubTimeoutRef.current) clearTimeout(scrubTimeoutRef.current);
            isScrubbingRef.current = false;
        }
    }, [isPlaying]);

    // FFmpeg Frame Rendering Logic
    const getExportClips = useCallback(() => {
        // Build a map: clipId -> trackIndex (for FFmpeg overlay ordering)
        // tracks[0] = top in UI = should be on TOP in preview = overlaid LAST
        // So top track gets HIGHEST trackIndex (descending sort in backend puts it last in overlay)
        const videoTracks = tracks.filter(t => t.type === 'video');
        const clipTrackMap = new Map<number, number>();
        videoTracks.forEach((t, idx) => {
            // tracks[0] = top UI track → gets idx 0
            // In backend: descending sort → idx 0 sorted LAST → overlaid LAST → ON TOP ✓
            t.clips.forEach(c => clipTrackMap.set(c.id, idx));
        });

        return activeClips.map(c => ({
            path: c.path,
            timeline_start: c.timelineStart,
            source_start: c.sourceStart,
            duration: c.duration,
            width: c.width || 1920,
            height: c.height || 1080,
            trackIndex: clipTrackMap.get(c.id) ?? 0,
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
            speed: c.speed || 1,
        }));
    }, [activeClips, tracks, settings]);

    const renderPendingRef = useRef(false);

    const updatePreviewFrame = useCallback(async (time: number) => {
        const clips = getExportClips();
        // Clip yoksa render yapma (siyah frame üretmeye gerek yok)
        if (clips.length === 0) return;

        if (renderPendingRef.current) return;
        renderPendingRef.current = true;
        setIsRendering(true);

        try {
            const exportSettings: ExportSettings = {
                ...settings,
                canvasWidth: canvasSize.w,
                canvasHeight: canvasSize.h
            };

            const dataUrl = await invoke<string>('render_timeline_frame', {
                clips,
                settings: exportSettings,
                time
            });

            if (dataUrl) {
                const img = new Image();
                img.onload = () => {
                    setPreviewImage(img);
                    setIsRendering(false);
                    renderPendingRef.current = false;
                };
                img.onerror = () => {
                    setIsRendering(false);
                    renderPendingRef.current = false;
                };
                img.src = dataUrl;
            } else {
                renderPendingRef.current = false;
                setIsRendering(false);
            }
        } catch (err) {
            renderPendingRef.current = false;
            setIsRendering(false);
        }
    }, [getExportClips, settings, canvasSize, isPlaying]);

    // FFmpeg render devre dışı — Tek kaynak stratejisi: her durumda video tag kullanılıyor.
    // updatePreviewFrame ve previewImage artık aktif olarak tetiklenmiyor.
    // Backend komutu (render_timeline_frame) gelecekte fallback olarak kullanılabilir.

    // Pause/Scrubbing sırasında video tag'lerinin currentTime'ını senkronize et
    // ve seeking bittiğinde Canvas'ı yeniden çizmeyi tetikle
    const [seekTrigger, setSeekTrigger] = useState(0);

    // Event listener setup - only when active clips change
    useEffect(() => {
        if (isPlaying) return;

        const videos: HTMLVideoElement[] = [];
        const onUpdate = () => setSeekTrigger(prev => prev + 1);

        activeClips.forEach(clip => {
            if (isImageFile(clip.path || '')) return;
            const video = containerRef.current?.querySelector(
                `video[data-clip-id="${String(clip.id)}"]`
            ) as HTMLVideoElement;
            if (!video) return;
            videos.push(video);
            video.playbackRate = clip.speed || 1;
            video.addEventListener('seeked', onUpdate);
            video.addEventListener('loadeddata', onUpdate);
        });

        return () => {
            videos.forEach(v => {
                v.removeEventListener('seeked', onUpdate);
                v.removeEventListener('loadeddata', onUpdate);
            });
        };
    }, [isPlaying, activeClips]);

    // Time synchronization - optimized for scrubbing
    useEffect(() => {
        if (isPlaying) return;

        activeClips.forEach(clip => {
            if (isImageFile(clip.path || '')) return;
            const video = containerRef.current?.querySelector(
                `video[data-clip-id="${String(clip.id)}"]`
            ) as HTMLVideoElement;
            if (!video) return;

            const clipLocalTime = (currentTime - clip.timelineStart) * (clip.speed || 1) + clip.sourceStart;
            // Only update if difference is significant or if it's the first sync
            if (clipLocalTime >= 0 && Math.abs(video.currentTime - clipLocalTime) > 0.005) {
                video.currentTime = clipLocalTime;
            }
        });
    }, [currentTime, isPlaying, activeClips]);

    // Continuous Render Loop (Scrubbing & Playback)
    useEffect(() => {
        let frameId: number;

        const updateLoop = () => {
            if (isPlaying) {
                const videos = containerRef.current?.querySelectorAll('video');
                let synced = false;

                if (videos && videos.length > 0) {
                    for (const video of Array.from(videos)) {
                        if (!video.paused) {
                            const attrId = video.getAttribute('data-clip-id');
                            const clip = activeClips.find(c => String(c.id) === attrId);
                            if (clip) {
                                const speed = clip.speed || 1;
                                const clipLocalTime = (currentTime - clip.timelineStart) * speed + clip.sourceStart;
                                const diff = Math.abs(video.currentTime - clipLocalTime);

                                // ONLY sync from video if it's strictly active, playing AND synced.
                                // 0.1s is a tight window to avoid PTS jumps
                                const isStrictlyActive = currentTime >= clip.timelineStart && currentTime < clip.timelineStart + clip.duration;

                                if (isStrictlyActive && diff < 0.1) {
                                    const newTimelineTime = (video.currentTime - clip.sourceStart) / speed + clip.timelineStart;

                                    // PREVENT JUMPING BACKWARDS or excessive jumps
                                    const drift = newTimelineTime - currentTime;
                                    if (drift > 0 && drift < 0.2) {
                                        setCurrentTime(newTimelineTime);
                                    }
                                    synced = true;
                                    break;
                                }
                            }
                        }
                    }
                }

                if (!synced && isPlaying) {
                    // Fallback: Aktif video yoksa veya yükleniyorsa zamanı manuel ilerlet
                    setCurrentTime(prev => {
                        const next = prev + 0.016;
                        return next >= duration ? duration : next;
                    });
                }

                const stopPoint = selectedClipObj ? selectedClipObj.timelineStart + selectedClipObj.duration : duration;

                if (currentTime >= stopPoint - 0.05) {
                    setIsPlaying(false);
                    setCurrentTime(stopPoint);
                    return;
                }
            }

            // Always request next frame for smooth scrubbing even when paused
            frameId = requestAnimationFrame(updateLoop);
        };

        frameId = requestAnimationFrame(updateLoop);
        return () => {
            if (frameId) cancelAnimationFrame(frameId);
        };
    }, [isPlaying, duration, currentTime, activeClips, selectedClipObj, setCurrentTime, setIsPlaying]);

    const getClipDims = useCallback((clip: Clip) => {
        const media = containerRef.current?.querySelector(`[data-clip-id="${String(clip.id)}"]`) as any;
        const w = clip.width || media?.videoWidth || media?.naturalWidth || 1280;
        const h = clip.height || media?.videoHeight || media?.naturalHeight || 720;
        return { w, h };
    }, [activeClips, selectedClipObj]);

    const { selBW, selBH } = useMemo(() => {
        const media = containerRef.current?.querySelector(`[data-clip-id="${String(selectedClipId)}"]`) as any;
        return {
            selBW: selectedClipObj?.width || media?.videoWidth || media?.naturalWidth || 1280,
            selBH: selectedClipObj?.height || media?.videoHeight || media?.naturalHeight || 720
        };
    }, [selectedClipId, selectedClipObj, tracks]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const stage = stageRef.current;
        if (!canvas || !stage) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const rect = stage.getBoundingClientRect();
        if (canvas.width !== rect.width || canvas.height !== rect.height) {
            canvas.width = rect.width;
            canvas.height = rect.height;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const projectW = Math.round(canvasSize.w * view.scale);
        const projectH = Math.round(canvasSize.h * view.scale);
        const projectX = Math.round(view.cx - projectW / 2);
        const projectY = Math.round(view.cy - projectH / 2);

        const isTransformOrCrop = activeTool === 'transform' || activeTool === 'crop';

        // Proje arka planı (Siyah)
        ctx.fillStyle = '#000';
        ctx.fillRect(projectX, projectY, projectW, projectH);

        // TEK KAYNAK: Her durumda (play/pause/scrub) video tag'lerini çiz
        const videoTracks = [...tracks].filter(t => t.type === 'video').reverse();
        videoTracks.forEach(track => {
            // Filter clips that are strictly active for drawing on canvas
            // Use a tiny 10ms overlap (0.01) instead of 1e-4 to ensure no gap due to frame timing
            const clips = activeClips.filter(c =>
                track.clips.some(tc => tc.id === c.id) &&
                currentTime >= c.timelineStart - 0.1 && // Reduced overlap for tighter transitions
                currentTime < (c.timelineStart + c.duration) + 0.1
            );
            clips.forEach(clip => {
                drawProxyClip(ctx, clip, view, canvasSize, selectedClipId, activeTool, containerRef, getClipDims);
            });
        });

        // Karartma Katmanı
        if (isTransformOrCrop && selectedClipId) {
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.beginPath();
            ctx.rect(0, 0, canvas.width, canvas.height);
            ctx.rect(projectX, projectY, projectW, projectH);
            ctx.fill('evenodd');
            ctx.restore();
        }
    }, [previewImage, canvasSize, view, isDragging, isRendering, isPlaying, tracks, activeClips, selectedClipId, selectedClipObj, getClipDims, activeTool, currentTime, duration, setIsPlaying, setCurrentTime, seekTrigger, fontsReady]);

    // Yardımcı Fonksiyon: Proxy Çizimi (Tek Kaynak — her durumda video tag)
    const drawProxyClip = (
        ctx: CanvasRenderingContext2D,
        clip: Clip,
        view: any,
        canvasSize: any,
        selId: number | null,
        tool: string,
        contRef: any,
        getDims: any
    ) => {
        const isText = clip.type === 'text';
        let media: any = null;
        let baseW = clip.width || 500;
        let baseH = clip.height || 100;

        if (!isText) {
            media = contRef.current?.querySelector(`[data-clip-id="${String(clip.id)}"]`);
            if (!media || (media.tagName === 'VIDEO' && media.videoWidth === 0) || (media.tagName === 'IMG' && media.naturalWidth === 0)) return;
            const dims = getDims(clip);
            baseW = dims.w;
            baseH = dims.h;
        }

        const tx = clip.transform?.x || 0;
        const ty = clip.transform?.y || 0;
        const sx = clip.transform?.scaleX || 1;
        const sy = clip.transform?.scaleY || 1;
        const cw = clip.crop?.w || 1;
        const ch = clip.crop?.h || 1;
        const cx = clip.crop?.x || 0;
        const cy = clip.crop?.y || 0;

        const isSelected = clip.id === selId;
        const isToolActive = tool === 'transform' || tool === 'crop';
        const isCropTool = isSelected && tool === 'crop';

        // Crop modunda orijinal klibin tamamını görürüz (karartma CSS/Overlay tarafında yapılır)
        const renderCW = isCropTool ? 1 : cw;
        const renderCH = isCropTool ? 1 : ch;
        const renderCX = isCropTool ? 0 : cx;
        const renderCY = isCropTool ? 0 : cy;

        // Orijinal merkeze göre konum hesapla
        const activeTX = isCropTool ? tx - (cx + cw / 2 - 0.5) * baseW * sx : tx;
        const activeTY = isCropTool ? ty - (cy + ch / 2 - 0.5) * baseH * sy : ty;

        const visW = Math.round(baseW * view.scale * sx * renderCW);
        const visH = Math.round(baseH * view.scale * sy * renderCH);
        const sX = Math.round(view.cx + (activeTX * view.scale) - visW / 2);
        const sY = Math.round(view.cy + (activeTY * view.scale) - visH / 2);

        const canBleedOut = isSelected && isToolActive;

        // Proje Konumu (Tam sayıya yuvarlanmış)
        const projectW = Math.round(canvasSize.w * view.scale);
        const projectH = Math.round(canvasSize.h * view.scale);
        const projectX = Math.round(view.cx - projectW / 2);
        const projectY = Math.round(view.cy - projectH / 2);

        ctx.save();
        if (!canBleedOut) {
            ctx.beginPath();
            ctx.rect(projectX, projectY, projectW, projectH);
            ctx.clip();
        }

        if (media && media.tagName === 'VIDEO') {
            const v = media as HTMLVideoElement;
            const clipLocalTime = (currentTime - clip.timelineStart) * (clip.speed || 1) + clip.sourceStart;
            const diff = Math.abs(v.currentTime - clipLocalTime);

            if (isPlaying) {
                // Playback: must be strict to avoid flickers and PTS jumps
                const isFlashFrame = clip.sourceStart > 0.1 && v.currentTime < 0.05 && diff > 0.1;
                // If it's seeking during playback, it's a real gap/buffer
                if (v.seeking || v.readyState < 2 || diff > 0.3 || isFlashFrame) {
                    ctx.restore();
                    return;
                }
            } else {
                // Scrubbing: NEVER show black or streaming loader if possible.
                // We show the "closest" frame available.
                // Only block if it's the very first frames of a trimmed clip (0.0s flash).
                const isIncorrectStart = clip.sourceStart > 0.2 && v.currentTime < 0.1 && diff > 0.2;
                if (isIncorrectStart) {
                    ctx.restore();
                    return;
                }
            }
        }

        // --- SVG FILTER APPLICATION ---
        // We use the SVG filter defined in the render method
        // calculated based on the clip's settings.
        // If settings are default, we don't apply filter to save perf.
        const s = clip.settings || settings;
        const hasFilters =
            (s.brightness || 0) !== 0 || (s.contrast || 0) !== 0 ||
            (s.saturation || 0) !== 0 || (s.exposure || 0) !== 0 ||
            (s.temp || 0) !== 0 || (s.tint || 0) !== 0 ||
            (s.sepia || 0) !== 0 || (s.hue || 0) !== 0 ||
            (s.blur || 0) !== 0 || (s.gamma || 0) !== 0 || (s.vibrance || 0) !== 0 ||
            (s.clarity || 0) !== 0 || (s.dehaze || 0) !== 0;

        if (hasFilters) {
            ctx.filter = `url(#filter-${clip.id})`;
        } else {
            ctx.filter = 'none';
        }

        ctx.globalAlpha = s.opacity ?? 1;
        ctx.globalCompositeOperation = 'source-over';

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium'; // 'medium' is faster for drag/play

        ctx.save();
        ctx.translate(sX + visW / 2, sY + visH / 2);
        if (clip.transform?.rotation) {
            ctx.rotate((clip.transform.rotation * Math.PI) / 180);
        }
        ctx.scale(clip.transform?.flipX ? -1 : 1, clip.transform?.flipY ? -1 : 1);

        if (isText && clip.textData) {
            ctx.scale(visW / baseW, visH / baseH);
            ctx.font = `${clip.textData.fontWeight || 'normal'} ${clip.textData.fontSize}px "${clip.textData.fontFamily || 'Inter'}", sans-serif`;
            ctx.fillStyle = clip.textData.color || '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (clip.textData.letterSpacing) {
                (ctx as any).letterSpacing = `${clip.textData.letterSpacing}px`;
            }

            const lines = clip.textData.text.split('\n');
            const lineHeight = clip.textData.fontSize * 1.2;
            const totalHeight = lineHeight * lines.length;
            const startY = -totalHeight / 2 + (lineHeight / 2);

            lines.forEach((line, i) => {
                ctx.fillText(line, 0, startY + i * lineHeight);
            });
        } else if (media) {
            ctx.drawImage(
                media,
                renderCX * baseW, renderCY * baseH, renderCW * baseW, renderCH * baseH,
                -visW / 2, -visH / 2, visW, visH
            );
        }
        ctx.restore();

        // --- Color Balance (JS pixel manipulation — luminance-based, FFmpeg-matching) ---
        const cbShR = s.shR || 0, cbShG = s.shG || 0, cbShB = s.shB || 0;
        const cbMidR = s.midR || 0, cbMidG = s.midG || 0, cbMidB = s.midB || 0;
        const cbHiR = s.hiR || 0, cbHiG = s.hiG || 0, cbHiB = s.hiB || 0;
        const hasCB = Math.abs(cbShR) > 0.001 || Math.abs(cbShG) > 0.001 || Math.abs(cbShB) > 0.001 ||
            Math.abs(cbMidR) > 0.001 || Math.abs(cbMidG) > 0.001 || Math.abs(cbMidB) > 0.001 ||
            Math.abs(cbHiR) > 0.001 || Math.abs(cbHiG) > 0.001 || Math.abs(cbHiB) > 0.001;
        if (hasCB) {
            ctx.filter = 'none';
            // Compute pixel region (intersection with project boundary)
            const px0 = Math.max(0, canBleedOut ? sX : Math.max(sX, projectX));
            const py0 = Math.max(0, canBleedOut ? sY : Math.max(sY, projectY));
            const px1 = Math.min(ctx.canvas.width, canBleedOut ? sX + visW : Math.min(sX + visW, projectX + projectW));
            const py1 = Math.min(ctx.canvas.height, canBleedOut ? sY + visH : Math.min(sY + visH, projectY + projectH));
            const pw = Math.round(px1 - px0);
            const ph = Math.round(py1 - py0);
            if (pw > 0 && ph > 0) {
                const imgData = ctx.getImageData(Math.round(px0), Math.round(py0), pw, ph);
                const d = imgData.data;
                const mul = 2.0; // Match FFmpeg 2.0x multiplier
                for (let i = 0; i < d.length; i += 4) {
                    const r = d[i] / 255;
                    const g = d[i + 1] / 255;
                    const b = d[i + 2] / 255;
                    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    // FFmpeg-matching weight functions
                    const sw = Math.max(0, 1 - 2 * lum);        // shadow: peaks at dark
                    const mw = 1 - 2 * Math.abs(lum - 0.5);     // midtone: bell at 0.5
                    const hw = Math.max(0, 2 * lum - 1);         // highlight: peaks at bright
                    d[i] = Math.min(255, Math.max(0, d[i] + (cbShR * sw + cbMidR * mw + cbHiR * hw) * mul * 255));
                    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + (cbShG * sw + cbMidG * mw + cbHiG * hw) * mul * 255));
                    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + (cbShB * sw + cbMidB * mw + cbHiB * hw) * mul * 255));
                }
                ctx.putImageData(imgData, Math.round(px0), Math.round(py0));
            }
        }

        // Vignette (Simulated with Gradient because SVG masking is slow)
        if ((s.vignette || 0) > 0) {
            ctx.filter = 'none'; // Reset filter for vignette overlay
            const vVal = s.vignette!;
            const radius = Math.max(visW, visH) * 0.8;
            const cx = sX + visW / 2;
            const cy = sY + visH / 2;
            const grad = ctx.createRadialGradient(cx, cy, radius * (1 - vVal * 0.5), cx, cy, radius);
            grad.addColorStop(0, 'rgba(0,0,0,0)');
            grad.addColorStop(1, `rgba(0,0,0,${vVal * 0.8})`); // Max 80% opacity

            ctx.fillStyle = grad;
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillRect(sX, sY, visW, visH);
        }

        ctx.restore();
    };


    const handleWheel = (e: React.WheelEvent) => {
        if (!stageRef.current) return;
        const rect = stageRef.current.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.min(Math.max(view.scale * delta, 0.05), 5);
        setView(v => ({
            cx: mx - (mx - v.cx) * (newScale / v.scale),
            cy: my - (my - v.cy) * (newScale / v.scale),
            scale: newScale
        }));
    };

    const findClipAt = (x: number, y: number) => {
        if (!stageRef.current) return null;
        const rect = stageRef.current.getBoundingClientRect();
        const mx = x - rect.left;
        const my = y - rect.top;
        for (let i = activeClips.length - 1; i >= 0; i--) {
            const clip = activeClips[i];
            const tx = clip.transform?.x || 0;
            const ty = clip.transform?.y || 0;
            const sx = clip.transform?.scaleX || 1;
            const sy = clip.transform?.scaleY || 1;
            const cw = clip.crop?.w || 1;
            const ch = clip.crop?.h || 1;
            const baseW = clip.width || 1920;
            const baseH = clip.height || 1080;
            const sW = baseW * view.scale * sx * cw;
            const sH = baseH * view.scale * sy * ch;
            const sCX = view.cx + tx * view.scale;
            const sCY = view.cy + ty * view.scale;
            const rot = (clip.transform?.rotation || 0) * Math.PI / 180;
            const cos = Math.cos(rot);
            const sin = Math.sin(rot);
            const ldx = mx - sCX;
            const ldy = my - sCY;
            const localX = ldx * cos + ldy * sin;
            const localY = -ldx * sin + ldy * cos;

            if (Math.abs(localX) <= sW / 2 && Math.abs(localY) <= sH / 2) {
                return clip.id;
            }
        }
        return null;
    };

    const handlePointerDown = (e: React.PointerEvent, handle: string | null = null, clipId: number | null = null) => {
        const target = e.currentTarget as HTMLElement;
        const isBg = e.target === stageRef.current || (e.target as HTMLElement).tagName === 'CANVAS';
        if (handle && activeTool === 'transform' && clipId === null) {
            e.stopPropagation();
            target.setPointerCapture(e.pointerId);
            setIsDragging(true);
            isDraggingRef.current = true;
            actionRef.current = { ...actionRef.current, type: 'resize', handle, startX: e.clientX, startY: e.clientY, startW: canvasSize.w, startH: canvasSize.h, startCX: view.cx, startCY: view.cy };
            dragOriginRef.current = { x: 0, y: 0, scaleX: 1, scaleY: 1, canvasW: canvasSize.w, canvasH: canvasSize.h };
        } else if (handle && activeTool === 'transform' && clipId !== null) {
            e.stopPropagation();
            const clip = activeClips.find(c => c.id === clipId);
            if (!clip) return;
            target.setPointerCapture(e.pointerId);
            setIsDragging(true);
            isDraggingRef.current = true;
            actionRef.current = { ...actionRef.current, type: 'resize-clip', handle, startX: e.clientX, startY: e.clientY, startTX: clip.transform?.x || 0, startTY: clip.transform?.y || 0, startScaleX: clip.transform?.scaleX || 1, startScaleY: clip.transform?.scaleY || 1 };
            dragOriginRef.current = { x: clip.transform?.x || 0, y: clip.transform?.y || 0, scaleX: clip.transform?.scaleX || 1, scaleY: clip.transform?.scaleY || 1, canvasW: 0, canvasH: 0 };
        } else if (handle && activeTool === 'crop' && clipId !== null) {
            e.stopPropagation();
            const clip = activeClips.find(c => c.id === clipId);
            if (!clip) return;
            target.setPointerCapture(e.pointerId);
            setIsDragging(true);
            isDraggingRef.current = true;
            actionRef.current = { ...actionRef.current, type: 'crop', handle, startX: e.clientX, startY: e.clientY, startCrop: localCrop || clip.crop || { x: 0, y: 0, w: 1, h: 1 } };
        } else if (e.button === 0 && activeTool !== 'crop') {
            const hitId = findClipAt(e.clientX, e.clientY);
            if (hitId !== null) {
                setSelectedClipId(hitId);
                const clip = activeClips.find(c => c.id === hitId);
                if (!clip) return;
                target.setPointerCapture(e.pointerId);
                setIsDragging(true);
                isDraggingRef.current = true;
                actionRef.current = { ...actionRef.current, type: 'move', startX: e.clientX, startY: e.clientY, startTX: clip.transform?.x || 0, startTY: clip.transform?.y || 0 };
                dragOriginRef.current = { x: clip.transform?.x || 0, y: clip.transform?.y || 0, scaleX: clip.transform?.scaleX || 1, scaleY: clip.transform?.scaleY || 1, canvasW: 0, canvasH: 0 };
            } else if (isBg) {
                setSelectedClipId(null);
                target.setPointerCapture(e.pointerId);
                setIsPanning(true);
                actionRef.current = { ...actionRef.current, type: 'pan', startX: e.clientX, startY: e.clientY, startCX: view.cx, startCY: view.cy };
            }
        }
    };

    const updateClipTransform = useCallback((id: number, t: Partial<{ x: number, y: number, scaleX: number, scaleY: number }>) => {
        setTracks(prev => prev.map(track => ({
            ...track,
            clips: track.clips.map(c => c.id === id ? { ...c, transform: { ...c.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1 }, ...t } } : c)
        })));
    }, [setTracks]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!actionRef.current.type) return;
        const { type, handle, startX, startY, startW, startH, startCX, startCY, startTX, startTY, startScaleX, startScaleY, startCrop } = actionRef.current;
        const dx = (e.clientX - startX) / view.scale;
        const dy = (e.clientY - startY) / view.scale;

        if (type === 'pan') {
            setView(v => ({ ...v, cx: startCX + (e.clientX - startX), cy: startCY + (e.clientY - startY) }));
        } else if (type === 'resize' && handle) {
            let newW = startW, newH = startH;
            if (isLocked && handle.length === 2) {
                const dirX = handle.includes('e') ? 1 : -1;
                const dirY = handle.includes('s') ? 1 : -1;
                const mag = Math.sqrt(startW * startW + startH * startH);
                const dot = (dx * dirX * startW + dy * dirY * startH) / mag;
                const scale = 1 + (dot * 2) / mag;
                newW = startW * scale;
                newH = startH * scale;
            } else {
                if (handle.includes('e')) newW = startW + dx * 2;
                else if (handle.includes('w')) newW = startW - dx * 2;
                if (handle.includes('s')) newH = startH + dy * 2;
                else if (handle.includes('n')) newH = startH - dy * 2;
                if (isLocked) {
                    const ratio = startH / startW;
                    if (handle.includes('e') || handle.includes('w')) newH = newW * ratio;
                    else if (handle.includes('s') || handle.includes('n')) newW = newH / ratio;
                }
            }
            setCanvasSize({ w: Math.max(10, Math.round(newW)), h: Math.max(10, Math.round(newH)) });
        } else if (activeTool === 'crop' && (handle || type === 'crop') && selectedClipObj) {
            const clip = selectedClipObj;
            const media = containerRef.current?.querySelector(`[data-clip-id="${String(clip.id)}"]`) as any;
            const baseW = clip.width || media?.videoWidth || media?.naturalWidth || 1280;
            const baseH = clip.height || media?.videoHeight || media?.naturalHeight || 720;
            const sx = clip.transform?.scaleX || 1;
            const sy = clip.transform?.scaleY || 1;
            const fixedCrop = clip.crop || { x: 0, y: 0, w: 1, h: 1 };
            const tx = clip.transform?.x || 0;
            const ty = clip.transform?.y || 0;
            const ndx = dx / (baseW * sx);
            const ndy = dy / (baseH * sy);
            const origCX = tx - (fixedCrop.x + fixedCrop.w / 2 - 0.5) * baseW * sx;
            const origCY = ty - (fixedCrop.y + fixedCrop.h / 2 - 0.5) * baseH * sy;
            const snapT = 12 / view.scale;
            const hSnaps = [-canvasSize.w / 2, 0, canvasSize.w / 2];
            const vSnaps = [-canvasSize.h / 2, 0, canvasSize.h / 2];
            activeClips.forEach(otherClip => {
                if (otherClip.id === selectedClipId) return;
                const ov = containerRef.current?.querySelector(`[data-clip-id="${String(otherClip.id)}"]`) as any;
                const oBW = otherClip.width || ov?.videoWidth || ov?.naturalWidth || 1280;
                const oBH = otherClip.height || ov?.videoHeight || ov?.naturalHeight || 720;
                const oSX = otherClip.transform?.scaleX || 1, oSY = otherClip.transform?.scaleY || 1;
                const oCW = otherClip.crop?.w || 1, oCH = otherClip.crop?.h || 1;
                const oVW = oBW * oSX * oCW, oVH = oBH * oSY * oCH;
                const oX = otherClip.transform?.x || 0, oY = otherClip.transform?.y || 0;
                hSnaps.push(oX - oVW / 2, oX, oX + oVW / 2);
                vSnaps.push(oY - oVH / 2, oY, oY + oVH / 2);
            });
            const toCropX = (px: number) => (px - origCX) / (baseW * sx) + 0.5;
            const toCropY = (py: number) => (py - origCY) / (baseH * sy) + 0.5;
            const fromCropX = (cx: number) => origCX + (cx - 0.5) * baseW * sx;
            const fromCropY = (cy: number) => origCY + (cy - 0.5) * baseH * sy;
            if (handle) {
                let nx = startCrop.x, ny = startCrop.y, nw = startCrop.w, nh = startCrop.h;
                if (isLocked) {
                    if (handle.length === 2) {
                        const mag = Math.sqrt(startCrop.w * startCrop.w + startCrop.h * startCrop.h);
                        const dot = (ndx * (handle.includes('e') ? 1 : -1) * startCrop.w + ndy * (handle.includes('s') ? 1 : -1) * startCrop.h) / mag;
                        let targetScale = 1 + (dot / mag);
                        const candidateNW = startCrop.w * targetScale;
                        const candidateNH = startCrop.h * targetScale;
                        const candidateNX = handle.includes('w') ? startCrop.x + (startCrop.w - candidateNW) : startCrop.x;
                        const candidateNY = handle.includes('n') ? startCrop.y + (startCrop.h - candidateNH) : startCrop.y;
                        let snappedScaleX = targetScale;
                        let snappedScaleY = targetScale;
                        const edgeX = fromCropX(candidateNX + (handle.includes('e') ? candidateNW : 0));
                        const startEdgeX = fromCropX(startCrop.x + (handle.includes('e') ? startCrop.w : 0));
                        for (let sX of hSnaps) {
                            if (Math.abs(sX - edgeX) < snapT) {
                                if (Math.abs(sX - startEdgeX) < 1.0 && Math.abs(dx) < 12) continue;
                                snappedScaleX = (Math.abs(sX - fromCropX(handle.includes('e') ? startCrop.x : startCrop.x + startCrop.w))) / (baseW * sx * startCrop.w);
                                break;
                            }
                        }
                        const edgeY = fromCropY(candidateNY + (handle.includes('s') ? candidateNH : 0));
                        const startEdgeY = fromCropY(startCrop.y + (handle.includes('s') ? startCrop.h : 0));
                        for (let sY of vSnaps) {
                            if (Math.abs(sY - edgeY) < snapT) {
                                if (Math.abs(sY - startEdgeY) < 1.0 && Math.abs(dy) < 12) continue;
                                snappedScaleY = (Math.abs(sY - fromCropY(handle.includes('s') ? startCrop.y : startCrop.y + startCrop.h))) / (baseH * sy * startCrop.h);
                                break;
                            }
                        }
                        targetScale = (snappedScaleX + snappedScaleY) / 2;
                        let maxS = 100;
                        if (handle.includes('e')) maxS = Math.min(maxS, (1 - startCrop.x) / startCrop.w);
                        else maxS = Math.min(maxS, (startCrop.x + startCrop.w) / startCrop.w);
                        if (handle.includes('s')) maxS = Math.min(maxS, (1 - startCrop.y) / startCrop.h);
                        else maxS = Math.min(maxS, (startCrop.y + startCrop.h) / startCrop.h);
                        const safeScale = Math.max(0.01 / Math.min(startCrop.w, startCrop.h), Math.min(maxS, targetScale));
                        nw = startCrop.w * safeScale; nh = startCrop.h * safeScale;
                        if (handle.includes('w')) nx = startCrop.x + (startCrop.w - nw);
                        if (handle.includes('n')) ny = startCrop.y + (startCrop.h - nh);
                    } else {
                        const isHorizontal = handle === 'e' || handle === 'w';
                        const dir = (handle === 'e' || handle === 's') ? 1 : -1;
                        let targetScale = 1 + (isHorizontal ? (ndx * dir) / startCrop.w : (ndy * dir) / startCrop.h);
                        if (isHorizontal) {
                            const candidateNX = handle === 'w' ? startCrop.x + (startCrop.w - startCrop.w * targetScale) : startCrop.x;
                            const edgeX = fromCropX(handle === 'e' ? candidateNX + startCrop.w * targetScale : candidateNX);
                            for (let sX of hSnaps) {
                                if (Math.abs(sX - edgeX) < snapT) {
                                    targetScale = (Math.abs(sX - fromCropX(handle === 'e' ? startCrop.x : startCrop.x + startCrop.w))) / (baseW * sx * startCrop.w);
                                    break;
                                }
                            }
                        } else {
                            const candidateNY = handle === 'n' ? startCrop.y + (startCrop.h - startCrop.h * targetScale) : startCrop.y;
                            const edgeY = fromCropY(handle === 's' ? candidateNY + startCrop.h * targetScale : candidateNY);
                            for (let sY of vSnaps) {
                                if (Math.abs(sY - edgeY) < snapT) {
                                    targetScale = (Math.abs(sY - fromCropY(handle === 's' ? startCrop.y : startCrop.y + startCrop.h))) / (baseH * sy * startCrop.h);
                                    break;
                                }
                            }
                        }
                        let maxS = 100;
                        if (isHorizontal) {
                            maxS = handle === 'e' ? (1 - startCrop.x) / startCrop.w : (startCrop.x + startCrop.w) / startCrop.w;
                            const maxVerticalS = Math.min((2 * startCrop.y + startCrop.h) / startCrop.h, (2 - (2 * startCrop.y + startCrop.h)) / startCrop.h);
                            maxS = Math.min(maxS, maxVerticalS);
                        } else {
                            maxS = handle === 's' ? (1 - startCrop.y) / startCrop.h : (startCrop.y + startCrop.h) / startCrop.h;
                            const maxHorizontalS = Math.min((2 * startCrop.x + startCrop.w) / startCrop.w, (2 - (2 * startCrop.x + startCrop.w)) / startCrop.w);
                            maxS = Math.min(maxS, maxHorizontalS);
                        }
                        const safeScale = Math.max(0.01 / Math.min(startCrop.w, startCrop.h), Math.min(maxS, targetScale));
                        const prevW = nw, prevH = nh;
                        nw = startCrop.w * safeScale; nh = startCrop.h * safeScale;
                        if (handle === 'w') nx = startCrop.x + (startCrop.w - nw);
                        else if (handle === 'e') nx = startCrop.x;
                        else nx = startCrop.x + (prevW - nw) / 2;
                        if (handle === 'n') ny = startCrop.y + (startCrop.h - nh);
                        else if (handle === 's') ny = startCrop.y;
                        else ny = startCrop.y + (prevH - nh) / 2;
                    }
                } else {
                    if (handle.includes('e')) nw = Math.max(0.01, startCrop.w + ndx);
                    if (handle.includes('w')) {
                        nw = Math.max(0.01, startCrop.w - ndx);
                        nx = Math.min(startCrop.x + startCrop.w - 0.01, startCrop.x + ndx);
                    }
                    if (handle.includes('e') || handle.includes('w')) {
                        const edgeX = fromCropX(nx + (handle.includes('e') ? nw : 0));
                        for (let sX of hSnaps) {
                            if (Math.abs(sX - edgeX) < snapT) {
                                if (handle.includes('e')) nw = toCropX(sX) - nx;
                                else { const oldR = nx + nw; nx = toCropX(sX); nw = oldR - nx; }
                                break;
                            }
                        }
                    }
                    if (handle.includes('s')) nh = Math.max(0.01, startCrop.h + ndy);
                    if (handle.includes('n')) {
                        nh = Math.max(0.01, startCrop.h - ndy);
                        ny = Math.min(startCrop.y + startCrop.h - 0.01, startCrop.y + ndy);
                    }
                    if (handle.includes('s') || handle.includes('n')) {
                        const edgeY = fromCropY(ny + (handle.includes('s') ? nh : 0));
                        for (let sY of vSnaps) {
                            if (Math.abs(sY - edgeY) < snapT) {
                                if (handle.includes('s')) nh = toCropY(sY) - ny;
                                else { const oldB = ny + nh; ny = toCropY(sY); nh = oldB - ny; }
                                break;
                            }
                        }
                    }
                }
                nx = Math.max(0, Math.min(1 - nw, nx));
                ny = Math.max(0, Math.min(1 - nh, ny));
                nw = Math.max(0.01, Math.min(1 - nx, nw));
                nh = Math.max(0.01, Math.min(1 - ny, nh));
                setLocalCrop({ x: nx, y: ny, w: nw, h: nh });
            } else {
                let nx = startCrop.x + ndx;
                let ny = startCrop.y + ndy;
                let nw = startCrop.w;
                let nh = startCrop.h;
                const candidateL = fromCropX(nx);
                const candidateR = fromCropX(nx + nw);
                const candidateM = fromCropX(nx + nw / 2);
                let bestDX = snapT;
                let snapX = nx;
                [[candidateL, 0], [candidateR, nw], [candidateM, nw / 2]].forEach(([val, offset]) => {
                    for (let sX of hSnaps) {
                        const diff = sX - val;
                        if (Math.abs(diff) < Math.abs(bestDX)) {
                            bestDX = diff;
                            snapX = toCropX(sX) - offset;
                        }
                    }
                });
                if (Math.abs(bestDX) < snapT) nx = snapX;
                const candidateT = fromCropY(ny);
                const candidateB = fromCropY(ny + nh);
                const candidateVM = fromCropY(ny + nh / 2);
                let bestDY = snapT;
                let snapY = ny;
                [[candidateT, 0], [candidateB, nh], [candidateVM, nh / 2]].forEach(([val, offset]) => {
                    for (let sY of vSnaps) {
                        const diff = sY - val;
                        if (Math.abs(diff) < Math.abs(bestDY)) {
                            bestDY = diff;
                            snapY = toCropY(sY) - offset;
                        }
                    }
                });
                if (Math.abs(bestDY) < snapT) ny = snapY;
                nx = Math.max(0, Math.min(1 - startCrop.w, nx));
                ny = Math.max(0, Math.min(1 - startCrop.h, ny));
                setLocalCrop({ ...startCrop, x: nx, y: ny });
            }
        } else if (type === 'move' && selectedClipId) {
            const clip = activeClips.find(c => c.id === selectedClipId);
            if (!clip) return;

            const baseW = clip.width || 1920;
            const baseH = clip.height || 1080;
            const sX = clip.transform?.scaleX || 1;
            const sY = clip.transform?.scaleY || 1;
            const cW = clip.crop?.w || 1;
            const cH = clip.crop?.h || 1;

            const currentW = baseW * sX * cW;
            const currentH = baseH * sY * cH;

            const snapT = 10 / view.scale;
            let targetTX = startTX + dx;
            let targetTY = startTY + dy;

            // --- Snapping Logic ---
            const hTargets = [-canvasSize.w / 2, 0, canvasSize.w / 2];
            const vTargets = [-canvasSize.h / 2, 0, canvasSize.h / 2];

            activeClips.forEach(c => {
                if (c.id === selectedClipId) return;
                const cw = (c.width || 1920) * (c.transform?.scaleX || 1) * (c.crop?.w || 1);
                const ch = (c.height || 1080) * (c.transform?.scaleY || 1) * (c.crop?.h || 1);
                const ctx = c.transform?.x || 0;
                const cty = c.transform?.y || 0;
                hTargets.push(ctx - cw / 2, ctx, ctx + cw / 2);
                vTargets.push(cty - ch / 2, cty, cty + ch / 2);
            });

            // X Snapping
            let bestDX = snapT;
            let snappedTX = targetTX;
            // Candidates: Left, Center, Right edge of moving clip
            const xCandidates = [
                { offset: -currentW / 2 }, // Left Edge
                { offset: 0 },             // Center
                { offset: currentW / 2 }   // Right Edge
            ];

            xCandidates.forEach(cand => {
                const currentPos = targetTX + cand.offset;
                hTargets.forEach(target => {
                    const diff = target - currentPos;
                    if (Math.abs(diff) < Math.abs(bestDX)) {
                        bestDX = diff;
                        snappedTX = targetTX + diff;
                    }
                });
            });

            // Y Snapping
            let bestDY = snapT;
            let snappedTY = targetTY;
            const yCandidates = [
                { offset: -currentH / 2 }, // Top Edge
                { offset: 0 },             // Center
                { offset: currentH / 2 }   // Bottom Edge
            ];

            yCandidates.forEach(cand => {
                const currentPos = targetTY + cand.offset;
                vTargets.forEach(target => {
                    const diff = target - currentPos;
                    if (Math.abs(diff) < Math.abs(bestDY)) {
                        bestDY = diff;
                        snappedTY = targetTY + diff;
                    }
                });
            });

            updateClipTransform(selectedClipId, { x: snappedTX, y: snappedTY });

        } else if (type === 'resize-clip' && selectedClipId && handle) {
            const clip = activeClips.find(c => c.id === selectedClipId);
            if (!clip) return;

            const baseW = clip.width || 1920;
            const baseH = clip.height || 1080;

            // Local delta based on rotation
            const rot = (clip.transform?.rotation || 0) * Math.PI / 180;
            const rCos = Math.cos(rot);
            const rSin = Math.sin(rot);
            const ldx = dx * rCos + dy * rSin;
            const ldy = -dx * rSin + dy * rCos;

            let nSX = startScaleX;
            let nSY = startScaleY;

            if (isLocked) {
                // Kilitli Mod: Mevcut Aspect Ratio Koruma Mantığı
                if (handle.includes('e') || handle.includes('w')) {
                    if (handle.includes('e')) nSX += (ldx * 2) / baseW;
                    else nSX -= (ldx * 2) / baseW;
                    nSX = Math.max(0.01, nSX);
                    nSY = nSX * (startScaleY / startScaleX);
                }
                else if (handle.includes('n') || handle.includes('s')) {
                    if (handle.includes('s')) nSY += (ldy * 2) / baseH;
                    else nSY -= (ldy * 2) / baseH;
                    nSY = Math.max(0.01, nSY);
                    nSX = nSY * (startScaleX / startScaleY);
                }
            } else {
                // Serbest Mod: Tutamaç tipine göre bağımsız ölçeklendirme
                if (handle.includes('e')) nSX = Math.max(0.01, startScaleX + (ldx * 2) / baseW);
                else if (handle.includes('w')) nSX = Math.max(0.01, startScaleX - (ldx * 2) / baseW);

                if (handle.includes('s')) nSY = Math.max(0.01, startScaleY + (ldy * 2) / baseH);
                else if (handle.includes('n')) nSY = Math.max(0.01, startScaleY - (ldy * 2) / baseH);
            }

            updateClipTransform(selectedClipId, { scaleX: nSX, scaleY: nSY });
        }
    }, [view.scale, isLocked, setCanvasSize, selectedClipId, activeClips, updateClipTransform, localCrop, selectedClipObj, canvasSize]);

    const handlePointerUp = (e: React.PointerEvent) => {
        const actionType = actionRef.current.type;
        actionRef.current.type = null;
        setIsDragging(false);
        isDraggingRef.current = false;
        setIsPanning(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);

        if (actionType === 'move' || actionType === 'resize-clip' || actionType === 'resize' || actionType === 'crop') {
            updatePreviewFrame(currentTime);
        }

        if (actionType === 'move' && selectedClipId) {
            onTransformCommit(t('history.move_clip') || 'Move');
        } else if (actionType === 'resize-clip') {
            onTransformCommit(t('editor.scale') || 'Scale');
        } else if (actionType === 'resize') {
            onTransformCommit(t('editor.canvas_resize') || 'Resize Canvas');
        } else if (actionType === 'crop') {
            onTransformCommit(t('editor.apply_crop') || 'Crop');
        }
    };

    return (
        <div
            className="ve-preview-section" ref={stageRef} onWheel={handleWheel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onContextMenu={e => e.preventDefault()}
            style={{ cursor: isPanning ? 'grabbing' : 'default', userSelect: 'none', touchAction: 'none', position: 'relative', overflow: 'hidden' }}
        >
            {/* SVG Filters Definition */}
            <svg style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}>
                <defs>
                    {activeClips.map(clip => {
                        const s = clip.settings || settings;
                        // FFmpeg Logic Matching
                        // 1. Gain (Exposure + Brightness)
                        // FFmpeg: colorchannelmixer=rr=gain:gg=gain:bb=gain
                        const gain = Math.pow(2, (s.exposure || 0) * 0.5) * ((s.brightness || 0) * 0.25 + 1.0);

                        // 2. Contrast, Saturation & Dehaze (Softer Dynamic Balance)
                        const dehazeAmount = (s.dehaze || 0);
                        const c = (s.contrast || 0) * 0.45 + 1.0 + (dehazeAmount * 0.12);
                        const satDampening = Math.max(0, (s.contrast || 0) * 0.215);
                        const vibranceStyle = (s.vibrance || 0) * 0.425;
                        const sat = ((s.saturation || 0) * 0.5 + 1.0 + vibranceStyle) * (1.0 - satDampening);

                        // 3. Gamma & Dehaze Black Point (Softer)
                        const g = (s.gamma || 0) * 0.5 - (dehazeAmount * 0.08);
                        const svgGamma = g < 0 ? 1.0 / (Math.abs(g) + 1.0) : (g + 1.0);

                        // 4. Hue
                        const hueRot = (s.hue || 0) * 180;

                        // 5. Color Balance (Temp/Tint)
                        const rs = (s.temp || 0) * 0.4;
                        const bs = -(s.temp || 0) * 0.4;
                        const gs = (s.tint || 0) * 0.4;
                        const rBal = 1.0 + rs;
                        const gBal = 1.0 + gs;
                        const bBal = 1.0 + bs;

                        // 6. Sepia
                        const sepia = s.sepia || 0;

                        return (
                            <filter id={`filter-${clip.id}`} key={clip.id} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
                                {/* 1. Blur */}
                                {(s.blur || 0) > 0 && (
                                    <feGaussianBlur in="SourceGraphic" stdDeviation={(s.blur || 0) * 0.4} result="BLUR" />
                                )}

                                {/* 2. Combined Gain & Contrast Matrix (Prevents Clipping) */}
                                <feColorMatrix
                                    in={(s.blur || 0) > 0 ? "BLUR" : "SourceGraphic"}
                                    type="matrix"
                                    values={`
                                        ${gain * c} 0 0 0 ${0.5 * (1 - c)}
                                        0 ${gain * c} 0 0 ${0.5 * (1 - c)}
                                        0 0 ${gain * c} 0 ${0.5 * (1 - c)}
                                        0 0 0 1 0
                                    `}
                                    result="BASE_ADJUST"
                                />

                                {/* 3. Clarity (Sharpen / Convolve Matrix) */}
                                {Math.abs(s.clarity || 0) > 0.01 && (
                                    <feConvolveMatrix
                                        in="BASE_ADJUST"
                                        order="3"
                                        preserveAlpha="true"
                                        kernelMatrix={`
                                            0 ${-(s.clarity || 0) * 0.5} 0
                                            ${-(s.clarity || 0) * 0.5} ${1 + (s.clarity || 0) * 2} ${-(s.clarity || 0) * 0.5}
                                            0 ${-(s.clarity || 0) * 0.5} 0
                                        `}
                                        result="CLARITY"
                                    />
                                )}

                                {/* 4. Saturation & Hue */}
                                <feColorMatrix in={Math.abs(s.clarity || 0) > 0.01 ? "CLARITY" : "BASE_ADJUST"} type="saturate" values={`${sat}`} result="SAT" />
                                <feColorMatrix in="SAT" type="hueRotate" values={`${hueRot}`} result="HUE" />

                                {/* 5. Temp/Tint only */}
                                <feColorMatrix
                                    in="HUE"
                                    type="matrix"
                                    values={`
                                        ${rBal} 0 0 0 0
                                        0 ${gBal} 0 0 0
                                        0 0 ${bBal} 0 0
                                        0 0 0 1 0
                                    `}
                                    result="COLOR_BAL"
                                />

                                {/* 5. Gamma */}
                                <feComponentTransfer in="COLOR_BAL" result="GAMMA">
                                    <feFuncR type="gamma" exponent={svgGamma} />
                                    <feFuncG type="gamma" exponent={svgGamma} />
                                    <feFuncB type="gamma" exponent={svgGamma} />
                                </feComponentTransfer>

                                {/* 6. Sepia (Final Style Overlay) */}
                                {sepia > 0 ? (
                                    <feColorMatrix
                                        in="GAMMA"
                                        type="matrix"
                                        values={`
                                            ${1.0 - sepia + sepia * 0.393} ${sepia * 0.769} ${sepia * 0.189} 0 0
                                            ${sepia * 0.349} ${1.0 - sepia + sepia * 0.686} ${sepia * 0.168} 0 0
                                            ${sepia * 0.272} ${sepia * 0.534} ${1.0 - sepia + sepia * 0.131} 0 0
                                            0 0 0 1 0
                                        `}
                                        result="SEPIA"
                                    />
                                ) : (
                                    <feColorMatrix in="GAMMA" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0" result="SEPIA" />
                                )}
                            </filter>
                        );
                    })}
                </defs>
            </svg>

            <div style={{
                transform: `translate(${view.cx - (canvasSize.w * view.scale / 2)}px, ${view.cy - (canvasSize.h * view.scale / 2)}px)`,
                width: canvasSize.w * view.scale, height: canvasSize.h * view.scale,
                position: 'absolute', zIndex: 0, backgroundColor: 'black', pointerEvents: 'none'
            }}>
                {activeClips.length === 0 && <div className="text-white/20 text-center mt-10">NO CLIP</div>}
            </div>

            <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }} />

            {/* Vignette Preview Overlay */}
            {activeClips.length > 0 && Array.from(new Set(activeClips.map(c => c.id))).map(cid => {
                const clip = activeClips.find(c => c.id === cid);
                const s = clip?.settings || settings;
                if (!s.vignette || s.vignette < 0.01) return null;
                return (
                    <div
                        key={`vignette-${cid}`}
                        style={{
                            position: 'absolute',
                            left: view.cx - (canvasSize.w * view.scale / 2),
                            top: view.cy - (canvasSize.h * view.scale / 2),
                            width: canvasSize.w * view.scale,
                            height: canvasSize.h * view.scale,
                            pointerEvents: 'none',
                            zIndex: 1, // Above canvas
                            background: `radial-gradient(circle, transparent ${100 - (s.vignette * 40)}%, rgba(0,0,0,${Math.min(0.9, s.vignette * 0.7)}) 100%)`
                        }}
                    />
                );
            })}

            <div style={{
                transform: `translate(${view.cx - (canvasSize.w * view.scale / 2)}px, ${view.cy - (canvasSize.h * view.scale / 2)}px)`,
                width: canvasSize.w * view.scale, height: canvasSize.h * view.scale,
                position: 'absolute', zIndex: 2, pointerEvents: 'none',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.1), 0 20px 50px rgba(0,0,0,0.5)',
                outline: !selectedClipId && !isPlaying && activeTool === 'transform' ? '1px dashed var(--accent-purple)' : 'none'
            }}>
                {!selectedClipId && !isPlaying && activeTool === 'transform' && (
                    <>
                        <div className="ve-crop-dims-badge canvas">
                            {Math.round(canvasSize.w)} × {Math.round(canvasSize.h)}
                        </div>
                        {['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'].map(p => (
                            <div key={p} onPointerDown={e => handlePointerDown(e, p)} style={{ position: 'absolute', width: 12, height: 12, background: 'white', border: '1px solid var(--accent-purple)', borderRadius: p.length === 2 ? '50%' : 2, cursor: p + '-resize', pointerEvents: 'auto', top: p.includes('n') ? -6 : p.includes('s') ? 'calc(100% - 6px)' : 'calc(50% - 6px)', left: p.includes('w') ? -6 : p.includes('e') ? 'calc(100% - 6px)' : 'calc(50% - 6px)', zIndex: 100, transform: (p.length === 1) ? 'scale(0.8)' : 'none' }} />
                        ))}
                    </>
                )}
            </div>

            {selectedClipObj &&
                selectedClipObj.type !== 'audio' &&
                !isAudioFile(selectedClipObj.path) &&
                (activeTool === 'transform' || (activeTool === 'crop' && localCrop)) && (
                    <div className={`ve-selected-frame ${activeTool === 'crop' ? 'crop-mode' : ''}`}
                        style={{
                            position: 'absolute',
                            left: (activeTool === 'crop'
                                ? view.cx + ((selectedClipObj.transform?.x || 0) - ((selectedClipObj.crop?.x || 0) + (selectedClipObj.crop?.w || 1) / 2 - 0.5) * selBW * (selectedClipObj.transform?.scaleX || 1)) * view.scale
                                : view.cx + (selectedClipObj.transform?.x || 0) * view.scale),
                            top: (activeTool === 'crop'
                                ? view.cy + ((selectedClipObj.transform?.y || 0) - ((selectedClipObj.crop?.y || 0) + (selectedClipObj.crop?.h || 1) / 2 - 0.5) * selBH * (selectedClipObj.transform?.scaleY || 1)) * view.scale
                                : view.cy + (selectedClipObj.transform?.y || 0) * view.scale),
                            width: (activeTool === 'crop' ? selBW * (selectedClipObj.transform?.scaleX || 1) : selBW * (selectedClipObj.transform?.scaleX || 1) * (selectedClipObj.crop?.w || 1)) * view.scale,
                            height: (activeTool === 'crop' ? selBH * (selectedClipObj.transform?.scaleY || 1) : selBH * (selectedClipObj.transform?.scaleY || 1) * (selectedClipObj.crop?.h || 1)) * view.scale,
                            transform: `translate(-50%, -50%) rotate(${selectedClipObj.transform?.rotation || 0}deg)`,
                            border: activeTool === 'crop' ? '1px solid rgba(255,255,255,0.2)' : '1px solid #3b82f6',
                            zIndex: 10,
                            pointerEvents: 'none'
                        }}
                    >
                        {activeTool === 'transform' && ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map(p => (
                            <div key={p} style={{ position: 'absolute', width: 10, height: 10, background: 'white', border: '1px solid #3b82f6', borderRadius: '2px', cursor: `${p}-resize`, left: p.includes('w') ? 0 : p.includes('e') ? '100%' : '50%', top: p.includes('n') ? 0 : p.includes('s') ? '100%' : '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'auto', zIndex: 20 }} onPointerDown={(e) => handlePointerDown(e, p, selectedClipObj.id)} />
                        ))}

                        {activeTool === 'transform' && (
                            <div className="ve-crop-dims-badge">
                                {Math.round(selBW * (selectedClipObj.transform?.scaleX || 1) * (selectedClipObj.crop?.w || 1))} × {Math.round(selBH * (selectedClipObj.transform?.scaleY || 1) * (selectedClipObj.crop?.h || 1))}
                            </div>
                        )}

                        {activeTool === 'crop' && localCrop && (
                            <div className="ve-crop-overlay-box" style={{
                                position: 'absolute',
                                left: `${localCrop.x * 100}%`,
                                top: `${localCrop.y * 100}%`,
                                width: `${localCrop.w * 100}%`,
                                height: `${localCrop.h * 100}%`,
                                border: '2px solid #fbbf24',
                                boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)',
                                pointerEvents: 'auto'
                            }}
                                onPointerDown={(e) => {
                                    if (e.target === e.currentTarget) {
                                        e.stopPropagation();
                                        const target = e.currentTarget as HTMLElement;
                                        target.setPointerCapture(e.pointerId);
                                        actionRef.current = {
                                            ...actionRef.current,
                                            type: 'crop',
                                            handle: null,
                                            startX: e.clientX,
                                            startY: e.clientY,
                                            startCrop: localCrop || selectedClipObj?.crop || { x: 0, y: 0, w: 1, h: 1 }
                                        };
                                    }
                                }}
                            >
                                <div className="ve-crop-grid-h" />
                                <div className="ve-crop-grid-v" />

                                <div className="ve-crop-dims-badge crop">
                                    {Math.round(localCrop.w * selBW)} × {Math.round(localCrop.h * selBH)}
                                </div>

                                {['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map(p => (
                                    <div
                                        key={p}
                                        className={`ve-crop-handle ${p}`}
                                        style={{
                                            position: 'absolute',
                                            left: p.includes('w') ? '0%' : (p.includes('e') ? '100%' : '50%'),
                                            top: p.includes('n') ? '0%' : (p.includes('s') ? '100%' : '50%'),
                                            width: (p === 'n' || p === 's') ? '40%' : 8,
                                            height: (p === 'e' || p === 'w') ? '40%' : 8,
                                            backgroundColor: '#fbbf24',
                                            transform: 'translate(-50%, -50%)',
                                            borderRadius: p.length === 2 ? '2px' : '4px',
                                            cursor: `${p}-resize`,
                                            pointerEvents: 'auto'
                                        }}
                                        onPointerDown={(e) => handlePointerDown(e, p as any, selectedClipObj.id)}
                                    />
                                ))}

                                <div className="ve-crop-actions">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setLocalCrop(null);
                                            setActiveTool('select');
                                        }}
                                        className="ve-crop-btn cancel"
                                        style={{ backgroundColor: '#ef4444' }}
                                    >
                                        <X size={16} />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (selectedClipObj && localCrop) {
                                                const oldCrop = selectedClipObj.crop || { x: 0, y: 0, w: 1, h: 1 };
                                                const newCrop = localCrop;
                                                const dx = (newCrop.x + newCrop.w / 2 - (oldCrop.x + oldCrop.w / 2)) * selBW * (selectedClipObj.transform?.scaleX || 1);
                                                const dy = (newCrop.y + newCrop.h / 2 - (oldCrop.y + oldCrop.h / 2)) * selBH * (selectedClipObj.transform?.scaleY || 1);
                                                setTracks(prev => prev.map(track => ({
                                                    ...track,
                                                    clips: track.clips.map(clip => clip.id === selectedClipObj.id ? {
                                                        ...clip,
                                                        crop: newCrop,
                                                        transform: {
                                                            ...clip.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1 },
                                                            x: (clip.transform?.x || 0) + dx,
                                                            y: (clip.transform?.y || 0) + dy
                                                        }
                                                    } : clip)
                                                })));
                                                onTransformCommit(t('editor.apply_crop') || 'Crop');
                                                setLocalCrop(null);
                                                setActiveTool('select');
                                            }
                                        }}
                                        className="ve-crop-btn confirm"
                                        style={{ backgroundColor: '#22c55e' }}
                                    >
                                        <Check size={16} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}



            <div ref={containerRef} className="ve-preview-video">
                {[...activeClips, ...(selectedClipObj && !activeClips.some(c => c.id === selectedClipObj.id) ? [selectedClipObj] : [])]
                    .filter(c => c.type !== 'text')
                    .map((clip: Clip) => (
                        isImageFile(clip.path || '') ? (
                            <img
                                key={clip.id}
                                data-clip-id={clip.id}
                                src={getMediaUrl(clip.path, clip.mtime)}
                                crossOrigin="anonymous"
                                style={{ display: 'none' }}
                                onLoad={(e) => {
                                    const img = e.currentTarget;
                                    if (img.naturalWidth && img.naturalHeight && (clip.width !== img.naturalWidth || clip.height !== img.naturalHeight)) {
                                        setTracks((prev: Track[]) => prev.map((tr: Track) => ({
                                            ...tr,
                                            clips: tr.clips.map((c: Clip) => c.id === clip.id ? { ...c, width: img.naturalWidth, height: img.naturalHeight } : c)
                                        })));
                                    }
                                }}
                            />
                        ) : (
                            <video
                                key={clip.id}
                                data-clip-id={clip.id}
                                src={getMediaUrl(clip.path, clip.mtime)}
                                preload="auto" playsInline={true} crossOrigin="anonymous" style={{ display: 'none' }}
                                onWaiting={() => {
                                    if (isPlaying) setIsBuffering(true);
                                }}
                                onPlaying={() => setIsBuffering(false)}
                                onCanPlay={() => setIsBuffering(false)}
                                onLoadStart={() => {
                                    // Sadece gerçekten beklediğimizde (onWaiting) tetiklensin, 
                                    // her play tuşunda anlık yanıp sönmeyi engellemek için burayı boş bırakıyoruz.
                                }}
                                onLoadedMetadata={(e) => {
                                    const v = e.currentTarget;
                                    if (v.videoWidth && v.videoHeight && (clip.width !== v.videoWidth || clip.height !== v.videoHeight)) {
                                        setTracks((prev: Track[]) => prev.map((tr: Track) => ({
                                            ...tr,
                                            clips: tr.clips.map((c: Clip) => c.id === clip.id ? { ...c, width: v.videoWidth, height: v.videoHeight } : c)
                                        })));
                                    }

                                    // IMMEDIATE SEEK to clip's current time to prevent first frame flash
                                    const speed = clip.speed || 1;
                                    const clipLocalTime = (currentTime - clip.timelineStart) * speed + clip.sourceStart;
                                    if (clipLocalTime >= 0) {
                                        v.currentTime = Math.max(0, Math.min(clipLocalTime, v.duration - 0.001));
                                    }

                                    setIsBuffering(false);
                                }}
                            />
                        )
                    ))}
            </div>

            {/* Loading Indicator - Centered on Canvas Area */}
            <AnimatePresence>
                {showLoader && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        style={{
                            position: 'absolute',
                            left: view.cx - (canvasSize.w * view.scale / 2),
                            top: view.cy - (canvasSize.h * view.scale / 2),
                            width: canvasSize.w * view.scale,
                            height: canvasSize.h * view.scale,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(0,0,0,0.5)',
                            backdropFilter: 'blur(4px)',
                            zIndex: 100,
                            borderRadius: 4,
                            pointerEvents: 'none'
                        }}
                    >
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', scale: Math.min(1, view.scale * 1.5) }}>
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                style={{
                                    width: 48,
                                    height: 48,
                                    borderRadius: '50%',
                                    border: '2px solid transparent',
                                    borderTopColor: 'var(--accent-purple)',
                                    filter: 'drop-shadow(0 0 8px var(--accent-purple))'
                                }}
                            />
                            <Loader2
                                size={20}
                                className="text-white animate-spin"
                                style={{ position: 'absolute' }}
                            />
                        </div>
                        <motion.span
                            initial={{ y: 5, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            style={{
                                marginTop: 12,
                                color: 'white',
                                fontSize: `${0.8 * Math.max(0.7, view.scale)}rem`,
                                fontWeight: 500,
                                textShadow: '0 2px 4px rgba(0,0,0,0.5)',
                                letterSpacing: '0.05em'
                            }}
                        >
                            {t('player.streaming')}
                        </motion.span>
                    </motion.div>
                )}
            </AnimatePresence>

        </div>
    );
};

export default Preview;
