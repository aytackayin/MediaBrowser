mod media_manager;
mod thumbnail_manager;
mod db;

use media_manager::{MediaFile, scan_directory, scan_directory_recursive};
use thumbnail_manager::{get_thumbnail_path, generate_image_thumbnail, generate_video_thumbnail};
use tauri::Manager;
use db::{DbState, init_db, get_local_db_pool};
use std::path::Path;
use serde::Serialize;
use std::cmp::Ordering;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tiny_http::{Server, Response, Header};
use urlencoding;
use base64::{Engine as _, engine::general_purpose};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize)]
pub struct TransferResult {
    pub success_count: usize,
    pub skip_count: usize,
}

#[derive(Serialize)]
pub struct PagedResult {
    pub items: Vec<MediaFile>,
    pub total: usize,
    pub count_image: usize,
    pub count_video: usize,
    pub count_audio: usize,
}

fn get_turkish_sort_key(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for c in s.chars() {
        match c {
            'ç' | 'Ç' => { out.push('c'); out.push('\u{1F780}'); }
            'ğ' | 'Ğ' => { out.push('g'); out.push('\u{1F780}'); }
            'ı' | 'I' => { out.push('i'); }
            'i' | 'İ' => { out.push('i'); out.push('\u{1F780}'); }
            'ö' | 'Ö' => { out.push('o'); out.push('\u{1F780}'); }
            'ş' | 'Ş' => { out.push('s'); out.push('\u{1F780}'); }
            'ü' | 'Ü' => { out.push('u'); out.push('\u{1F780}'); }
            other => {
                for lc in other.to_lowercase() {
                    out.push(lc);
                }
            }
        }
    }
    out
}

#[tauri::command]
async fn scan_folder(
    path: String, 
    gallery_root: Option<String>,
    page: usize,
    page_size: usize,
    sort_by: Option<String>,
    sort_direction: Option<String>,
    search_query: Option<String>,
    filter_type: Option<String>
) -> Result<PagedResult, String> {
    // 1. Get files (Recursive if searching, otherwise current dir)
    let mut all_files = if let Some(ref query) = search_query {
        if !query.is_empty() {
            let mut fs_results = scan_directory_recursive(&path, query);
            
            // Add DB matches for notes
            if let Some(ref root_path) = gallery_root {
                if let Ok(pool) = get_local_db_pool(Path::new(root_path)).await {
                    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
                    let q_lower = query.to_lowercase();
                    let like_pattern = format!("%{}%", q_lower);
                    // GLOB uses * as wildcard and doesn't treat \ as escape in the same way LIKE does
                    let p_glob = format!("{}*", path);
                    
                    let db_hits: Vec<MediaFile> = sqlx::query_as(
                        "SELECT * FROM media_files WHERE path GLOB ? AND LOWER(notes) LIKE ?"
                    )
                    .bind(&p_glob)
                    .bind(&like_pattern)
                    .fetch_all(&mut *conn)
                    .await
                    .unwrap_or_default();

                    // Merge avoiding duplicates with fs_results
                    let fs_paths: std::collections::HashSet<String> = fs_results.iter().map(|f| f.path.clone()).collect();
                    for hit in db_hits {
                        if !fs_paths.contains(&hit.path) {
                            if Path::new(&hit.path).exists() {
                                fs_results.push(hit);
                            }
                        }
                    }
                }
            }
            fs_results
        } else {
            scan_directory(&path)
        }
    } else {
        scan_directory(&path)
    };

    // 2. Filter by type if provided (Folders are always included)
    if let Some(ref f_type) = filter_type {
        if f_type != "all" {
            all_files.retain(|f| f.file_type == "folder" || f.file_type == *f_type);
        }
    }

    // 3. Sort files - FOLDERS ALWAYS FIRST (Schwartzian transform to avoid O(N log N) sort key allocations)
    let mut sortable_files: Vec<(String, MediaFile)> = all_files.into_iter()
        .map(|f| (get_turkish_sort_key(&f.filename), f))
        .collect();

    if let (Some(by), Some(direction)) = (sort_by, sort_direction) {
        let is_asc = direction == "asc";
        sortable_files.sort_by(|(key_a, a), (key_b, b)| {
            // Priority 1: Folder vs File - Folders always come first
            let a_is_folder = a.file_type == "folder";
            let b_is_folder = b.file_type == "folder";
            
            if a_is_folder && !b_is_folder {
                return Ordering::Less;
            }
            if !a_is_folder && b_is_folder {
                return Ordering::Greater;
            }
            
            // Priority 2: Primary sort criteria
            let primary_ord = match by.as_str() {
                "name" => natord::compare(key_a, key_b),
                "size" => a.size.cmp(&b.size),
                "date" => a.mtime.cmp(&b.mtime),
                "type" => a.file_type.cmp(&b.file_type),
                _ => Ordering::Equal,
            };

            // Priority 3: Secondary sort (always name) to handle ties or type sorting correctly
            let final_ord = if primary_ord == Ordering::Equal {
                natord::compare(key_a, key_b)
            } else if by == "type" {
                primary_ord
            } else {
                primary_ord
            };

            if is_asc { final_ord } else { final_ord.reverse() }
        });
    } else {
        // Default Sort: Folders First, then by Name ASC
        sortable_files.sort_by(|(key_a, a), (key_b, b)| {
            let a_is_folder = a.file_type == "folder";
            let b_is_folder = b.file_type == "folder";
            if a_is_folder && !b_is_folder { return Ordering::Less; }
            if !a_is_folder && b_is_folder { return Ordering::Greater; }
            natord::compare(key_a, key_b)
        });
    }

    let all_files: Vec<MediaFile> = sortable_files.into_iter().map(|(_, f)| f).collect();

    let total = all_files.len();
    
    // Calculate media counts manually
    let mut c_img = 0;
    let mut c_vid = 0;
    let mut c_aud = 0;
    
    for f in &all_files {
        match f.file_type.as_str() {
            "image" => c_img += 1,
            "video" => c_vid += 1,
            "audio" => c_aud += 1,
            _ => {}
        }
    }

    // 4. Pagination bounds
    let start = (page - 1) * page_size;
    let end = std::cmp::min(start + page_size, total);
    
    if start >= total {
        return Ok(PagedResult { 
            items: vec![], 
            total,
            count_image: c_img,
            count_video: c_vid,
            count_audio: c_aud
        });
    }

    let mut page_items = all_files[start..end].to_vec();

    // 5. Batch Sync Notes/Existing Metadata from DB
    if let Some(ref root_path) = gallery_root {
        if let Ok(pool) = get_local_db_pool(Path::new(root_path)).await {
            if let Ok(mut conn) = pool.acquire().await {
                // Get all records for this folder in one query
                let p_glob = format!("{}*", path);
                let db_items: Vec<MediaFile> = sqlx::query_as("SELECT * FROM media_files WHERE path GLOB ?")
                    .bind(&p_glob)
                    .fetch_all(&mut *conn)
                    .await
                    .unwrap_or_default();
                
                let mut db_map = std::collections::HashMap::with_capacity(db_items.len());
                let mut db_paths_to_cleanup = Vec::new();
                
                // Create a quick lookup for FS files
                let fs_paths: std::collections::HashSet<String> = all_files.iter().map(|f| f.path.clone()).collect();

                // Match DB records with FS items
                for item in db_items {
                    if fs_paths.contains(&item.path) {
                        db_map.insert(item.path.clone(), item);
                    } else if search_query.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
                        // Auto-Cleanup: ONLY if not searching (full folder view)
                        // ONLY mark for deletion if it's a DIRECT child of the current folder
                        // and NOT the current folder itself.
                        let item_p = Path::new(&item.path);
                        if let Some(parent) = item_p.parent() {
                            let parent_str = parent.to_string_lossy().to_string();
                            // Case-insensitive comparison for Windows safety
                            if parent_str.to_lowercase() == path.to_lowercase() && item.path.to_lowercase() != path.to_lowercase() {
                                db_paths_to_cleanup.push(item.path.clone());
                            }
                        }
                    }
                }

                // Clean up obsolete records from DB and thumbs (Recursive for folders)
                if !db_paths_to_cleanup.is_empty() {
                    let r_ptr = root_path.clone();
                    
                    for p in db_paths_to_cleanup {
                        // 1. Recursive delete from DB for this path AND all its sub-contents
                        // Use GLOB with wildcard for windows path safety
                        let sub_pattern = format!("{}*", p);
                        let _ = sqlx::query("DELETE FROM media_files WHERE path GLOB ?")
                            .bind(&sub_pattern)
                            .execute(&mut *conn)
                            .await;
                        
                        // 2. Remove thumbnail for the file itself
                        let t_path = get_thumbnail_path(Path::new(&r_ptr), &p);
                        if t_path.exists() {
                            let _ = std::fs::remove_file(t_path);
                        }
                        
                        // Note: Cleaning sub-thumbnails one by one could be heavy. 
                        // Those will be cleaned when their parent is actually scanned if somehow missed.
                    }
                }

                // Merge DB info into page items
                for item in page_items.iter_mut() {
                    if let Some(db_f) = db_map.get(&item.path) {
                        // Keep the DB notes and existing metadata if mtime matches
                        if db_f.mtime == item.mtime {
                            item.notes = db_f.notes.clone();
                            item.width = db_f.width;
                            item.height = db_f.height;
                            item.duration = db_f.duration;
                            item.fps = db_f.fps;
                            item.video_codec = db_f.video_codec.clone();
                            item.audio_codec = db_f.audio_codec.clone();
                            item.bitrate = db_f.bitrate;
                            item.sample_rate = db_f.sample_rate;
                        } else {
                            // If file changed, at least keep notes but reset metadata to be re-scanned later
                            item.notes = db_f.notes.clone();
                        }
                    }
                }
            }
        }
    }

    // 6. Prefetch Thumbnails for Current Page
    if let Some(ref root_path) = gallery_root {
        let root_str = root_path.clone();
        let items_to_thumb = page_items.clone();
        tokio::spawn(async move {
            for file in items_to_thumb {
                if file.file_type != "folder" {
                    // This will actually generate thumbnail if missing
                    let tp = get_thumbnail_path(Path::new(&root_str), &file.path);
                    if !tp.exists() {
                         let _ = generate_thumbnail_internal(&file.path, &tp);
                    }
                }
            }
        });
    }

    Ok(PagedResult {
        items: page_items,
        total,
        count_image: c_img,
        count_video: c_vid,
        count_audio: c_aud
    })
}

#[tauri::command]
async fn get_file_details(path: String, gallery_root: String) -> Result<MediaFile, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let mut f = MediaFile {
        path: path.clone(),
        filename: Path::new(&path).file_name().unwrap_or_default().to_string_lossy().into_owned(),
        file_type: "unknown".to_string(), // Will detect below
        size: meta.len() as i64,
        mtime: meta.modified().unwrap().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64,
        width: None, height: None, duration: None, notes: None,
        fps: None, video_codec: None, audio_codec: None, bitrate: None, sample_rate: None
    };

    // Detect type by extension
    let p_path = Path::new(&path);
    if p_path.is_dir() {
        f.file_type = "folder".to_string();
    } else {
        let ext = p_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        f.file_type = match ext.as_str() {
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" => "image".to_string(),
            "mp4" | "mkv" | "avi" | "mov" | "webm" | "mpg" | "mpeg" | "3gp" | "dat" => "video".to_string(),
            "mp3" | "wav" | "ogg" | "flac" | "m4a" => "audio".to_string(),
            _ => "unknown".to_string()
        };
    }

    // DB Fetch
    let pool = get_local_db_pool(Path::new(&gallery_root)).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    
    let db_f: Option<MediaFile> = sqlx::query_as("SELECT * FROM media_files WHERE path = ?")
        .bind(&path)
        .fetch_optional(&mut *conn)
        .await
        .unwrap_or(None);

    if let Some(existing) = db_f {
        f.notes = existing.notes.clone();
        // If mtime matches, we might return and not run ffprobe
        if existing.mtime == f.mtime && existing.fps.is_some() {
            return Ok(existing);
        }
    }

    // Heavy Metadata Extraction
    if f.file_type == "image" {
        if let Ok(dims) = image::image_dimensions(&path) {
            f.width = Some(dims.0);
            f.height = Some(dims.1);
        }
    } else if f.file_type == "video" || f.file_type == "audio" {
        if let Some(meta) = probe_video_metadata_internal(&path) {
            f.width = meta.0;
            f.height = meta.1;
            f.duration = meta.2;
            f.video_codec = meta.3;
            f.audio_codec = meta.4;
            f.sample_rate = meta.5;
            f.bitrate = meta.6;
            f.fps = meta.7;
        }
    }

    // Update DB so next time it's fast
    let _ = sqlx::query(
        "INSERT INTO media_files (path, filename, file_type, size, mtime, width, height, duration, fps, video_codec, audio_codec, bitrate, sample_rate) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET 
            mtime = excluded.mtime, size = excluded.size, 
            width = excluded.width, height = excluded.height, 
            duration = excluded.duration, fps = excluded.fps,
            video_codec = excluded.video_codec, audio_codec = excluded.audio_codec,
            bitrate = excluded.bitrate, sample_rate = excluded.sample_rate"
    )
    .bind(&f.path).bind(&f.filename).bind(&f.file_type).bind(f.size)
    .bind(f.mtime).bind(f.width).bind(f.height).bind(f.duration)
    .bind(f.fps).bind(&f.video_codec).bind(&f.audio_codec).bind(f.bitrate).bind(f.sample_rate)
    .execute(&mut *conn).await;

    Ok(f)
}

