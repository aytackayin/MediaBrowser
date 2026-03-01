import { convertFileSrc } from '@tauri-apps/api/core';

interface ThumbnailCache {
    [key: string]: string;
}

class ThumbnailGenerator {
    private video: HTMLVideoElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private cache: ThumbnailCache = {};
    private currentPath: string | null = null;
    private isReady: boolean = false;
    private queue: Array<() => Promise<void>> = [];
    private isProcessing: boolean = false;
    private preparingPromise: Promise<void> | null = null;

    constructor() {
        if (typeof document !== 'undefined') {
            this.video = document.createElement('video');
            this.video.muted = true;
            this.video.playsInline = true;
            this.video.preload = 'auto';
            this.video.crossOrigin = 'anonymous';
            this.canvas = document.createElement('canvas');
        }
    }

    async prepare(path: string, mtime?: number): Promise<void> {
        if (!this.video) return;
        const cacheSuffix = mtime ? `-${mtime}` : '';
        if (this.currentPath === path + cacheSuffix && this.isReady) return;
        if (this.currentPath === path + cacheSuffix && this.preparingPromise) return this.preparingPromise;

        this.isReady = false;
        this.currentPath = path + cacheSuffix;

        this.preparingPromise = new Promise<void>((resolve) => {
            const cleanup = () => {
                this.video?.removeEventListener('loadedmetadata', onReady);
                this.video?.removeEventListener('canplay', onReady);
                this.video!.onerror = null;
            };

            const onReady = () => {
                this.isReady = true;
                this.preparingPromise = null;
                cleanup();
                resolve();
            };

            this.video!.onerror = () => {
                this.isReady = false;
                this.preparingPromise = null;
                cleanup();
                resolve();
            };

            this.video!.addEventListener('loadedmetadata', onReady);
            this.video!.addEventListener('canplay', onReady);

            this.video!.src = convertFileSrc(path) + (mtime ? `?t=${mtime}` : '');
            this.video!.load();
        });

        return this.preparingPromise;
    }

    async getThumbnail(path: string, time: number, mtime?: number): Promise<string | null> {
        const roundedTime = Math.round(time * 20) / 20; // 0.05s precision
        const cacheKey = `${path}-${roundedTime.toFixed(2)}${mtime ? `-${mtime}` : ''}`;

        if (this.cache[cacheKey]) {
            return this.cache[cacheKey];
        }

        return new Promise((resolve) => {
            this.queue.push(async () => {
                if (!this.video || !this.canvas) {
                    resolve(null);
                    return;
                }

                try {
                    const cacheSuffix = mtime ? `-${mtime}` : '';
                    if (this.currentPath !== path + cacheSuffix) {
                        await this.prepare(path, mtime);
                    }

                    if (!this.isReady || this.video.readyState < 1) {
                        await this.prepare(path, mtime);
                        // Double check after prepare
                        if (!this.isReady && this.video.readyState < 1) {
                            await new Promise(r => setTimeout(r, 200));
                        }
                    }

                    this.video.currentTime = roundedTime;

                    await new Promise<void>((r) => {
                        const onSeeked = () => {
                            this.video?.removeEventListener('seeked', onSeeked);
                            r();
                        };
                        this.video?.addEventListener('seeked', onSeeked);
                        // Timeout if seeked doesn't fire
                        setTimeout(onSeeked, 1000);
                    });

                    const ctx = this.canvas.getContext('2d', { alpha: false });
                    const videoWidth = this.video.videoWidth || 160;
                    const videoHeight = this.video.videoHeight || 90;
                    const ratio = videoWidth / videoHeight;

                    const targetHeight = 100;
                    const targetWidth = targetHeight * ratio;

                    this.canvas.width = targetWidth;
                    this.canvas.height = targetHeight;

                    if (ctx) {
                        ctx.drawImage(this.video, 0, 0, targetWidth, targetHeight);
                        const url = this.canvas.toDataURL('image/jpeg', 0.8);
                        this.cache[cacheKey] = url;
                        resolve(url);
                    } else {
                        resolve(null);
                    }
                } catch (err) {
                    resolve(null);
                }
            });

            this.processQueue();
        });
    }

    private async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            if (task) {
                await task();
            }
        }

        this.isProcessing = false;
    }

    clearCache() {
        this.cache = {};
    }

    dispose() {
        this.clearCache();
        if (this.video) {
            this.video.removeAttribute('src');
            this.video.load();
            this.video = null;
        }
        this.canvas = null;
    }
}

export const thumbnailGenerator = new ThumbnailGenerator();
