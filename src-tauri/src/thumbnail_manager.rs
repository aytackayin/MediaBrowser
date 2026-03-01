use std::path::{Path, PathBuf};
use std::fs;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{Write, Seek};
use std::fs::OpenOptions;
use rand::RngCore;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
pub enum ShredMethod {
    Trash,   // Recycle Bin
    Standard, // Just delete (no shred)
    Fast,    // 1 pass - zeros
    Random,  // 1 pass - random
    DoD3,    // 3 passes - zero, one, random
    DoD7,    // 7 passes - DoD 5220.22-M (ECE)
    NSA,     // 3 passes - NSA 130-2
    NAVSO,   // 3 passes - NAVSO P-5239-26 (MFM)
    VSITR,   // 7 passes - German standard
    Gutmann, // 35 passes
}

pub fn get_thumbnail_path(gallery_root: &Path, original_path: &str) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    original_path.hash(&mut hasher);
    let hash = hasher.finish();
    
    let thumb_dir = gallery_root.join(".gallery_thumbs");
    if !thumb_dir.exists() {
        fs::create_dir_all(&thumb_dir).unwrap_or_default();
    }
    
    thumb_dir.join(format!("{:x}.jpg", hash))
}

pub fn secure_delete_file(path: &Path, method: ShredMethod) -> Result<(), String> {
    if !path.exists() { return Ok(()); }

    // 1. Trash Method
    if method == ShredMethod::Trash {
        // trash crate handles both files and directories
        return trash::delete(path).map_err(|e| e.to_string());
    }

    // 2. Standard Method (Direct Delete) - Optimization
    if method == ShredMethod::Standard {
        if path.is_dir() {
            return fs::remove_dir_all(path).map_err(|e| e.to_string());
        }
        return fs::remove_file(path).map_err(|e| e.to_string());
    }

    // 3. Recursive Handling for Folders (for Shredding methods)
    if path.is_dir() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let _ = secure_delete_file(&entry.path(), method);
            }
        }
        return fs::remove_dir_all(path).map_err(|e| e.to_string());
    }

    // 4. Secure Shredding
    let mut file = match OpenOptions::new().write(true).open(path) {
        Ok(f) => f,
        Err(_) => return fs::remove_file(path).map_err(|e| e.to_string()),
    };

    let metadata = file.metadata().map_err(|e| e.to_string())?;
    let len = metadata.len();
    
    if len > 0 {
        let mut rng = rand::thread_rng();
        let chunk_size = 64 * 1024;
        
        // Determine pass patterns based on method
        // 0: Zeros, 1: Ones, 2: Random, 3: 0xAA (VSITR last pass), 4: 0x01 (NAVSO), 5: 0x27 (NAVSO)
        let passes: Vec<u8> = match method {
            ShredMethod::Fast => vec![0],
            ShredMethod::Random => vec![2],
            ShredMethod::DoD3 => vec![0, 1, 2],
            ShredMethod::NSA => vec![2, 2, 0],
            ShredMethod::NAVSO => vec![4, 5, 2],
            ShredMethod::DoD7 => vec![0, 1, 0, 1, 0, 1, 2],
            ShredMethod::VSITR => vec![0, 1, 0, 1, 0, 1, 3],
            ShredMethod::Gutmann => {
                let mut p = Vec::new();
                for _ in 0..35 { p.push(2); } 
                p
            },
            _ => vec![0] // Default fallback
        };

        for pass_type in passes {
            let _ = file.seek(std::io::SeekFrom::Start(0));
            // Reset written counter for each pass
            let mut written = 0;
            
            while written < len {
                let to_write = std::cmp::min(chunk_size as u64, len - written) as usize;
                let mut buf = vec![0u8; to_write]; // Allocating inside loop is fine for this scale, or move out
                match pass_type {
                    0 => { /* already zeros */ },
                    1 => { for b in &mut buf { *b = 0xFF; } },
                    2 => { rng.fill_bytes(&mut buf); },
                    3 => { for b in &mut buf { *b = 0xAA; } },
                    4 => { for b in &mut buf { *b = 0x01; } },
                    5 => { for b in &mut buf { *b = 0x27; } },
                    _ => { rng.fill_bytes(&mut buf); }
                }
                if let Err(_) = file.write_all(&buf) { break; }
                written += to_write as u64;
            }
            let _ = file.sync_all();
        }
    }

    drop(file);
    fs::remove_file(path).map_err(|e| e.to_string())
}

pub fn generate_image_thumbnail(original_path: &str, thumb_path: &Path) -> Result<(), String> {
    use image::ImageReader;
    
    let img = ImageReader::open(original_path)
        .map_err(|e| format!("Dosya açılamadı ({}): {}", original_path, e))?
        .with_guessed_format()
        .map_err(|e| format!("Format tespit edilemedi ({}): {}", original_path, e))?
        .decode()
        .map_err(|e| format!("Resim çözümlenemedi ({}): {}", original_path, e))?;
    
    // Resize with aspect ratio preserved
    let thumbnail = img.thumbnail(320, 180);
    
    thumbnail.save(thumb_path).map_err(|e| format!("Thumbnail kaydedilemedi: {}", e))?;
    
    Ok(())
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn generate_video_thumbnail(original_path: &str, thumb_path: &Path) -> Result<(), String> {
    let mut cmd = std::process::Command::new("ffmpeg");
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    
    let output = cmd
        .args(&[
            "-i", original_path,
            "-ss", "00:00:01.000",
            "-vframes", "1",
            "-q:v", "5",
            "-f", "image2", // Explicitly set format
            "-y", // Overwrite output path
            thumb_path.to_str().unwrap_or_default()
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }

    Ok(())
}

pub fn clear_unused_thumbnails(gallery_root: &Path, valid_hashes: std::collections::HashSet<String>, method: ShredMethod) -> Result<usize, String> {
    let thumb_dir = gallery_root.join(".gallery_thumbs");
    if !thumb_dir.exists() {
        return Ok(0);
    }

    let mut deleted_count = 0;
    if let Ok(entries) = fs::read_dir(thumb_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(file_stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if !valid_hashes.contains(file_stem) {
                        let _ = secure_delete_file(&path, method);
                        deleted_count += 1;
                    }
                }
            }
        }
    }
    Ok(deleted_count)
}

pub fn reset_gallery_files(gallery_root: &Path, method: ShredMethod) -> Result<(), String> {
    let thumb_dir = gallery_root.join(".gallery_thumbs");
    if thumb_dir.exists() {
        secure_delete_file(&thumb_dir, method)?;
    }
    
    let db_dir = gallery_root.join(".db");
    if db_dir.exists() {
        secure_delete_file(&db_dir, method)?;
    }
    
    Ok(())
}