#[tauri::command]
async fn get_thumbnail(original_path: String, gallery_root: String) -> Result<String, String> {
    let root = Path::new(&gallery_root);
    let thumb_path = get_thumbnail_path(root, &original_path);
    
    if !thumb_path.exists() {
        generate_thumbnail_internal(&original_path, &thumb_path)?;
    }
    
    // Tiny sanity check: if file is 0 bytes, it's a failed generation, delete and error so frontend can retry
    if let Ok(meta) = std::fs::metadata(&thumb_path) {
        if meta.len() == 0 {
            let _ = std::fs::remove_file(&thumb_path);
            return Err("Generated thumbnail is empty".to_string());
        }
    }

    Ok(thumb_path.to_string_lossy().into_owned())
}

// Helper to centralize generation logic
fn generate_thumbnail_internal(original_path: &str, thumb_path: &Path) -> Result<(), String> {
    let original_lower = original_path.to_lowercase();
    if original_lower.ends_with(".jpg") || original_lower.ends_with(".jpeg") || original_lower.ends_with(".png") || original_lower.ends_with(".webp") || original_lower.ends_with(".bmp") {
         generate_image_thumbnail(original_path, thumb_path)?;
    } else if original_lower.ends_with(".mp4") || original_lower.ends_with(".mkv") || original_lower.ends_with(".mov") || original_lower.ends_with(".webm") || original_lower.ends_with(".avi") || original_lower.ends_with(".mpg") || original_lower.ends_with(".mpeg") || original_lower.ends_with(".3gp") || original_lower.ends_with(".dat") {
         generate_video_thumbnail(original_path, thumb_path)?;
    }
    Ok(())
}

#[tauri::command]
async fn get_subtitle(video_path: String) -> Result<Option<Vec<u8>>, String> {
    let path = Path::new(&video_path);
    let parent = path.parent().ok_or("Invalid path")?;
    let stem = path.file_stem().ok_or("Invalid filename")?;
    
    // Try .srt
    let mut srt_path = parent.join(stem);
    srt_path.set_extension("srt");
    if srt_path.exists() {
        return Ok(Some(std::fs::read(srt_path).map_err(|e| e.to_string())?));
    }
    
    // Try .SRT
    let mut srt_path = parent.join(stem);
    srt_path.set_extension("SRT");
    if srt_path.exists() {
        return Ok(Some(std::fs::read(srt_path).map_err(|e| e.to_string())?));
    }

    Ok(None)
}

#[tauri::command]
async fn add_subtitle_file(video_path: String, srt_source_path: String) -> Result<(), String> {
    let video_p = Path::new(&video_path);
    let srt_source_p = Path::new(&srt_source_path);
    
    if !video_p.exists() { return Err("Video file not found".to_string()); }
    if !srt_source_p.exists() { return Err("Source SRT not found".to_string()); }

    let parent = video_p.parent().ok_or("Invalid video path")?;
    let stem = video_p.file_stem().ok_or("Invalid video filename")?;
    
    let mut target_srt = parent.join(stem);
    target_srt.set_extension("srt");
    
    std::fs::copy(srt_source_p, target_srt).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn save_note(path: String, gallery_root: String, note: String) -> Result<(), String> {
    let pool = get_local_db_pool(Path::new(&gallery_root)).await?;
    
    // Use INSERT OR REPLACE or ON CONFLICT for upsert logic
    // We need to provide basic fields if we insert
    let filename = Path::new(&path).file_name().unwrap_or_default().to_string_lossy().into_owned();
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let size = meta.len() as i64;
    let mtime = meta.modified().unwrap().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let file_type = if Path::new(&path).is_dir() { "folder" } else { "file" }; // Simplified for upsert

    sqlx::query(
        "INSERT INTO media_files (path, filename, file_type, size, mtime, notes) 
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET notes = excluded.notes"
    )
    .bind(path)
    .bind(filename)
    .bind(file_type)
    .bind(size)
    .bind(mtime)
    .bind(note)
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

use serde::Deserialize;
use tauri::Emitter;

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
pub struct VisualSettings {
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub exposure: f64,
    pub temp: f64,
    pub tint: f64,
    pub vignette: f64,
    pub gamma: f64,
    pub vibrance: f64,
    pub clarity: f64,
    pub sepia: f64,
    pub hue: f64,
    pub blur: f64,
    pub dehaze: f64,
    pub opacity: f64,
    #[serde(default)] pub shR: f64,
    #[serde(default)] pub shG: f64,
    #[serde(default)] pub shB: f64,
    #[serde(default)] pub midR: f64,
    #[serde(default)] pub midG: f64,
    #[serde(default)] pub midB: f64,
    #[serde(default)] pub hiR: f64,
    #[serde(default)] pub hiG: f64,
    #[serde(default)] pub hiB: f64,
}

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
pub struct ExportSettings {
    #[serde(flatten)]
    pub visual: VisualSettings,
    pub canvasWidth: Option<u32>,
    pub canvasHeight: Option<u32>,
}

/// Build the FFmpeg video filter string that matches the WebGL preview shader.
/// Only adds filters when values differ from defaults.
fn build_visual_filter(settings: &VisualSettings) -> String {
    let mut parts: Vec<String> = Vec::new();

    // 1. Blur (Matched with SVG stdDeviation)
    if settings.blur > 0.01 {
        // Multiplier increased from 0.4 to 1.0 to match frontend intensity
        let sigma = settings.blur * 1.0; 
        parts.push(format!("gblur=sigma={:.4}", sigma));
    }

    // 2. Clarity (Stronger Unsharp Mask)
    if settings.clarity.abs() > 0.01 {
        // Amount increased to match visual expectations (Max slider 2.5 * 2.0 = 5.0 amount)
        let amount = (settings.clarity * 2.0).clamp(-5.0, 5.0);
        parts.push(format!("unsharp=7:7:{:.4}:7:7:{:.4}", amount, amount));
    }

    // 3. Exposure & Multiplicative Brightness (Gain)
    // Range increased to 2.5x, internal multiplier halved to match
    let gain = 2.0f64.powf(settings.exposure * 0.5) * (settings.brightness * 0.25 + 1.0);
    if (gain - 1.0).abs() > 0.001 {
        parts.push(format!("colorchannelmixer=rr={:.4}:gg={:.4}:bb={:.4}", gain, gain, gain));
    }

    // 4. Contrast, Saturation, Gamma & Dehaze (via eq)
    let dehaze = settings.dehaze;
    let eq_contrast = settings.contrast * 0.45 + 1.0 + (dehaze * 0.12);
    
    // Frontend ile aynı doygunluk frenleme (dampening) mantığı
    let sat_dampening = (settings.contrast.max(0.0)) * 0.215;
    let eq_saturation = (settings.saturation * 0.5 + 1.0) * (1.0 - sat_dampening);
    
    // Dehaze affects black point via gamma shift (deeper blacks) - Softer in v0.1.12
    let gamma_val = (settings.gamma * 0.5 + 1.0 - (dehaze * 0.08)).clamp(0.1, 5.0);
    let eq_gamma = 1.0 / gamma_val;
    
    if (eq_contrast - 1.0).abs() > 0.001 || (eq_saturation - 1.0).abs() > 0.001 || (eq_gamma - 1.0).abs() > 0.001 || dehaze.abs() > 0.001 {
        parts.push(format!("eq=contrast={:.4}:saturation={:.4}:gamma={:.4}:brightness=0", eq_contrast, eq_saturation, eq_gamma));
    }

    // 5. Color Temperature & Tint (Matrix Scaling matching SVG feColorMatrix)
    if settings.temp.abs() > 0.001 || settings.tint.abs() > 0.001 {
        let r_bal = 1.0 + (settings.temp * 0.2);
        let b_bal = 1.0 - (settings.temp * 0.2);
        let g_bal = 1.0 + (settings.tint * 0.2);
        parts.push(format!("colorchannelmixer=rr={:.4}:gg={:.4}:bb={:.4}", r_bal, g_bal, b_bal));
    }

    // 6. Vibrance
    if settings.vibrance.abs() > 0.001 {
        // Range increased to 2.5x, internal multiplier adjusted
        parts.push(format!("vibrance=intensity={:.4}", settings.vibrance * 1.25));
    }

    // 7. Sepia & Opacity (via colorchannelmixer)
    let s = settings.sepia.clamp(0.0, 1.0);
    let alpha = settings.opacity.clamp(0.0, 1.0);
    if s > 0.001 || (alpha - 1.0).abs() > 0.001 {
        let rr = 1.0 - s + s * 0.393;
        let rg = s * 0.769;
        let rb = s * 0.189;
        let gr = s * 0.349;
        let gg = 1.0 - s + s * 0.686;
        let gb = s * 0.168;
        let br = s * 0.272;
        let bg = s * 0.534;
        let bb = 1.0 - s + s * 0.131;
        
        parts.push(format!(
            "format=rgba,colorchannelmixer=rr={:.4}:rg={:.4}:rb={:.4}:gr={:.4}:gg={:.4}:gb={:.4}:br={:.4}:bg={:.4}:bb={:.4}:aa={:.4}",
            rr, rg, rb, gr, gg, gb, br, bg, bb, alpha
        ));
    }

    // 8. Hue Rotation (degrees)
    // Shader: u_hue * PI (radians) -> settings.hue * 180 (degrees)
    if settings.hue.abs() > 0.001 {
        parts.push(format!("hue=h={:.4}", settings.hue * 180.0));
    }

    // 9. Vignette
    if settings.vignette.abs() > 0.001 {
        // Reduced from 0.8 to 0.6 to match perceived frontend intensity
        let angle = (settings.vignette * 0.6).min(1.57); 
        parts.push(format!("vignette=angle={:.4}", angle));
    }

    // 10. Color Balance (Shadows, Midtones, Highlights — tonal ayrım)
    // FFmpeg colorbalance filtresi doğal olarak tonal bölge ayrımı yapıyor
    // Slider aralığı -0.5..0.5, FFmpeg aralığı -1.0..1.0 → çarpan 2.0
    if settings.shR.abs() > 0.001 || settings.shG.abs() > 0.001 || settings.shB.abs() > 0.001 ||
       settings.midR.abs() > 0.001 || settings.midG.abs() > 0.001 || settings.midB.abs() > 0.001 ||
       settings.hiR.abs() > 0.001 || settings.hiG.abs() > 0.001 || settings.hiB.abs() > 0.001 {
        parts.push(format!(
            "colorbalance=rs={:.4}:gs={:.4}:bs={:.4}:rm={:.4}:gm={:.4}:bm={:.4}:rh={:.4}:gh={:.4}:bh={:.4}",
            (settings.shR * 2.0).clamp(-1.0, 1.0),
            (settings.shG * 2.0).clamp(-1.0, 1.0),
            (settings.shB * 2.0).clamp(-1.0, 1.0),
            (settings.midR * 2.0).clamp(-1.0, 1.0),
            (settings.midG * 2.0).clamp(-1.0, 1.0),
            (settings.midB * 2.0).clamp(-1.0, 1.0),
            (settings.hiR * 2.0).clamp(-1.0, 1.0),
            (settings.hiG * 2.0).clamp(-1.0, 1.0),
            (settings.hiB * 2.0).clamp(-1.0, 1.0)
        ));
    }

    if parts.is_empty() {
        "null".to_string()
    } else {
        parts.join(",")
    }
}

fn is_static_image_ext(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg") ||
    lower.ends_with(".tif") || lower.ends_with(".tiff") || lower.ends_with(".webp") || 
    lower.ends_with(".bmp")
}

fn is_animated_image_ext(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".gif") // Add webp later if handling animated webp
}

fn is_image_ext(path: &str) -> bool {
    is_static_image_ext(path) || is_animated_image_ext(path)
}

fn is_audio_ext(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".mp3") || lower.ends_with(".wav") || lower.ends_with(".flac") ||
    lower.ends_with(".aac") || lower.ends_with(".ogg") || lower.ends_with(".m4a") ||
    lower.ends_with(".wma") || lower.ends_with(".aiff") || lower.ends_with(".alac")
}

