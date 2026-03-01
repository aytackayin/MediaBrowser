use std::fs;
use std::path::Path;
use serde::{Serialize, Deserialize};
use sqlx::FromRow;

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct MediaFile {
    pub path: String,
    pub filename: String,
    pub file_type: String, // "image", "video", "audio", "folder"
    pub size: i64, 
    pub mtime: i64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration: Option<f64>,
    pub notes: Option<String>,
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub bitrate: Option<i64>,
    pub sample_rate: Option<i32>,
}



pub fn scan_directory(path: &str) -> Vec<MediaFile> {
    let mut media_files = Vec::new();
    let root = Path::new(path);

    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path_buf = entry.path();
            let filename = path_buf.file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_owned();

            // Ignore hidden files and system/internal folders
            let filename_upper = filename.to_uppercase();
            if filename.starts_with('.') || filename == ".mb_temp"
                || filename_upper == "$RECYCLE.BIN" || filename_upper == "SYSTEM VOLUME INFORMATION"
                || filename_upper == "PROGRAM FILES" || filename_upper == "PROGRAM FILES (X86)"
            {
                continue;
            }

            if path_buf.is_file() {
                if let Some(ext) = path_buf.extension().and_then(|s| s.to_str()) {
                    let ext_lower = ext.to_lowercase();
                    let file_type = match ext_lower.as_str() {
                        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "tiff" => Some("image"),
                        "mp4" | "mkv" | "mov" | "avi" | "webm" | "mpg" | "mpeg" | "3gp" | "dat" => Some("video"),
                        "mp3" | "wav" | "flac" | "aac" | "ogg" => Some("audio"),
                        _ => None,
                    };

                    if let Some(ftype) = file_type {
                        if let Ok(metadata) = entry.metadata() {
                            media_files.push(MediaFile {
                                path: path_buf.to_string_lossy().into_owned(),
                                filename,
                                file_type: ftype.to_owned(),
                                size: metadata.len() as i64,
                                mtime: metadata.modified()
                                    .ok()
                                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_secs() as i64)
                                    .unwrap_or(0),
                                width: None, 
                                height: None,
                                duration: None,
                                notes: None,
                                fps: None,
                                video_codec: None,
                                audio_codec: None,
                                bitrate: None,
                                sample_rate: None,
                            });
                        }
                    }
                }
            } else if path_buf.is_dir() {
                if let Ok(metadata) = entry.metadata() {
                    media_files.push(MediaFile {
                        path: path_buf.to_string_lossy().into_owned(),
                        filename,
                        file_type: "folder".to_owned(),
                        size: 0,
                        mtime: metadata.modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0),
                        width: None,
                        height: None,
                        duration: None,
                        notes: None,
                        fps: None,
                        video_codec: None,
                        audio_codec: None,
                        bitrate: None,
                        sample_rate: None,
                    });
                }
            }
        }
    }
    media_files
}

pub fn scan_directory_recursive(path: &str, query: &str) -> Vec<MediaFile> {
    let mut results = Vec::new();
    let query_lower = query.to_lowercase();

    let walker = walkdir::WalkDir::new(path).follow_links(true).into_iter().filter_entry(|e| {
        let filename = e.file_name().to_string_lossy();
        let filename_upper = filename.to_uppercase();
        !filename.starts_with('.') && filename != ".mb_temp"
            && filename_upper != "$RECYCLE.BIN" && filename_upper != "SYSTEM VOLUME INFORMATION"
            && filename_upper != "PROGRAM FILES" && filename_upper != "PROGRAM FILES (X86)"
    });

    for entry in walker.filter_map(|e| e.ok()) {
        let path_buf = entry.path();
        let filename = entry.file_name().to_string_lossy().to_string();

        if entry.file_type().is_dir() {
            let is_match = filename.to_lowercase().contains(&query_lower);
            if is_match {
                if let Ok(metadata) = entry.metadata() {
                    results.push(MediaFile {
                        path: path_buf.to_string_lossy().into_owned(),
                        filename: filename.clone(),
                        file_type: "folder".to_owned(),
                        size: 0,
                        mtime: metadata.modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0),
                        width: None,
                        height: None,
                        duration: None,
                        notes: None,
                        fps: None,
                        video_codec: None,
                        audio_codec: None,
                        bitrate: None,
                        sample_rate: None,
                    });
                }
            }
        } else if entry.file_type().is_file() {
            if filename.to_lowercase().contains(&query_lower) {
                if let Some(ext) = path_buf.extension().and_then(|s| s.to_str()) {
                    let ext_lower = ext.to_lowercase();
                    let file_type = match ext_lower.as_str() {
                        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "tiff" => Some("image"),
                        "mp4" | "mkv" | "mov" | "avi" | "webm" | "mpg" | "mpeg" | "3gp" | "dat" => Some("video"),
                        "mp3" | "wav" | "flac" | "aac" | "ogg" => Some("audio"),
                        _ => None,
                    };

                    if let Some(ftype) = file_type {
                        if let Ok(metadata) = entry.metadata() {
                            results.push(MediaFile {
                                path: path_buf.to_string_lossy().into_owned(),
                                filename,
                                file_type: ftype.to_owned(),
                                size: metadata.len() as i64,
                                mtime: metadata.modified()
                                    .ok()
                                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_secs() as i64)
                                    .unwrap_or(0),
                                width: None,
                                height: None,
                                duration: None,
                                notes: None,
                                fps: None,
                                video_codec: None,
                                audio_codec: None,
                                bitrate: None,
                                sample_rate: None,
                            });
                        }
                    }
                }
            }
        }
    }
    results
}
