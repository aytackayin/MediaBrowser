use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager};
use std::collections::HashMap;
use tokio::sync::RwLock;
use std::sync::OnceLock;

pub struct DbState {
    #[allow(dead_code)]
    pub pool: SqlitePool, // Global pool for settings/galleries list
}

static POOL_CACHE: OnceLock<RwLock<HashMap<String, SqlitePool>>> = OnceLock::new();

fn get_pool_cache() -> &'static RwLock<HashMap<String, SqlitePool>> {
    POOL_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

pub async fn init_db(app_handle: &AppHandle) -> Result<SqlitePool, sqlx::Error> {
    let app_data_dir = app_handle.path().app_data_dir().expect("Failed to get app data dir");
    if !app_data_dir.exists() {
        fs::create_dir_all(&app_data_dir).expect("Failed to create app data dir");
    }
    
    let db_path = app_data_dir.join("mediabrowser.db");
    let db_url = format!("sqlite://{}", db_path.to_string_lossy());
    
    if !db_path.exists() {
        fs::File::create(&db_path).expect("Failed to create database file");
    }
    
    let pool = SqlitePool::connect(&db_url).await?;
    
    // Global schema: Keep tracks of galleries
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS galleries (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE
        );"
    ).execute(&pool).await?;

    Ok(pool)
}

pub async fn get_local_db_pool(gallery_root: &Path) -> Result<SqlitePool, String> {
    let cache_key = gallery_root.to_string_lossy().to_string();
    
    {
        let cache = get_pool_cache().read().await;
        if let Some(pool) = cache.get(&cache_key) {
            return Ok(pool.clone());
        }
    }

    let db_dir = gallery_root.join(".db");
    if !db_dir.exists() {
        fs::create_dir_all(&db_dir).map_err(|e| e.to_string())?;
    }
    
    let db_path = db_dir.join("gallery.db");
    let db_url = format!("sqlite://{}", db_path.to_string_lossy());
    
    if !db_path.exists() {
        fs::File::create(&db_path).map_err(|e| e.to_string())?;
    }
    
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .map_err(|e| e.to_string())?;
    
    // Local gallery schema
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS media_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            filename TEXT NOT NULL,
            file_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            mtime INTEGER NOT NULL,
            width INTEGER,
            height INTEGER,
            duration REAL,
            notes TEXT,
            fps REAL,
            video_codec TEXT,
            audio_codec TEXT,
            bitrate INTEGER,
            sample_rate INTEGER,
            metadata JSON
        );"
    ).execute(&pool).await.map_err(|e| e.to_string())?;

    // Efficient Migration: Check for existing columns before trying to add them
    let columns = sqlx::query("PRAGMA table_info(media_files)").fetch_all(&pool).await.map_err(|e| e.to_string())?;
    let column_names: std::collections::HashSet<String> = columns.iter().map(|row: &sqlx::sqlite::SqliteRow| {
        use sqlx::Row;
        row.get::<String, _>(1)
    }).collect();

    if !column_names.contains("fps") {
        let _ = sqlx::query("ALTER TABLE media_files ADD COLUMN fps REAL").execute(&pool).await;
    }
    if !column_names.contains("video_codec") {
        let _ = sqlx::query("ALTER TABLE media_files ADD COLUMN video_codec TEXT").execute(&pool).await;
    }
    if !column_names.contains("audio_codec") {
        let _ = sqlx::query("ALTER TABLE media_files ADD COLUMN audio_codec TEXT").execute(&pool).await;
    }
    if !column_names.contains("bitrate") {
        let _ = sqlx::query("ALTER TABLE media_files ADD COLUMN bitrate INTEGER").execute(&pool).await;
    }
    if !column_names.contains("sample_rate") {
        let _ = sqlx::query("ALTER TABLE media_files ADD COLUMN sample_rate INTEGER").execute(&pool).await;
    }
    
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_media_files_path ON media_files(path);").execute(&pool).await.map_err(|e| e.to_string())?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_media_files_type ON media_files(file_type);").execute(&pool).await.map_err(|e| e.to_string())?;
    
    {
        let mut cache = get_pool_cache().write().await;
        cache.insert(cache_key, pool.clone());
    }

    Ok(pool)
}