fn has_audio_stream(path: &str) -> bool {
    let mut cmd = Command::new("ffprobe");
    #[cfg(windows)]
    { cmd.creation_flags(CREATE_NO_WINDOW); }
    if let Ok(output) = cmd
        .args(&["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", path])
        .output() {
        return !output.stdout.is_empty();
    }
    false
}

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
pub struct TextData {
    pub text: String,
    pub fontSize: f64,
    pub color: String,
    pub fontFamily: Option<String>,
    pub fontWeight: Option<String>,
    pub letterSpacing: Option<f64>,
    pub blendMode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(non_snake_case)]
pub struct ExportClip {
    pub path: String,
    pub timeline_start: f64,
    pub source_start: f64,
    pub duration: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub trackIndex: Option<i32>,
    pub transformX: Option<f64>,
    pub transformY: Option<f64>,
    pub scaleX: Option<f64>,
    pub scaleY: Option<f64>,
    pub cropX: Option<f64>,
    pub cropY: Option<f64>,
    pub cropW: Option<f64>,
    pub cropH: Option<f64>,
    pub rotation: Option<f64>,
    pub flipX: Option<bool>,
    pub flipY: Option<bool>,
    pub settings: Option<VisualSettings>,
    pub clip_type: Option<String>,
    pub text_data: Option<TextData>,
    pub base64_image: Option<String>,
    pub speed: Option<f64>,
    #[serde(alias = "volume")]
    pub volume: Option<f64>,
    #[serde(alias = "fadeIn")]
    pub fadeIn: Option<f64>,
    #[serde(alias = "fadeOut")]
    pub fadeOut: Option<f64>,
}

fn handle_base64_clips(clips: &mut Vec<ExportClip>) -> Vec<String> {
    let mut temp_files = Vec::new();
    for clip in clips.iter_mut() {
        if let Some(base64_data) = &clip.base64_image {
            // Remove prefix: data:image/png;base64,
            let data = base64_data.split(',').nth(1).unwrap_or(base64_data);
            if let Ok(bytes) = general_purpose::STANDARD.decode(data) {
                let temp_dir = std::env::temp_dir();
                let rand_val: u64 = rand::random();
                let temp_filename = format!("ve_text_{}.png", rand_val);
                let temp_path = temp_dir.join(temp_filename);
                if std::fs::write(&temp_path, bytes).is_ok() {
                    let path_str = temp_path.to_string_lossy().into_owned();
                    clip.path = path_str.clone();
                    clip.clip_type = Some("image".to_string());
                    temp_files.push(path_str);
                }
            }
        }
    }
    temp_files
}

// ─── Backup Source File (for overwrite-safe editing) ───
#[allow(non_snake_case)]
#[tauri::command]
async fn backup_source_file(sourcePath: String, galleryRoot: String) -> Result<String, String> {
    let src = std::path::Path::new(&sourcePath);
    if !src.exists() {
        return Err("Source file not found".to_string());
    }
    let temp_dir = std::path::Path::new(&galleryRoot).join(".mb_temp");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let stem = src.file_stem().unwrap_or_default().to_string_lossy();
    let ext = src.extension().unwrap_or_default().to_string_lossy();
    let backup_name = format!("{}_backup_{}.{}", stem, rand::random::<u32>(), ext);
    let backup_path = temp_dir.join(backup_name);
    std::fs::copy(&sourcePath, &backup_path).map_err(|e| format!("Backup failed: {}", e))?;
    Ok(backup_path.to_string_lossy().into_owned())
}

// ─── Clean Gallery Temp ───
#[allow(non_snake_case)]
#[tauri::command]
async fn clean_gallery_temp(galleryRoot: String) -> Result<(), String> {
    let temp_dir = std::path::Path::new(&galleryRoot).join(".mb_temp");
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).map_err(|e| format!("Temp cleanup failed: {}", e))?;
    }
    Ok(())
}

