import { convertFileSrc } from '@tauri-apps/api/core';

interface WaveformData {
    maxPeaks: Float32Array;
    minPeaks: Float32Array;
    duration: number;
}

class WaveformGenerator {
    private audioCtx: AudioContext | null = null;
    private dataCache: Map<string, WaveformData> = new Map();
    private imageCache: Map<string, string> = new Map();
    private pendingDataRequests: Map<string, Promise<WaveformData | null>> = new Map();

    constructor() {
        if (typeof window !== 'undefined') {
            this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
    }

    async getWaveformData(path: string, mtime?: number): Promise<WaveformData | null> {
        const cacheKey = mtime ? `${path}-${mtime}` : path;
        if (this.dataCache.has(cacheKey)) return this.dataCache.get(cacheKey)!;
        if (this.pendingDataRequests.has(cacheKey)) return this.pendingDataRequests.get(cacheKey)!;

        const request = (async () => {
            try {
                const url = convertFileSrc(path) + (mtime ? `?t=${mtime}` : '');
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.audioCtx!.decodeAudioData(arrayBuffer);

                const rawData = audioBuffer.getChannelData(0);
                // Higher sample rate for smoother zoom
                const samplesPerSec = 200;
                const totalSamples = Math.ceil(audioBuffer.duration * samplesPerSec);
                const blockSize = Math.floor(rawData.length / totalSamples);

                const maxPeaks = new Float32Array(totalSamples);
                const minPeaks = new Float32Array(totalSamples);

                for (let i = 0; i < totalSamples; i++) {
                    let start = i * blockSize;
                    let max = 0;
                    let min = 0;
                    for (let j = 0; j < blockSize; j++) {
                        const val = rawData[start + j];
                        if (val > max) max = val;
                        if (val < min) min = val;
                    }
                    maxPeaks[i] = max;
                    minPeaks[i] = min;
                }

                const data = { maxPeaks, minPeaks, duration: audioBuffer.duration };
                this.dataCache.set(cacheKey, data);
                return data;
            } catch (err) {
                return null;
            } finally {
                this.pendingDataRequests.delete(cacheKey);
            }
        })();

        this.pendingDataRequests.set(cacheKey, request);
        return request;
    }

    async getWaveformImage(path: string, startTime: number, duration: number, width: number, mtime?: number): Promise<string | null> {
        // Round width to avoid too many cache entries for tiny scroll changes
        const roundedWidth = Math.ceil(width);
        const cacheKey = `${path}-${startTime.toFixed(2)}-${duration.toFixed(2)}-${roundedWidth}${mtime ? `-${mtime}` : ''}`;

        if (this.imageCache.has(cacheKey)) return this.imageCache.get(cacheKey)!;

        const data = await this.getWaveformData(path, mtime);
        if (!data) return null;

        const canvas = document.createElement('canvas');
        canvas.width = roundedWidth;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const { maxPeaks, minPeaks, duration: fileDuration } = data;
        const samplesPerSec = maxPeaks.length / fileDuration;

        const startSample = Math.floor(startTime * samplesPerSec);
        const endSample = Math.floor((startTime + duration) * samplesPerSec);

        const segmentMax = maxPeaks.slice(startSample, endSample);
        const segmentMin = minPeaks.slice(startSample, endSample);

        ctx.beginPath();
        // Use a solid, high-contrast color for the "hassas" look
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1;

        const step = segmentMax.length / roundedWidth;
        const centerY = canvas.height / 2;
        const amp = canvas.height / 2 * 0.9;

        for (let i = 0; i < roundedWidth; i++) {
            const idx = Math.floor(i * step);
            const max = segmentMax[idx] || 0;
            const min = segmentMin[idx] || 0;

            ctx.moveTo(i, centerY + (min * amp));
            ctx.lineTo(i, centerY + (max * amp));
        }
        ctx.stroke();

        const url = canvas.toDataURL();
        this.imageCache.set(cacheKey, url);
        return url;
    }
}

export const waveformGenerator = new WaveformGenerator();