// ─── Video Export with Progress ───
#[allow(non_snake_case)]
#[tauri::command]
async fn render_video_progress(clips: Vec<ExportClip>, settings: ExportSettings, outputPath: String, galleryRoot: String, window: tauri::Window) -> Result<String, String> {
    let output_path = outputPath;
    let cw = ((settings.canvasWidth.unwrap_or(1920) / 2) * 2) as i64;
    let ch = ((settings.canvasHeight.unwrap_or(1080) / 2) * 2) as i64;

    if clips.is_empty() {
        return Err("No clips to export".to_string());
    }

    let mut clips = clips;
    let temp_files = handle_base64_clips(&mut clips);

    // Atomic Write check: FFmpeg cannot write to a file that is also an input.
    let is_overwrite = clips.iter().any(|c| c.path == output_path);
    let final_render_path = if is_overwrite {
        let mut p = std::path::PathBuf::from(&output_path);
        let stem = p.file_stem().unwrap_or_default().to_string_lossy();
        let ext = p.extension().unwrap_or_default().to_string_lossy();
        p.set_file_name(format!("{}_tmp_{}.{}", stem, rand::random::<u32>(), ext));
        p.to_string_lossy().into_owned()
    } else {
        output_path.clone()
    };

    // ── Single clip fast path ──
    if clips.len() == 1 {
        let clip = &clips[0];
        let sx = clip.scaleX.unwrap_or(1.0);
        let sy = clip.scaleY.unwrap_or(1.0);
        let crop_x = clip.cropX.unwrap_or(0.0);
        let crop_y = clip.cropY.unwrap_or(0.0);
        let crop_w = clip.cropW.unwrap_or(1.0);
        let crop_h = clip.cropH.unwrap_or(1.0);
        let tx = clip.transformX.unwrap_or(0.0);
        let ty = clip.transformY.unwrap_or(0.0);

        let rotation = clip.rotation.unwrap_or(0.0);
        let flip_x = clip.flipX.unwrap_or(false);
        let flip_y = clip.flipY.unwrap_or(false);

        let speed = clip.speed.unwrap_or(1.0);
        let volume = clip.volume.unwrap_or(1.0);
        let fade_in = clip.fadeIn.unwrap_or(0.0);
        let fade_out = clip.fadeOut.unwrap_or(0.0);

        let has_transform = tx.abs() > 0.5 || ty.abs() > 0.5 || (sx - 1.0).abs() > 0.001 || (sy - 1.0).abs() > 0.001 || rotation.abs() > 0.1 || flip_x || flip_y || (speed - 1.0).abs() > 0.001;
        let has_crop = crop_x.abs() > 0.001 || crop_y.abs() > 0.001 || (crop_w - 1.0).abs() > 0.001 || (crop_h - 1.0).abs() > 0.001;
        let has_audio_effects = (volume - 1.0).abs() > 0.001 || fade_in > 0.01 || fade_out > 0.01;

        if !has_transform && !has_crop && !has_audio_effects {
            let vis_settings = clip.settings.as_ref().unwrap_or(&settings.visual);
            let eq_filter = build_visual_filter(vis_settings);

            // ─── Input Bitrate & FPS Probing (Single Clip) ───
            let mut target_br = "20000k".to_string(); 
            let mut min_br = "18000k".to_string();
            let audio_br = "320k".to_string();
            let mut target_fps = 30.0;

            // Probe Video (Bitrate & FPS)
            let mut cmd = std::process::Command::new("ffprobe");
            #[cfg(windows)]
            { cmd.creation_flags(CREATE_NO_WINDOW); }
            if let Ok(output) = cmd
                .args(&["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=bit_rate,r_frame_rate", "-of", "default=noprint_wrappers=1:nokey=1", &clip.path])
                .output() 
            {
                if let Ok(s) = String::from_utf8(output.stdout) {
                   let lines: Vec<&str> = s.lines().collect();
                   for line in lines {
                       if line.contains('/') {
                           let parts: Vec<&str> = line.trim().split('/').collect();
                           if parts.len() == 2 {
                               let num: f64 = parts[0].parse().unwrap_or(0.0);
                               let den: f64 = parts[1].parse().unwrap_or(1.0);
                               if den != 0.0 && num > 0.0 { target_fps = num / den; }
                           }
                       } else if let Ok(val) = line.trim().parse::<u64>() {
                           if val > 100_000 { 
                               target_br = format!("{}", val);
                               min_br = format!("{}", val);
                           }
                       }
                   }
                }
            }

            let is_mp3 = output_path.to_lowercase().ends_with(".mp3");
            let is_webm = output_path.to_lowercase().ends_with(".webm");

            let mut args: Vec<String> = vec!["-y".to_string()];
            if clip.source_start > 0.001 {
                args.extend_from_slice(&["-ss".to_string(), format!("{:.4}", clip.source_start)]);
            }
            if is_static_image_ext(&clip.path) {
                args.extend_from_slice(&["-loop".to_string(), "1".to_string()]);
            } else if is_animated_image_ext(&clip.path) {
                args.extend_from_slice(&["-ignore_loop".to_string(), "0".to_string()]); // Allow GIF looping
            }
            args.extend_from_slice(&["-i".to_string(), clip.path.clone()]);
            args.extend_from_slice(&["-t".to_string(), format!("{:.4}", clip.duration)]);
            args.extend_from_slice(&["-r".to_string(), format!("{:.4}", target_fps)]);

            if is_mp3 {
                args.push("-vn".to_string());
                if !is_image_ext(&clip.path) {
                    args.extend_from_slice(&[
                        "-c:a".to_string(), "libmp3lame".to_string(),
                        "-b:a".to_string(), audio_br,
                    ]);
                }
            } else if is_webm {
                let vf = format!(
                    "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,{}",
                    cw, ch, cw, ch, eq_filter
                );
                args.extend_from_slice(&["-vf".to_string(), vf]);
                if is_image_ext(&clip.path) {
                    args.push("-an".to_string());
                } else {
                    args.extend_from_slice(&[
                        "-c:a".to_string(), "libopus".to_string(),
                        "-b:a".to_string(), "128k".to_string(), // Opus efficiency
                    ]);
                }
                args.extend_from_slice(&[
                    "-c:v".to_string(), "libvpx-vp9".to_string(),
                    "-b:v".to_string(), target_br,
                    "-deadline".to_string(), "realtime".to_string(),
                    "-cpu-used".to_string(), "4".to_string(),
                ]);
            } else {
                let vf = format!(
                    "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,{}",
                    cw, ch, cw, ch, eq_filter
                );
                args.extend_from_slice(&["-vf".to_string(), vf]);
                
                if is_image_ext(&clip.path) {
                    args.push("-an".to_string());
                } else {
                    args.extend_from_slice(&[
                        "-c:a".to_string(), "aac".to_string(),
                        "-ac".to_string(), "2".to_string(), 
                        "-b:a".to_string(), audio_br,
                    ]);
                }
                args.extend_from_slice(&[
                    "-c:v".to_string(), "libx264".to_string(),
                    "-preset".to_string(), "medium".to_string(),
                    "-b:v".to_string(), target_br, 
                    "-minrate".to_string(), min_br,
                    "-maxrate".to_string(), "50M".to_string(),
                    "-bufsize".to_string(), "100M".to_string(),
                    "-pix_fmt".to_string(), "yuv420p".to_string(),
                ]);
            }

            args.extend_from_slice(&[
                "-progress".to_string(), "pipe:1".to_string(),
                "-nostats".to_string()
            ]);
            args.push(final_render_path.clone());

            let mut cmd = Command::new("ffmpeg");
            #[cfg(windows)]
            { cmd.creation_flags(CREATE_NO_WINDOW); }
            let mut child = cmd
                .args(&args)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| e.to_string())?;

            let stdout = child.stdout.take().unwrap();
            let stderr = child.stderr.take().unwrap();
            let reader = BufReader::new(stdout);
            let err_reader = BufReader::new(stderr);
            let total_dur = clip.duration;

            // Spawn stderr reader to catch errors
            std::thread::spawn(move || {
                for _ in err_reader.lines().flatten() {
                }
            });

            for line in reader.lines().flatten() {
                if line.starts_with("out_time_ms=") {
                    if let Ok(ms) = line.replace("out_time_ms=", "").parse::<i64>() {
                        let progress = (ms as f64 / (total_dur * 1000000.0) * 100.0) as i32;
                        let _ = window.emit("video-render-progress", progress.clamp(0, 99));
                    }
                }
                if line == "progress=end" { break; }
            }

            let status = child.wait().map_err(|e| e.to_string())?;
            let _ = window.emit("video-render-progress", 100);

            if status.success() {
                if is_overwrite {
                    let _ = std::fs::remove_file(&output_path);
                    if let Err(e) = std::fs::rename(&final_render_path, &output_path) {
                         std::fs::copy(&final_render_path, &output_path).map_err(|err| format!("Atomic move failed: {} and {}", e, err))?;
                         let _ = std::fs::remove_file(&final_render_path);
                    }
                }
                // Refresh Thumbnail & DB: Update record instead of delete to maintain metadata and update mtime
                let meta = std::fs::metadata(&output_path).map_err(|e| e.to_string())?;
                let mtime = meta.modified().unwrap().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
                let size = meta.len() as i64;
                
                let pool = get_local_db_pool(std::path::Path::new(&galleryRoot)).await?;
                let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
                
                // Probe new metadata
                if let Some((w, h, dur, v_codec, a_codec, s_rate, b_rate, fps)) = probe_video_metadata_internal(&output_path) {
                    let _ = sqlx::query(
                        "INSERT OR REPLACE INTO media_files (path, filename, file_type, size, mtime, width, height, duration, video_codec, audio_codec, sample_rate, bitrate, fps) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    )
                    .bind(&output_path)
                    .bind(std::path::Path::new(&output_path).file_name().unwrap().to_string_lossy().into_owned())
                    .bind("video")
                    .bind(size)
                    .bind(mtime)
                    .bind(w)
                    .bind(h)
                    .bind(dur)
                    .bind(v_codec)
                    .bind(a_codec)
                    .bind(s_rate)
                    .bind(b_rate)
                    .bind(fps)
                    .execute(&mut *conn).await;
                } else {
                    // Fallback to just updating size/mtime if probe fails
                    let _ = sqlx::query("UPDATE media_files SET size = ?, mtime = ? WHERE path = ?")
                        .bind(size)
                        .bind(mtime)
                        .bind(&output_path)
                        .execute(&mut *conn).await;
                }
                
                let t_path = get_thumbnail_path(std::path::Path::new(&galleryRoot), &output_path);
                if t_path.exists() {
                    let _ = std::fs::remove_file(t_path);
                }
                
                let _ = window.emit("library-changed", true);
                return Ok(format!("Saved: {}", output_path));
            } else {
                if is_overwrite { let _ = std::fs::remove_file(&final_render_path); }
                return Err("FFmpeg failed".to_string());
            }
        }
        // Fall through to multi-clip overlay pipeline for single clip with transform/crop
    }

    // ── Multi-clip overlay compositing ──
    // Sort by track index (lower = bottom layer = rendered first)
    let mut sorted_clips = clips.clone();
    sorted_clips.sort_by(|a, b| {
        let ta = a.trackIndex.unwrap_or(0);
        let tb = b.trackIndex.unwrap_or(0);
        tb.cmp(&ta).then(a.timeline_start.partial_cmp(&b.timeline_start).unwrap_or(std::cmp::Ordering::Equal))
    });

    let total_duration: f64 = sorted_clips.iter()
        .map(|c| c.timeline_start + c.duration)
        .fold(0.0, |a, b| a.max(b));

    // ─── Input Bitrate & FPS Probing (Multi-Clip) ───
    let mut target_br = "20000k".to_string(); 
    let mut min_br = "18000k".to_string();
    let audio_br = "320k".to_string();
    let mut target_fps = 30.0;

    if let Some(first_clip) = sorted_clips.first() {
        let mut cmd = std::process::Command::new("ffprobe");
        #[cfg(windows)]
        { cmd.creation_flags(CREATE_NO_WINDOW); }
        if let Ok(output) = cmd
            .args(&["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=bit_rate,r_frame_rate", "-of", "default=noprint_wrappers=1:nokey=1", &first_clip.path])
            .output() 
        {
            if let Ok(s) = String::from_utf8(output.stdout) {
                let lines: Vec<&str> = s.lines().collect();
                for line in lines {
                    if line.contains('/') {
                        let parts: Vec<&str> = line.trim().split('/').collect();
                        if parts.len() == 2 {
                            let num: f64 = parts[0].parse().unwrap_or(0.0);
                            let den: f64 = parts[1].parse().unwrap_or(1.0);
                            if den != 0.0 && num > 0.0 { target_fps = num / den; }
                        }
                    } else if let Ok(val) = line.trim().parse::<u64>() {
                        if val > 100_000 { 
                            target_br = format!("{}", val);
                            min_br = format!("{}", val); 
                        }
                    }
                }
            }
        }
    }

    let mut args: Vec<String> = vec!["-y".to_string()];

    // Add all inputs
    for clip in &sorted_clips {
        if clip.clip_type.as_deref() == Some("text") {
             // For text clips, we use "lavfi" (color source) as input for the placeholder
             // Use exact dimensions from the clip (default to 1000x200 if not set)
             let w = clip.width.unwrap_or(1000);
             let h = clip.height.unwrap_or(200);
             args.extend_from_slice(&["-f".to_string(), "lavfi".to_string(), "-i".to_string(), format!("color=c=black@0:s={}x{}:d={:.4},format=yuva420p", w, h, clip.duration)]);
        } else {
            // [OPTIMIZATION] Fast seek by putting session-start BEFORE input
            if clip.source_start > 0.001 {
                args.extend_from_slice(&["-ss".to_string(), format!("{:.4}", clip.source_start)]);
            }
            if is_static_image_ext(&clip.path) {
                args.extend_from_slice(&["-loop".to_string(), "1".to_string()]);
            } else if is_animated_image_ext(&clip.path) {
                args.extend_from_slice(&["-ignore_loop".to_string(), "0".to_string()]);
            }
            args.extend_from_slice(&["-i".to_string(), clip.path.clone()]);
        }
    }

    let mut filter_complex = String::new();

    // Create black base canvas with target FPS
    filter_complex.push_str(&format!(
        "color=s={}x{}:c=black:d={:.4}:r={:.4},setsar=1[base];",
        cw, ch, total_duration.max(0.1), target_fps
    ));

    // Process each clip: trim → crop → scale → apply effects
    for (i, clip) in sorted_clips.iter().enumerate() {
        if is_audio_ext(&clip.path) && clip.clip_type.as_deref() != Some("video") {
            continue; // Skip video processing for audio-only clips
        }
        let sx = clip.scaleX.unwrap_or(1.0);
        let sy = clip.scaleY.unwrap_or(1.0);
        let crop_x = clip.cropX.unwrap_or(0.0);
        let crop_y = clip.cropY.unwrap_or(0.0);
        let crop_w = clip.cropW.unwrap_or(1.0);
        let crop_h = clip.cropH.unwrap_or(1.0);
        let base_w = clip.width.unwrap_or(1920) as f64;
        let base_h = clip.height.unwrap_or(1080) as f64;

        // Visible size after crop + scale - FORCE EVEN for yuv420p
        let vis_w = (((base_w * crop_w * sx).round() as i64) / 2) * 2;
        let vis_h = (((base_h * crop_h * sy).round() as i64) / 2) * 2;

        // Crop in source pixels
        let src_crop_x = (crop_x * base_w).round() as i64;
        let src_crop_y = (crop_y * base_h).round() as i64;
        let src_crop_w = (crop_w * base_w).round() as i64;
        let src_crop_h = (crop_h * base_h).round() as i64;

        let has_crop = crop_x.abs() > 0.001 || crop_y.abs() > 0.001 || (crop_w - 1.0).abs() > 0.001 || (crop_h - 1.0).abs() > 0.001;

        let vis_settings = clip.settings.as_ref().unwrap_or(&settings.visual);
        let eq_filter = build_visual_filter(vis_settings);

        let speed = clip.speed.unwrap_or(1.0);
        let src_dur = clip.duration * speed;

        // [PTS CORRECTION] Add timeline_start offset so overlay knows when to pick frames
        let mut chain = format!(
            "[{}:v]trim=start=0:duration={:.4},setpts=({:.4}*PTS-STARTPTS)+({:.4}/TB)",
            i, src_dur, 1.0 / speed, clip.timeline_start
        );

        if clip.clip_type.as_deref() == Some("text") {
            if let Some(td) = &clip.text_data {
                // FFmpeg drawtext filter
                // We escape single quotes in text
                let escaped_text = td.text.replace("'", "'\\''");
                let color = td.color.replace("#", "0x") + "FF"; // HEX to FFmpeg color
                
                // Font family handling
                // FFmpeg on Windows needs paths like C\\:/Windows/Fonts/arial.ttf (double backslash for the colon)
                // BUT if we use single forward slashes it usually works better: C\:/Windows/Fonts/arial.ttf
                let mut font_file = "C\\:/Windows/Fonts/arial.ttf".to_string(); // Arial is more universal
                if let Some(ff) = &td.fontFamily {
                    let ff_low = ff.to_lowercase();
                    if ff_low == "inter" {
                        font_file = "C\\:/Windows/Fonts/inter.ttf".to_string();
                    } else if ff_low == "roboto" {
                        font_file = "C\\:/Windows/Fonts/Roboto-Regular.ttf".to_string();
                    } else if ff_low == "arial" {
                        font_file = "C\\:/Windows/Fonts/arial.ttf".to_string();
                    } else if ff_low == "times new roman" {
                        font_file = "C\\:/Windows/Fonts/times.ttf".to_string();
                    }
                }

                let font_size = td.fontSize.round() as i64;
                
                chain = format!(
                    "[{}:v]trim=start=0:duration={:.4},setpts=({:.4}*PTS-STARTPTS)+({:.4}/TB),drawtext=text='{}':fontfile='{}':fontsize={}:fontcolor={}:x=(w-text_w)/2:y=(h-text_h)/2",
                    i, clip.duration, 1.0 / speed, clip.timeline_start, escaped_text, font_file, font_size, color
                );
            } else {
                 chain = format!("[{}:v]trim=start=0:duration={:.4},setpts=({:.4}*PTS-STARTPTS)+({:.4}/TB)", i, clip.duration, 1.0 / speed, clip.timeline_start);
            }
        } else {
            if is_static_image_ext(&clip.path) {
                // Static images need to be trimmed slightly differently to work in filter_complex sometimes
                chain = format!("[{}:v]trim=duration={:.4},setpts=({:.4}*PTS-STARTPTS)+({:.4}/TB)", i, clip.duration, 1.0 / speed, clip.timeline_start);
            }
            if has_crop {
                chain.push_str(&format!(",crop={}:{}:{}:{}", src_crop_w, src_crop_h, src_crop_x, src_crop_y));
            }
            chain.push_str(&format!(",scale={}:{},setsar=1", vis_w, vis_h));
        }

        let rotation = clip.rotation.unwrap_or(0.0);
        if rotation.abs() > 0.1 {
            let rot_val = ((rotation.abs() + 0.1) as i64) % 360;
            let is_positive = rotation > 0.0;
            
            match rot_val {
                90 => {
                    if is_positive { chain.push_str(",transpose=1"); } 
                    else { chain.push_str(",transpose=2"); }           
                },
                180 => {
                    chain.push_str(",hflip,vflip");
                },
                270 => {
                    if is_positive { chain.push_str(",transpose=2"); } 
                    else { chain.push_str(",transpose=1"); }          
                },
                _ => {
                    let rad = rotation * std::f64::consts::PI / 180.0;
                    chain.push_str(&format!(",rotate={:.4}:ow='hypot(iw,ih)':oh='hypot(iw,ih)'", rad));
                }
            }
        }

        // Apply flip after rotation
        let flip_x = clip.flipX.unwrap_or(false);
        let flip_y = clip.flipY.unwrap_or(false);
        if flip_x { chain.push_str(",hflip"); }
        if flip_y { chain.push_str(",vflip"); }

        // Apply visual look filters (effects)
        chain.push_str(&format!(",{}", eq_filter));

        // [BUFFER CORRECTION] Ensure all streams are in same format for overlay
        if clip.clip_type.as_deref() == Some("text") || is_image_ext(&clip.path) {
            chain.push_str(",format=yuva420p");
        } else {
            chain.push_str(",format=yuv420p");
        }

        chain.push_str(&format!("[v{}];", i));
        filter_complex.push_str(&chain);
    }

    // Filter clips that actually have video content for overlaying
    let video_clips_with_indices: Vec<(usize, &ExportClip)> = sorted_clips.iter().enumerate()
        .filter(|(_, c)| !is_audio_ext(&c.path) || c.clip_type.as_deref() == Some("video") || c.clip_type.as_deref() == Some("text"))
        .collect();

    // Overlay Loop
    let mut last_v_label = "base".to_string();
    for (idx, (i, clip)) in video_clips_with_indices.iter().enumerate() {
        let i = *i;
        let sx = clip.scaleX.unwrap_or(1.0);
        let sy = clip.scaleY.unwrap_or(1.0);
        let crop_w = clip.cropW.unwrap_or(1.0);
        let crop_h = clip.cropH.unwrap_or(1.0);
        let tx = clip.transformX.unwrap_or(0.0);
        let ty = clip.transformY.unwrap_or(0.0);
        let rotation = clip.rotation.unwrap_or(0.0);
        
        let (base_w, base_h) = if clip.clip_type.as_deref() == Some("text") {
            (clip.width.unwrap_or(1000) as f64, clip.height.unwrap_or(200) as f64)
        } else {
            (clip.width.unwrap_or(1920) as f64, clip.height.unwrap_or(1080) as f64)
        };

        let mut vis_w = base_w * crop_w * sx;
        let mut vis_h = base_h * crop_h * sy;

        // If simple 90/270 degree rotation, swap dimensions for overlay calculation
        let rot_mod = ((rotation.abs() + 0.1) as i64) % 360;
        if rot_mod == 90 || rot_mod == 270 {
            std::mem::swap(&mut vis_w, &mut vis_h);
        }

        let overlay_x = ((cw as f64 / 2.0) + tx - vis_w / 2.0).round() as i64;
        let overlay_y = ((ch as f64 / 2.0) + ty - vis_h / 2.0).round() as i64;

        let t_start = clip.timeline_start;
        let t_end = clip.timeline_start + clip.duration;

        let dst_label = if idx == video_clips_with_indices.len() - 1 { "outv".to_string() } else { format!("tmpv{}", idx) };

        let mut blend_part = String::new();
        if let Some(td) = &clip.text_data {
            if let Some(bm) = &td.blendMode {
                 // FFmpeg overlay blend modes: normal, addition, grainmerge, multiply, screen, overlay, hardlight, softlight, dodge, burn, divide, addition, substract, difference, grainmerge, grainextract, darken, lighten
                 // Frontend uses standard CSS blend modes. We map them.
                 let mapped = match bm.as_str() {
                     "multiply" => "multiply",
                     "screen" => "screen",
                     "overlay" => "overlay",
                     "darken" => "darken",
                     "lighten" => "lighten",
                     "color-dodge" => "dodge",
                     "color-burn" => "burn",
                     "hard-light" => "hardlight",
                     "soft-light" => "softlight",
                     "difference" => "difference",
                     "exclusion" => "exclusion",
                     _ => "normal",
                 };
                 if mapped != "normal" {
                     blend_part = format!(":blend={}", mapped);
                 }
            }
        }

        filter_complex.push_str(&format!(
            "[{}][v{}]overlay=x={}:y={}{}:enable='between(t,{:.4},{:.4})'[{}];",
            last_v_label, i, overlay_x, overlay_y, blend_part, t_start, t_end + 0.005, dst_label
        ));
        last_v_label = dst_label;
    }
    
    // Ensure outv exists even if no clips were overlaid (e.g. audio-only projects)
    if video_clips_with_indices.is_empty() {
        if !filter_complex.ends_with(';') && !filter_complex.is_empty() { filter_complex.push(';'); }
        filter_complex.push_str("[base]null[outv]");
    }

    // Audio Filter Logic: Mix audio from all inputs with proper timing, volume, and fades
    let mut audio_inputs = Vec::new();
    for (i, clip) in sorted_clips.iter().enumerate() {
        if clip.clip_type.as_deref() == Some("text") { continue; }
        if is_static_image_ext(&clip.path) { continue; }
        
        // Wait, if volume is 0, we still need to check if we should skip.
        // If a video has volume 0, skip its audio.
        let volume_val = clip.volume.unwrap_or(1.0);
        if volume_val < 0.001 { continue; }

        if is_audio_ext(&clip.path) || has_audio_stream(&clip.path) {
            audio_inputs.push(i);
        }
    }

    let mut map_audio = String::new();
    if !audio_inputs.is_empty() {
        if !filter_complex.ends_with(';') && !filter_complex.is_empty() { filter_complex.push(';'); }
        let mut audio_chains = Vec::new();
        for &i in &audio_inputs {
            let clip = &sorted_clips[i];
            let speed = clip.speed.unwrap_or(1.0);
            let volume_val = clip.volume.unwrap_or(1.0);
            let fade_in = clip.fadeIn.unwrap_or(0.0);
            let fade_out = clip.fadeOut.unwrap_or(0.0);
            let delay_ms = (clip.timeline_start * 1000.0).round() as i64;
            
            // Trim and move audio
            // [CORRECTION] Since we use -ss as input flag, the starting point in the filter is 0
            let mut a_chain = format!("[{}:a]atrim=start=0:duration={:.4},asetpts=PTS-STARTPTS", i, clip.duration * speed);
            
            if (speed - 1.0).abs() > 0.001 {
                let mut s = speed;
                while s > 2.0 {
                    a_chain.push_str(",atempo=2.0");
                    s /= 2.0;
                }
                while s < 0.5 {
                    a_chain.push_str(",atempo=0.5");
                    s /= 0.5;
                }
                if (s - 1.0).abs() > 0.001 {
                    a_chain.push_str(&format!(",atempo={:.4}", s));
                }
            }
            
            if (volume_val - 1.0).abs() > 0.001 {
                a_chain.push_str(&format!(",volume={:.4}", volume_val));
            }
            
            if fade_in > 0.01 {
                a_chain.push_str(&format!(",afade=t=in:st=0:d={:.4}", fade_in));
            }
            
            if fade_out > 0.01 {
                let start_fade_out = clip.duration - fade_out;
                a_chain.push_str(&format!(",afade=t=out:st={:.4}:d={:.4}", start_fade_out.max(0.0), fade_out));
            }
            
            if (delay_ms as f64) > 0.01 {
                // Use 's' suffix (seconds) which is most reliable across FFmpeg versions for precision
                a_chain.push_str(&format!(",adelay={:.4}s:all=1", clip.timeline_start));
            }
            
            let label = format!("aud{}", i);
            a_chain.push_str(&format!("[{}];", label));
            filter_complex.push_str(&a_chain);
            audio_chains.push(label);
        }
        
        let mut mix_inputs = String::new();
        for label in &audio_chains {
            mix_inputs.push_str(&format!("[{}]", label));
        }
        
        if audio_chains.len() > 1 {
            filter_complex.push_str(&format!("{}amix=inputs={}:duration=first:normalize=0:dropout_transition=0[outa]", mix_inputs, audio_chains.len()));
            map_audio = "[outa]".to_string();
        } else if !audio_chains.is_empty() {
            // If only one audio input, just rename the last label to outa
            let last_label = audio_chains[0].clone();
            filter_complex.push_str(&format!("[{}]anull[outa]", last_label));
            map_audio = "[outa]".to_string();
        }
    }

    if filter_complex.ends_with(';') { filter_complex.pop(); }

    let is_mp3 = output_path.to_lowercase().ends_with(".mp3");
    let is_webm = output_path.to_lowercase().ends_with(".webm");

    if is_mp3 {
        args.extend_from_slice(&[
            "-filter_complex".to_string(), filter_complex,
        ]);
        if !map_audio.is_empty() {
            args.extend_from_slice(&["-map".to_string(), map_audio]);
        }
        args.extend_from_slice(&[
            "-vn".to_string(),
            "-c:a".to_string(), "libmp3lame".to_string(),
            "-b:a".to_string(), audio_br,
            "-progress".to_string(), "pipe:1".to_string(),
            "-nostats".to_string()
        ]);
    } else if is_webm {
        args.extend_from_slice(&[
            "-filter_complex".to_string(), filter_complex.clone(),
            "-map".to_string(), "[outv]".to_string(),
        ]);
        if !map_audio.is_empty() {
            args.extend_from_slice(&["-map".to_string(), map_audio]);
            args.extend_from_slice(&[
                "-c:a".to_string(), "libopus".to_string(),
                "-b:a".to_string(), "128k".to_string(),
            ]);
        }
        args.extend_from_slice(&[
            "-r".to_string(), format!("{:.4}", target_fps),
            "-c:v".to_string(), "libvpx-vp9".to_string(),
            "-b:v".to_string(), target_br,
            "-deadline".to_string(), "realtime".to_string(),
            "-cpu-used".to_string(), "4".to_string(),
            "-t".to_string(), format!("{:.4}", total_duration), // Force total project duration
            "-progress".to_string(), "pipe:1".to_string(),
            "-async".to_string(), "1".to_string(),
            "-nostats".to_string()
        ]);
    } else {
        args.extend_from_slice(&[
            "-filter_complex".to_string(), filter_complex.clone(),
            "-map".to_string(), "[outv]".to_string(),
        ]);
        if !map_audio.is_empty() {
            args.extend_from_slice(&["-map".to_string(), map_audio]);
            args.extend_from_slice(&[
                "-c:a".to_string(), "aac".to_string(),
                "-ac".to_string(), "2".to_string(), 
                "-b:a".to_string(), audio_br,
            ]);
        }
        args.extend_from_slice(&[
            "-r".to_string(), format!("{:.4}", target_fps),
            "-c:v".to_string(), "libx264".to_string(),
            "-preset".to_string(), "medium".to_string(), 
            "-b:v".to_string(), target_br, 
            "-minrate".to_string(), min_br,
            "-maxrate".to_string(), "50M".to_string(), 
            "-bufsize".to_string(), "100M".to_string(), 
            "-pix_fmt".to_string(), "yuv420p".to_string(),
            "-threads".to_string(), "0".to_string(),
            "-t".to_string(), format!("{:.4}", total_duration), // Force total project duration
            "-progress".to_string(), "pipe:1".to_string(),
            "-async".to_string(), "1".to_string(),
            "-nostats".to_string()
        ]);
    }
    
    args.push(final_render_path.clone());

    // Run FFmpeg with progress
    let mut cmd = Command::new("ffmpeg");
    #[cfg(windows)]
    { cmd.creation_flags(CREATE_NO_WINDOW); }
    let mut child = cmd
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let reader = BufReader::new(stdout);
    let err_reader = BufReader::new(stderr);

    // Spawn stderr reader to catch errors
    std::thread::spawn(move || {
        for _ in err_reader.lines().flatten() {
        }
    });

    for line in reader.lines().flatten() {
        if line.starts_with("out_time_ms=") {
            if let Ok(ms) = line.replace("out_time_ms=", "").parse::<i64>() {
                let progress = (ms as f64 / (total_duration * 1000000.0) * 100.0) as i32;
                let _ = window.emit("video-render-progress", progress.clamp(0, 99));
            }
        }
        if line == "progress=end" { break; }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = window.emit("video-render-progress", 100);

    // Cleanup text temp files
    for path in temp_files {
        let _ = std::fs::remove_file(path);
    }

    if status.success() {
        if is_overwrite {
            let _ = std::fs::remove_file(&output_path);
            if let Err(e) = std::fs::rename(&final_render_path, &output_path) {
                 std::fs::copy(&final_render_path, &output_path).map_err(|err| format!("Atomic move failed: {} and {}", e, err))?;
                 let _ = std::fs::remove_file(&final_render_path);
            }
        }
        
        // Refresh Thumbnail & DB: Update record instead of delete
        let meta = std::fs::metadata(&output_path).map_err(|e| e.to_string())?;
        let mtime = meta.modified().unwrap().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        let size = meta.len() as i64;

        let pool = get_local_db_pool(std::path::Path::new(&galleryRoot)).await?;
        if let Ok(mut conn) = pool.acquire().await {
            // Probe new metadata
            if let Some((w, h, dur, v_codec, a_codec, s_rate, b_rate, fps)) = probe_video_metadata_internal(&output_path) {
                let _ = sqlx::query(
                    "INSERT OR REPLACE INTO media_files (path, filename, file_type, size, mtime, width, height, duration, video_codec, audio_codec, sample_rate, bitrate, fps) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                )
                .bind(&output_path)
                .bind(std::path::Path::new(&output_path).file_name().unwrap().to_string_lossy().into_owned())
                .bind("video")
                .bind(size)
                .bind(mtime)
                .bind(w)
                .bind(h)
                .bind(dur)
                .bind(v_codec)
                .bind(a_codec)
                .bind(s_rate)
                .bind(b_rate)
                .bind(fps)
                .execute(&mut *conn).await;
            } else {
                let _ = sqlx::query("UPDATE media_files SET size = ?, mtime = ? WHERE path = ?")
                    .bind(size)
                    .bind(mtime)
                    .bind(&output_path)
                    .execute(&mut *conn).await;
            }
        }

        let t_path = get_thumbnail_path(std::path::Path::new(&galleryRoot), &output_path);
        if t_path.exists() {
            let _ = std::fs::remove_file(t_path);
        }
        
        let _ = window.emit("library-changed", true);
        Ok(format!("Saved: {}", output_path))
    } else {
        if is_overwrite { let _ = std::fs::remove_file(&final_render_path); }
        Err("FFmpeg failed".to_string())
    }
}

// Helper to build FFmpeg graph for both single frame and export
fn prepare_ffmpeg_graph(clips: &Vec<ExportClip>, settings: &ExportSettings, time: Option<f64>) -> (Vec<String>, String, String) {
    let mut input_args = Vec::new();
    let mut filter_complex = String::new();
    let cw = ((settings.canvasWidth.unwrap_or(1920) / 2) * 2) as i64;
    let ch = ((settings.canvasHeight.unwrap_or(1080) / 2) * 2) as i64;

    // Filter valid clips based on time if provided
    let mut relevant_clips: Vec<&ExportClip> = if let Some(t) = time {
        clips.iter().filter(|c| t >= c.timeline_start && t < (c.timeline_start + c.duration)).collect()
    } else {
        clips.iter().collect()
    };

    if relevant_clips.is_empty() {
        return (vec![], format!("color=s={}x{}:c=black:d=0.1[out]", cw, ch), "out".to_string());
    }

    // Sort (matches render_video_progress logic: Descending track index)
    relevant_clips.sort_by(|a, b| {
        let ta = a.trackIndex.unwrap_or(0);
        let tb = b.trackIndex.unwrap_or(0);
        tb.cmp(&ta).then(
            a.timeline_start.partial_cmp(&b.timeline_start).unwrap_or(std::cmp::Ordering::Equal)
        )
    });

    // Build inputs
    for clip in &relevant_clips {
        if let Some(t) = time {
             // Calculate seek time
             let seek = clip.source_start + (t - clip.timeline_start);
             input_args.push("-ss".to_string());
             input_args.push(format!("{:.4}", seek));
        }
        if is_static_image_ext(&clip.path) {
            input_args.push("-loop".to_string());
            input_args.push("1".to_string());
        } else if is_animated_image_ext(&clip.path) {
            input_args.push("-ignore_loop".to_string());
            input_args.push("0".to_string());
        }
        input_args.push("-i".to_string());
        input_args.push(clip.path.clone());
    }

    // Base Layer (Black Background)
    filter_complex.push_str(&format!("color=s={}x{}:c=black:d=0.1,setsar=1[base];", cw, ch));

    // Process Clips
    for (i, clip) in relevant_clips.iter().enumerate() {
        let sx = clip.scaleX.unwrap_or(1.0);
        let sy = clip.scaleY.unwrap_or(1.0);
        let crop_w = clip.cropW.unwrap_or(1.0);
        let crop_h = clip.cropH.unwrap_or(1.0);
        let base_w = clip.width.unwrap_or(1920) as f64;
        let base_h = clip.height.unwrap_or(1080) as f64;
        
        let crop_x = clip.cropX.unwrap_or(0.0);
        let crop_y = clip.cropY.unwrap_or(0.0);

        let src_crop_w = (crop_w * base_w).round() as i64;
        let src_crop_h = (crop_h * base_h).round() as i64;
        let src_crop_x = (crop_x * base_w).round() as i64;
        let src_crop_y = (crop_y * base_h).round() as i64;

        let vis_w = (((base_w * crop_w * sx).round() as i64) / 2) * 2;
        let vis_h = (((base_h * crop_h * sy).round() as i64) / 2) * 2;

        // Match FFmpeg's integer-based overlay logic to prevent "shifts"
        let speed = clip.speed.unwrap_or(1.0);
        let mut chain = format!("[{}:v]setpts={:.4}*PTS-STARTPTS,", i, 1.0 / speed); // Reset PTS after -ss seeking and apply speed
        
        if crop_x.abs() > 0.001 || crop_y.abs() > 0.001 || (crop_w - 1.0).abs() > 0.001 || (crop_h - 1.0).abs() > 0.001 {
             chain.push_str(&format!("crop={}:{}:{}:{},", src_crop_w, src_crop_h, src_crop_x, src_crop_y));
        }
        
        chain.push_str(&format!("scale={}:{},setsar=1,", vis_w, vis_h));

        // Apply rotation first to match Canvas 2D context order
        let rotation = clip.rotation.unwrap_or(0.0);
        if rotation.abs() > 0.1 {
            let rot_val = ((rotation.abs() + 0.1) as i64) % 360;
            let is_positive = rotation > 0.0;
            
            match rot_val {
                90 => {
                    if is_positive { chain.push_str("transpose=1,"); } 
                    else { chain.push_str("transpose=2,"); }           
                },
                180 => {
                    chain.push_str("hflip,vflip,");
                },
                270 => {
                    if is_positive { chain.push_str("transpose=2,"); } 
                    else { chain.push_str("transpose=1,"); }          
                },
                _ => {
                    let rad = rotation * std::f64::consts::PI / 180.0;
                    chain.push_str(&format!("rotate={:.4}:ow='hypot(iw,ih)':oh='hypot(iw,ih)',", rad));
                }
            }
        }

        // Apply flip after rotation
        let flip_x = clip.flipX.unwrap_or(false);
        let flip_y = clip.flipY.unwrap_or(false);
        if flip_x { chain.push_str("hflip,"); }
        if flip_y { chain.push_str("vflip,"); }

        if chain.ends_with(',') { chain.pop(); }
        chain.push_str(&format!("[v{}];", i));
        filter_complex.push_str(&chain);
    }

    // Overlay Loop
    for (i, clip) in relevant_clips.iter().enumerate() {
        let sx = clip.scaleX.unwrap_or(1.0);
        let sy = clip.scaleY.unwrap_or(1.0);
        let crop_w = clip.cropW.unwrap_or(1.0);
        let crop_h = clip.cropH.unwrap_or(1.0);
        let tx = clip.transformX.unwrap_or(0.0);
        let ty = clip.transformY.unwrap_or(0.0);
        let base_w = clip.width.unwrap_or(1920) as f64;
        let base_h = clip.height.unwrap_or(1080) as f64;
        let rotation = clip.rotation.unwrap_or(0.0);

        let mut vis_w = base_w * crop_w * sx;
        let mut vis_h = base_h * crop_h * sy;

        // If simple 90/270 degree rotation, swap dimensions for overlay calculation
        let rot_mod = ((rotation.abs() + 0.1) as i64) % 360;
        if rot_mod == 90 || rot_mod == 270 {
            std::mem::swap(&mut vis_w, &mut vis_h);
        }

        let overlay_x = ((cw as f64 / 2.0) + tx - vis_w / 2.0).round() as i64;
        let overlay_y = ((ch as f64 / 2.0) + ty - vis_h / 2.0).round() as i64;

        let src_label = if i == 0 { "base".to_string() } else { format!("tmp{}", i-1) };
        let dst_label = if i == relevant_clips.len() - 1 { "out".to_string() } else { format!("tmp{}", i) };

        filter_complex.push_str(&format!("[{}][v{}]overlay=x={}:y={}:shortest=1[{}];", src_label, i, overlay_x, overlay_y, dst_label));
    }
    
    if filter_complex.ends_with(';') { filter_complex.pop(); }

    (input_args, filter_complex, "out".to_string())
}

// Preview frame render - renders a single frame at specific time using consistent pipeline
#[allow(non_snake_case)]
#[tauri::command]
async fn render_timeline_frame(clips: Vec<ExportClip>, settings: ExportSettings, time: f64) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};


    // Use a smaller resolution for preview if requested, to speed up latency
    // For now we use the requested settings (which should come from frontend scaling)
    let mut clips = clips;
    let temp_files = handle_base64_clips(&mut clips);
    
    let (input_args, filter_complex, out_label) = prepare_ffmpeg_graph(&clips, &settings, Some(time));


    let mut args = vec!["-y".to_string(), "-hide_banner".to_string(), "-loglevel".to_string(), "error".to_string()];
    args.extend(input_args);
    args.extend_from_slice(&[
        "-filter_complex".to_string(), filter_complex,
        "-map".to_string(), format!("[{}]", out_label),
        "-vframes".to_string(), "1".to_string(),
        "-f".to_string(), "image2pipe".to_string(),
        "-vcodec".to_string(), "png".to_string(), // MJPEG yerine PNG (Renk kalitesi için)
        "pipe:1".to_string()
    ]);

    let mut cmd = Command::new("ffmpeg");
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd
        .args(&args)
        .output()
        .map_err(|e| format!("FFmpeg failed start: {}", e))?;
    
    // Cleanup
    for p in temp_files {
        let _ = std::fs::remove_file(p);
    }

    if output.status.success() {
        let b64 = general_purpose::STANDARD.encode(&output.stdout);
        Ok(format!("data:image/png;base64,{}", b64))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("FFmpeg error: {}", stderr))
    }
}

#[tauri::command]
async fn export_video(clips: Vec<ExportClip>, settings: ExportSettings, output_path: String) -> Result<String, String> {
    let canvas_w = settings.canvasWidth.unwrap_or(1920);
    let canvas_h = settings.canvasHeight.unwrap_or(1080);
    let mut filter_complex = String::new();
    let mut input_args = Vec::new();
    for (i, clip) in clips.iter().enumerate() {
        let vis_settings = clip.settings.as_ref().unwrap_or(&settings.visual);
        let eq_filter = build_visual_filter(vis_settings);
        if is_static_image_ext(&clip.path) {
            input_args.push("-loop".to_string());
            input_args.push("1".to_string());
        } else if is_animated_image_ext(&clip.path) {
            input_args.push("-ignore_loop".to_string());
            input_args.push("0".to_string());
        }
        input_args.push("-i".to_string());
        input_args.push(clip.path.clone());
        filter_complex.push_str(&format!(
            "[{}:v]trim=start={}:duration={},setpts=PTS-STARTPTS,scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,{}[v{}];",
            i, clip.source_start, clip.duration, canvas_w, canvas_h, canvas_w, canvas_h, eq_filter, i
        ));
    }
    let mut concat_str = String::new();
    for i in 0..clips.len() { concat_str.push_str(&format!("[v{}]", i)); }
    filter_complex.push_str(&format!("{}concat=n={}:v=1:a=0[outv]", concat_str, clips.len()));
    let mut cmd_ffmpeg = Command::new("ffmpeg");
    #[cfg(windows)]
    {
        cmd_ffmpeg.creation_flags(CREATE_NO_WINDOW);
    }
    let status = cmd_ffmpeg.args(input_args).arg("-filter_complex").arg(&filter_complex).arg("-map").arg("[outv]").arg("-y").arg(&output_path).status().map_err(|e| e.to_string())?;
    if status.success() { Ok(format!("Saved: {}", output_path)) } else { Err("FFmpeg failed".to_string()) }
}

#[tauri::command]
async fn save_image(path: String, data_url: String, gallery_root: Option<String>) -> Result<MediaFile, String> {
    use base64::{Engine as _, engine::general_purpose};
    let base64_data = data_url.split(",").nth(1).ok_or("Invalid format")?;
    let bytes = general_purpose::STANDARD.decode(base64_data).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    if let Some(r) = gallery_root {
        let tp = get_thumbnail_path(Path::new(&r), &path);
        if tp.exists() { let _ = std::fs::remove_file(tp); }
    }
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(MediaFile { 
        path: path.clone(), 
        filename: Path::new(&path).file_name().unwrap().to_string_lossy().into_owned(), 
        file_type: "image".to_string(), 
        size: meta.len() as i64, 
        mtime: meta.modified().unwrap().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64, 
        width: None, 
        height: None, 
        duration: None, 
        notes: None,
        fps: None,
        video_codec: None,
        audio_codec: None,
        bitrate: None,
        sample_rate: None
    })
}




#[tauri::command]
async fn create_folder(parent_path: String, folder_name: String) -> Result<(), String> {
    let path = Path::new(&parent_path).join(&folder_name);
    if path.exists() {
        return Err("Folder already exists".to_string());
    }
    std::fs::create_dir(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn rename_media_file(old_path: String, new_filename: String, gallery_root: String) -> Result<MediaFile, String> {
    let old_path_buf = Path::new(&old_path);
    let parent = old_path_buf.parent().ok_or("Invalid path")?;
    let is_dir = old_path_buf.is_dir();
    
    // Klasörler için uzantı eklemeyi atla (nokta içeren klasör isimlerinde hata oluşmaması için)
    let ext = if is_dir { "" } else { old_path_buf.extension().and_then(|s| s.to_str()).unwrap_or("") };
    
    let mut new_filename_with_ext = new_filename.clone();
    if !ext.is_empty() {
        new_filename_with_ext.push_str(".");
        new_filename_with_ext.push_str(ext);
    }
    
    let new_path_buf = parent.join(&new_filename_with_ext);
    let new_path_str = new_path_buf.to_string_lossy().into_owned();

    // Windows uyumluluğu: Eğer yeni yol eskisiyle aynıysa (sadece büyük/küçük harf farkı varsa), 
    // exists() true döneceği için bu durumu özel olarak ele alıyoruz.
    if new_path_buf.exists() && old_path.to_lowercase() != new_path_str.to_lowercase() {
        return Err("A file with the same name already exists".to_string());
    }
    let pool = get_local_db_pool(Path::new(&gallery_root)).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    if is_dir {
        // 1. Alt öğelerin thumbnail'larını taşı (Diskten tara - en güvenli yöntem)
        let descendants = scan_directory_recursive(&old_path, "");
        for d in descendants {
            if d.file_type == "folder" { continue; }
            
            // Gelecekteki yol: old_path -> new_path_str dönüşümü
            let relative_part = &d.path[old_path.len()..];
            let future_path = format!("{}{}", new_path_str, relative_part);
            
            let old_t = get_thumbnail_path(Path::new(&gallery_root), &d.path);
            if old_t.exists() {
                let new_t = get_thumbnail_path(Path::new(&gallery_root), &future_path);
                if let Some(p) = new_t.parent() { let _ = std::fs::create_dir_all(p); }
                let _ = std::fs::rename(old_t, new_t);
            }
        }

        // 2. Alt öğelerin DB kayıtlarını toplu güncelle
        let sep = if old_path.contains('\\') { "\\" } else { "/" };
        let old_prefix = format!("{}{}", old_path, sep);
        let new_prefix = format!("{}{}", new_path_str, sep);
        
        let pattern = format!("{}%", old_prefix.replace('^', "^^").replace('%', "^%").replace('_', "^_"));
        
        let _ = sqlx::query("UPDATE media_files SET path = ?1 || substr(path, length(?2) + 1) WHERE path LIKE ?3 ESCAPE '^'")
            .bind(&new_prefix)
            .bind(&old_prefix)
            .bind(&pattern)
            .execute(&mut *tx)
            .await;
    }

    // 3. Klasörü/Dosyayı fiziksel olarak yeniden adlandır
    std::fs::rename(&old_path, &new_path_str).map_err(|e| e.to_string())?;

    // 4. Klasörün/Dosyanın kendi veritabanı kaydını güncelle
    let _ = sqlx::query("UPDATE media_files SET path = ?, filename = ? WHERE path = ?")
        .bind(&new_path_str)
        .bind(&new_filename_with_ext)
        .bind(&old_path)
        .execute(&mut *tx)
        .await;

    // 5. Klasörün/Dosyanın kendi thumbnail'ını en son taşı
    let old_t = get_thumbnail_path(Path::new(&gallery_root), &old_path);
    if old_t.exists() {
        let new_t = get_thumbnail_path(Path::new(&gallery_root), &new_path_str);
        let _ = std::fs::rename(old_t, new_t);
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    let meta = std::fs::metadata(&new_path_str).map_err(|e| e.to_string())?;
    Ok(MediaFile {
        path: new_path_str,
        filename: new_filename_with_ext,
        file_type: if is_dir { "folder".to_owned() } else { "file".to_owned() },
        size: meta.len() as i64,
        mtime: meta.modified().unwrap().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64,
        width: None, height: None, duration: None, notes: None,
        fps: None, video_codec: None, audio_codec: None, bitrate: None, sample_rate: None
    })
}

#[tauri::command]
async fn delete_media_file(path: String, gallery_root: String, method: thumbnail_manager::ShredMethod) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("File does not exist".to_string());
    }

    // 1. Remove from Disk
    thumbnail_manager::secure_delete_file(p, method)?;

    // 2. Remove from DB (Recursive if folder)
    let pool = get_local_db_pool(Path::new(&gallery_root)).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    
    let sub_pattern = format!("{}*", path);
    let _ = sqlx::query("DELETE FROM media_files WHERE path GLOB ?")
        .bind(&sub_pattern)
        .execute(&mut *conn)
        .await;

    // 3. Remove Thumbnail
    let t_path = get_thumbnail_path(Path::new(&gallery_root), &path);
    if t_path.exists() {
        let _ = thumbnail_manager::secure_delete_file(&t_path, method);
    }

    // 4. Remove associated Subtitles (SRT/SRT)
    let p_buf = Path::new(&path);
    if let (Some(parent), Some(stem)) = (p_buf.parent(), p_buf.file_stem()) {
        let srt1 = parent.join(stem).with_extension("srt");
        let srt2 = parent.join(stem).with_extension("SRT");
        if srt1.exists() { let _ = std::fs::remove_file(srt1); }
        if srt2.exists() { let _ = std::fs::remove_file(srt2); }
    }

    Ok(())
}

#[tauri::command]
async fn delete_media_file_only(path: String, method: thumbnail_manager::ShredMethod) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("File does not exist".to_string());
    }
    
    // Only remove from disk using settings method
    thumbnail_manager::secure_delete_file(p, method)?;
    Ok(())
}

fn copy_dir_all(src: impl AsRef<Path>, dst: impl AsRef<Path>) -> std::io::Result<()> {
    std::fs::create_dir_all(&dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(entry.path(), dst.as_ref().join(entry.file_name()))?;
        } else {
            std::fs::copy(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn move_media_item(old_path: String, new_parent_path: String, gallery_root: String) -> Result<TransferResult, String> {
    let old_p = Path::new(&old_path);
    let new_parent_p = Path::new(&new_parent_path);
    let filename = old_p.file_name().ok_or("Invalid path")?;
    let new_path = new_parent_p.join(filename);
    let new_path_str = new_path.to_string_lossy().to_string();

    if new_path.exists() {
        return Ok(TransferResult { success_count: 0, skip_count: 1 });
    }

    let is_dir = old_p.is_dir();
    let pool = get_local_db_pool(Path::new(&gallery_root)).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    if is_dir {
        // 1. Alt öğelerin thumbnail'larını taşı (Diskten tara)
        let descendants = scan_directory_recursive(&old_path, "");
        for d in descendants {
            if d.file_type == "folder" { continue; }
            
            // Gelecekteki yolu hesapla
            let relative_part = &d.path[old_path.len()..];
            let future_path = format!("{}{}", new_path_str, relative_part);
            
            let old_t = get_thumbnail_path(Path::new(&gallery_root), &d.path);
            if old_t.exists() {
                let new_t = get_thumbnail_path(Path::new(&gallery_root), &future_path);
                if let Some(p) = new_t.parent() { let _ = std::fs::create_dir_all(p); }
                let _ = std::fs::rename(old_t, new_t);
            }
        }

        // 2. Alt öğelerin DB kayıtlarını toplu güncelle
        let sep = if old_path.contains('\\') { "\\" } else { "/" };
        let old_prefix = format!("{}{}", old_path, sep);
        let new_prefix = format!("{}{}", new_path_str, sep);
        
        let pattern = format!("{}%", old_prefix.replace('^', "^^").replace('%', "^%").replace('_', "^_"));
        
        let _ = sqlx::query("UPDATE media_files SET path = ?1 || substr(path, length(?2) + 1) WHERE path LIKE ?3 ESCAPE '^'")
            .bind(&new_prefix)
            .bind(&old_prefix)
            .bind(&pattern)
            .execute(&mut *tx)
            .await;
    }

    // 3. Klasörü/Dosyayı fiziksel olarak taşı
    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())?;

    // 4. Klasörün/Dosyanın kendi veritabanı kaydını güncelle
    sqlx::query("UPDATE media_files SET path = ? WHERE path = ?")
        .bind(&new_path_str)
        .bind(&old_path)
        .execute(&mut *tx)
        .await.map_err(|e| e.to_string())?;

    // 5. Klasörün/Dosyanın kendi thumbnail'ını taşı
    let old_t = get_thumbnail_path(Path::new(&gallery_root), &old_path);
    if old_t.exists() {
        let new_t = get_thumbnail_path(Path::new(&gallery_root), &new_path_str);
        let _ = std::fs::rename(old_t, new_t);
    }
    
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(TransferResult { success_count: 1, skip_count: 0 })
}

#[tauri::command]
async fn copy_media_item(old_path: String, new_parent_path: String, gallery_root: String) -> Result<TransferResult, String> {
    let old_p = Path::new(&old_path);
    let new_parent_p = Path::new(&new_parent_path);
    let filename = old_p.file_name().ok_or("Invalid path")?;
    let new_path = new_parent_p.join(filename);
    let new_path_str = new_path.to_string_lossy().to_string();

    if new_path.exists() {
        return Ok(TransferResult { success_count: 0, skip_count: 1 });
    }

    // FS Copy
    if old_p.is_dir() {
        copy_dir_all(old_p, &new_path).map_err(|e| e.to_string())?;
    } else {
        std::fs::copy(old_p, &new_path).map_err(|e| e.to_string())?;
    }

    // DB Copy
    let pool = get_local_db_pool(Path::new(&gallery_root)).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Copy the item itself
    // We explicitly list columns to ensure we copy all metadata including notes
    sqlx::query(
        "INSERT INTO media_files (path, filename, file_type, size, mtime, width, height, duration, notes, fps, video_codec, audio_codec, bitrate, sample_rate, metadata)
         SELECT ?, filename, file_type, size, mtime, width, height, duration, notes, fps, video_codec, audio_codec, bitrate, sample_rate, metadata
         FROM media_files WHERE path = ?"
    )
    .bind(&new_path_str)
    .bind(&old_path)
    .execute(&mut *tx)
    .await.map_err(|e| e.to_string())?;

    // Recursive copy if folder
    if old_p.is_dir() {
        let old_prefix = format!("{}\\", old_path);
        let new_prefix = format!("{}\\", new_path_str);
        let glob = format!("{}*", old_prefix);

        sqlx::query(
            "INSERT INTO media_files (path, filename, file_type, size, mtime, width, height, duration, notes, fps, video_codec, audio_codec, bitrate, sample_rate, metadata)
             SELECT ? || substr(path, ?), filename, file_type, size, mtime, width, height, duration, notes, fps, video_codec, audio_codec, bitrate, sample_rate, metadata
             FROM media_files WHERE path GLOB ?"
        )
        .bind(&new_prefix)
        .bind((old_prefix.len() + 1) as i32)
        .bind(&glob)
        .execute(&mut *tx)
        .await.map_err(|e| e.to_string())?;
    }
    
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(TransferResult { success_count: 1, skip_count: 0 })
}


#[derive(Debug, Serialize, Deserialize, Clone)]
#[allow(non_snake_case)]
pub struct ProxyData {
    pub path: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration: Option<f64>,
}

fn probe_video_metadata_internal(path: &str) -> Option<(Option<u32>, Option<u32>, Option<f64>, Option<String>, Option<String>, Option<i32>, Option<i64>, Option<f64>)> {
    let mut cmd = Command::new("ffprobe");
    #[cfg(windows)]
    { cmd.creation_flags(CREATE_NO_WINDOW); }
    let output = cmd
        .args(&["-v", "error", "-show_entries", "stream=codec_name,width,height,r_frame_rate,bit_rate,sample_rate,codec_type", "-show_entries", "format=duration,bit_rate", "-of", "json", path])
        .output()
        .ok()?;
    if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
            let mut width = None;
            let mut height = None;
            let mut video_codec = None;
            let mut audio_codec = None;
            let mut sample_rate = None;
            let mut fps = None;
            
            if let Some(streams) = json["streams"].as_array() {
                for s in streams {
                    if s["codec_type"] == "video" {
                        width = s["width"].as_u64().map(|v| v as u32);
                        height = s["height"].as_u64().map(|v| v as u32);
                        video_codec = s["codec_name"].as_str().map(|v| v.to_string());
                        
                        // Parse FPS
                        if let Some(fps_str) = s["r_frame_rate"].as_str() {
                            let parts: Vec<&str> = fps_str.split('/').collect();
                            if parts.len() == 2 {
                                let num: f64 = parts[0].parse().unwrap_or(0.0);
                                let den: f64 = parts[1].parse().unwrap_or(1.0);
                                if den != 0.0 {
                                    fps = Some(num / den);
                                }
                            }
                        }
                    } else if s["codec_type"] == "audio" {
                        audio_codec = s["codec_name"].as_str().map(|v| v.to_string());
                        sample_rate = s["sample_rate"].as_str().and_then(|v| v.parse().ok());
                    }
                }
            }
            let duration = json["format"]["duration"].as_str().and_then(|v| v.parse().ok());
            let bitrate = json["format"]["bit_rate"].as_str().and_then(|v| v.parse().ok());
            
            return Some((width, height, duration, video_codec, audio_codec, sample_rate, bitrate, fps));
        }
    None
}

#[tauri::command]
async fn ensure_video_proxy(app: tauri::AppHandle, path: String) -> Result<ProxyData, String> {
    use std::hash::{Hash, Hasher};
    use std::collections::hash_map::DefaultHasher;

    let p = Path::new(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    
    // Eğer zaten H.264 MP4 ise proxy gerekmez
    // (Basitlik için sadece avi, wmv vb. için zorla transcode)
    let unsupported = vec!["avi", "wmv", "flv", "mpg", "mpeg", "m4v", "3gp", "ts"];
    
    let final_path = if !unsupported.contains(&ext.as_str()) {
        path
    } else {
        let cache_dir = app.path().app_cache_dir().expect("Failed to get cache dir");
        if !cache_dir.exists() { let _ = std::fs::create_dir_all(&cache_dir); }

        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        let mtime = meta.modified().unwrap().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();

        let mut hasher = DefaultHasher::new();
        path.hash(&mut hasher);
        mtime.hash(&mut hasher);
        let hash = hasher.finish();

        let proxy_path = cache_dir.join(format!("proxy_{:x}.mp4", hash));

        if !proxy_path.exists() {
            // Transcode to a web-friendly MP4 (ultrafast)
            let mut cmd = Command::new("ffmpeg");
            #[cfg(windows)]
            { cmd.creation_flags(CREATE_NO_WINDOW); }
            let status = cmd
                .args(&[
                    "-hwaccel", "auto",
                    "-i", &path,
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-crf", "23",
                    "-c:a", "aac",
                    "-b:a", "128k",
                    "-pix_fmt", "yuv420p",
                    "-y",
                    &proxy_path.to_string_lossy().into_owned()
                ])
                .status()
                .map_err(|e| e.to_string())?;

            if !status.success() {
                return Err("Proxy generation failed".to_string());
            }
        }
        proxy_path.to_string_lossy().into_owned()
    };

    // Her durumda güncel metadata ile dön
    let mut width = None;
    let mut height = None;
    let mut duration = None;

    if let Some(m) = probe_video_metadata_internal(&final_path) {
        width = m.0;
        height = m.1;
        duration = m.2;
    }

    Ok(ProxyData {
        path: final_path,
        width,
        height,
        duration,
    })
}

#[tauri::command]
async fn reset_gallery(gallery_root: String, method: thumbnail_manager::ShredMethod) -> Result<(), String> {
    let root = Path::new(&gallery_root);
    
    // We should try to close the DB connection before deleting it
    // Note: In this simple app, we might just delete it and let sqlx handle error if someone is using it,
    // but better to be safe. Since we use a pool per root locally, we might not have it in global state.
    
    thumbnail_manager::reset_gallery_files(root, method)
}

#[tauri::command]
async fn clear_thumbnails(gallery_root: String, method: thumbnail_manager::ShredMethod) -> Result<usize, String> {
    let root = Path::new(&gallery_root);
    
    // 1. Scan everything in the gallery
    let media_files = scan_directory_recursive(&gallery_root, ""); // Empty query means all files
    
    // 2. Collect all valid hashes
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::collections::HashSet;

    let mut valid_hashes = HashSet::new();
    for file in media_files {
        if file.file_type != "folder" {
            let mut hasher = DefaultHasher::new();
            file.path.hash(&mut hasher);
            valid_hashes.insert(format!("{:x}", hasher.finish()));
        }
    }

    // 3. Clear unused
    thumbnail_manager::clear_unused_thumbnails(root, valid_hashes, method)
}

struct StreamPort(u16);

#[tauri::command]
fn get_streaming_port(state: tauri::State<'_, StreamPort>) -> u16 {
    state.0
}

#[tauri::command]
async fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(&["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(&["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let parent = Path::new(&path).parent().unwrap_or(Path::new("/"));
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
async fn show_main_window(window: tauri::Window) {
    window.show().unwrap();
}

#[derive(Clone, serde::Serialize)]
struct ConvertProgress {
    file: String,
    progress: f64,
}

#[tauri::command]
async fn scan_videos_recursive(path: String) -> Result<Vec<MediaFile>, String> {
    let mut results = Vec::new();

    let walker = walkdir::WalkDir::new(&path).follow_links(true).into_iter().filter_entry(|e| {
        let filename = e.file_name().to_string_lossy();
        let filename_upper = filename.to_uppercase();
        !filename.starts_with('.') && filename_upper != "$RECYCLE.BIN" && filename_upper != "SYSTEM VOLUME INFORMATION"
    });

    for entry in walker.filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            let path_buf = entry.path();
            if let Some(ext) = path_buf.extension().and_then(|s| s.to_str()) {
                let ext_lower = ext.to_lowercase();
                if ext_lower == "mkv" || ext_lower == "mov" || ext_lower == "avi" || ext_lower == "webm" || ext_lower == "flv" || ext_lower == "wmv" || ext_lower == "mpg" || ext_lower == "mpeg" || ext_lower == "3gp" || ext_lower == "dat" {
                    if let Ok(metadata) = entry.metadata() {
                        results.push(MediaFile {
                            path: path_buf.to_string_lossy().into_owned(),
                            filename: entry.file_name().to_string_lossy().into_owned(),
                            file_type: "video".to_owned(),
                            size: metadata.len() as i64,
                            mtime: metadata.modified()
                                .ok()
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs() as i64)
                                .unwrap_or(0),
                            width: None, height: None, duration: None, notes: None, fps: None,
                            video_codec: None, audio_codec: None, bitrate: None, sample_rate: None,
                        });
                    }
                }
            }
        }
    }
    Ok(results)
}

#[tauri::command]
async fn convert_video_to_mp4(window: tauri::Window, input_path: String, output_path: String) -> Result<(), String> {
    let mut duration = 0.0;
    if let Some(meta) = probe_video_metadata_internal(&input_path) {
        if let Some(d) = meta.2 {
            duration = d;
        }
    }

    let log_path = format!("{}.log", output_path);
    let stderr_file = std::fs::File::create(&log_path).map(Stdio::from).unwrap_or_else(|_| Stdio::null());

    // -c:v copy and -c:a copy used for lossless re-muxing if the codecs are compatible with mp4.
    // If we MUST transcode (e.g. video is an incompatible codec for mp4 like some raw AVIs), 
    // crf 0 (lossless) or crf 17 (visually lossless, highly compressed) can be used.
    // We'll use high quality transcoding parameters with extremely high audio bitrate matching, 
    // but default to stream copying when possible, or very high limits to preserve the data.
    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(), input_path.clone(),
        "-c:v".to_string(), "libx264".to_string(),
        "-preset".to_string(), "medium".to_string(),
        "-crf".to_string(), "17".to_string(),
        "-c:a".to_string(), "aac".to_string(),
        "-b:a".to_string(), "192k".to_string(),
        "-vsync".to_string(), "0".to_string(),
        "-map_metadata".to_string(), "0".to_string(),
        "-progress".to_string(), "pipe:1".to_string()
    ];
    
    if duration > 0.0 {
        // Enforce the clip's probed duration explicitly to prevent freezing at end due to stream mismatch
        args.push("-t".to_string());
        args.push(format!("{:.4}", duration));
    }

    args.push(output_path.clone());

    let mut cmd = Command::new("ffmpeg");
    #[cfg(windows)]
    { cmd.creation_flags(CREATE_NO_WINDOW); }
    let mut child = cmd
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(stderr_file)
        .spawn()
        .map_err(|e| e.to_string())?;

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().filter_map(|l| l.ok()) {
            if line.starts_with("out_time_ms=") {
                let time_str = line.replace("out_time_ms=", "");
                if let Ok(time_ms) = time_str.parse::<f64>() {
                    let time_sec = time_ms / 1000000.0;
                    if duration > 0.0 {
                        let mut p = (time_sec / duration) * 100.0;
                        if p > 99.0 { p = 99.0; }
                        let _ = window.emit("convert_progress", ConvertProgress {
                            file: input_path.clone(),
                            progress: p
                        });
                    }
                }
            }
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    
    if !status.success() {
        let _ = std::fs::remove_file(&output_path); // remove leftover if any
        let mut error_msg = "FFmpeg conversion failed".to_string();
        if let Ok(log_content) = std::fs::read_to_string(&log_path) {
            if !log_content.trim().is_empty() {
                error_msg = log_content;
            }
        }
        let _ = std::fs::remove_file(&log_path);
        return Err(error_msg);
    }

    let _ = std::fs::remove_file(&log_path);

    let _ = window.emit("convert_progress", ConvertProgress {
        file: input_path.clone(),
        progress: 100.0
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server = Server::http("127.0.0.1:0").expect("Failed to bind streaming server");
    let port = match server.server_addr() {
        tiny_http::ListenAddr::IP(addr) => addr.port(),
    };
    
    // Run streaming server with multi-threaded request handling
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            std::thread::spawn(move || {
                let url = request.url();
                if url.starts_with("/stream") {
                    if let Some(query_idx) = url.find("path=") {
                        let encoded_path = &url[query_idx + 5..];
                        let decoded_path = urlencoding::decode(encoded_path).unwrap_or(std::borrow::Cow::Borrowed(encoded_path)).into_owned();
                        
                        let final_path = if let Some(amp_idx) = decoded_path.find('&') {
                            &decoded_path[..amp_idx]
                        } else {
                            &decoded_path
                        };

                        let mut child = Command::new("ffmpeg");
                        child.args(&[
                            "-probesize", "32",              // Mutlak minimum analiz buffer'ı
                            "-analyzeduration", "0",         // Analiz süresini tamamen kapat
                            "-fflags", "nobuffer+flush_packets", // Tamponlamayı tamamen devre dışı bırak
                            "-hwaccel", "auto",
                            "-i", final_path,
                            "-c:v", "libx264",
                            "-preset", "ultrafast",
                            "-tune", "zerolatency",
                            "-crf", "28",
                            "-threads", "4",                 // Tahmin edilebilir paralel işlem
                            "-c:a", "aac",
                            "-b:a", "128k",
                            "-f", "mp4",
                            "-movflags", "empty_moov+frag_keyframe+default_base_moof+omit_tfhd_offset", // En hızlı stream bayrakları
                            "-loglevel", "quiet",
                            "pipe:1"
                        ]);

                        #[cfg(windows)]
                        child.creation_flags(CREATE_NO_WINDOW);

                        let mut child = child.stdout(Stdio::piped())
                            .stderr(Stdio::null())
                            .spawn()
                            .expect("Failed to spawn ffmpeg");

                        if let Some(stdout) = child.stdout.take() {
                            let response = Response::new(
                                tiny_http::StatusCode(200),
                                vec![
                                    Header::from_bytes(&b"Content-Type"[..], &b"video/mp4"[..]).unwrap(),
                                    Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                                    Header::from_bytes(&b"Cache-Control"[..], &b"no-cache"[..]).unwrap(),
                                ],
                                stdout,
                                None,
                                None
                            );
                            let _ = request.respond(response);
                        }
                    }
                } else {
                    let _ = request.respond(tiny_http::Response::from_string("Not Found").with_status_code(404));
                }
            });
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info) // Default level
            .level_for("sqlx", log::LevelFilter::Warn) // Suppress noisy sqlx logs
            .build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, show and focus the existing window
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.show();
                let _ = main_window.unminimize();
                let _ = main_window.set_focus();
            }
        }))
        .setup(move |app| {
            app.manage(StreamPort(port));
            let handle = app.handle().clone();
            
            // Veritabanını arka planda kur, uygulamayı bekletme!
            tauri::async_runtime::spawn(async move {
                if let Ok(pool) = init_db(&handle).await {
                    handle.manage(DbState { pool });
                }
            });

            // System Tray
            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::TrayIconBuilder;

            let show_item = MenuItemBuilder::with_id("show", "Göster / Show").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Çıkış / Quit").build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .tooltip("Media Browser")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // PENCEREYİ ZORLA GÖSTER - En düşük seviyede
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.show();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_folder, get_thumbnail, export_video, render_video_progress, render_timeline_frame, save_image, save_note, 
            create_folder, rename_media_file, get_file_details, 
            delete_media_file, move_media_item, copy_media_item,
            reset_gallery, clear_thumbnails, get_subtitle, add_subtitle_file,
            get_streaming_port, ensure_video_proxy, show_main_window, reveal_in_explorer,
            scan_videos_recursive, convert_video_to_mp4, delete_media_file_only,
            backup_source_file, clean_gallery_temp
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
