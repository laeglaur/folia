use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const DATABASE_FILE: &str = "notebook.sqlite3";
const ATTACHMENTS_DIR: &str = "attachments";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedAsset {
    id: String,
    original_path: String,
    stored_path: String,
    asset_url: String,
    mime_type: String,
    size: u64,
    sha256: String,
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(DATABASE_FILE))
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let connection = Connection::open(database_path(app)?).map_err(|error| error.to_string())?;
    initialize_database(&connection)?;
    Ok(connection)
}

fn initialize_database(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS app_state (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              state_json TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS operation_log (
              id TEXT PRIMARY KEY,
              timestamp TEXT NOT NULL,
              entity TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS attachments (
              id TEXT PRIMARY KEY,
              original_path TEXT NOT NULL,
              stored_path TEXT NOT NULL,
              mime_type TEXT NOT NULL,
              size INTEGER NOT NULL,
              sha256 TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            ",
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn mime_from_path(path: &PathBuf) -> String {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn sha256_file(path: &PathBuf) -> Result<(String, u64), String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    let mut buffer = [0u8; 8192];
    loop {
        let bytes = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if bytes == 0 {
            break;
        }
        size += bytes as u64;
        hasher.update(&buffer[..bytes]);
    }
    Ok((format!("{:x}", hasher.finalize()), size))
}

fn asset_url_for_path(path: &PathBuf) -> String {
    let path = path.to_string_lossy();
    format!("asset://localhost/{}", path.trim_start_matches('/'))
}

fn import_asset_into_store(
    connection: &Connection,
    app_data_dir: PathBuf,
    source_path: String,
) -> Result<ImportedAsset, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err(format!("Asset does not exist: {source_path}"));
    }

    let (sha256, size) = sha256_file(&source)?;
    let mime_type = mime_from_path(&source);
    let extension = source
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| format!(".{}", extension.to_lowercase()))
        .unwrap_or_default();
    let id = format!("asset_{sha256}");
    let attachments_dir = app_data_dir.join(ATTACHMENTS_DIR).join(&sha256[0..2]);
    fs::create_dir_all(&attachments_dir).map_err(|error| error.to_string())?;
    let stored_path = attachments_dir.join(format!("{sha256}{extension}"));

    if !stored_path.exists() {
        fs::copy(&source, &stored_path).map_err(|error| error.to_string())?;
    }

    connection
        .execute(
            "
            INSERT INTO attachments (id, original_path, stored_path, mime_type, size, sha256, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
            ON CONFLICT(sha256) DO UPDATE SET
              original_path = excluded.original_path,
              stored_path = excluded.stored_path,
              mime_type = excluded.mime_type,
              size = excluded.size
            ",
            params![
                id,
                source_path,
                stored_path.to_string_lossy(),
                mime_type,
                size as i64,
                sha256
            ],
        )
        .map_err(|error| error.to_string())?;

    Ok(ImportedAsset {
        id: format!("asset_{sha256}"),
        original_path: source.to_string_lossy().to_string(),
        stored_path: stored_path.to_string_lossy().to_string(),
        asset_url: asset_url_for_path(&stored_path),
        mime_type,
        size,
        sha256,
    })
}

fn import_asset_bytes_into_store(
    connection: &Connection,
    app_data_dir: PathBuf,
    filename: String,
    mime_type_hint: String,
    bytes: Vec<u8>,
) -> Result<ImportedAsset, String> {
    if bytes.is_empty() {
        return Err("Asset payload is empty".to_string());
    }

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha256 = format!("{:x}", hasher.finalize());
    let size = bytes.len() as u64;
    let extension = PathBuf::from(&filename)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| format!(".{}", extension.to_lowercase()))
        .unwrap_or_default();
    let mime_type = if mime_type_hint.trim().is_empty() || mime_type_hint == "application/octet-stream" {
        mime_from_path(&PathBuf::from(&filename))
    } else {
        mime_type_hint
    };
    let id = format!("asset_{sha256}");
    let attachments_dir = app_data_dir.join(ATTACHMENTS_DIR).join(&sha256[0..2]);
    fs::create_dir_all(&attachments_dir).map_err(|error| error.to_string())?;
    let stored_path = attachments_dir.join(format!("{sha256}{extension}"));

    if !stored_path.exists() {
        fs::write(&stored_path, &bytes).map_err(|error| error.to_string())?;
    }

    connection
        .execute(
            "
            INSERT INTO attachments (id, original_path, stored_path, mime_type, size, sha256, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
            ON CONFLICT(sha256) DO UPDATE SET
              original_path = excluded.original_path,
              stored_path = excluded.stored_path,
              mime_type = excluded.mime_type,
              size = excluded.size
            ",
            params![
                id,
                filename.clone(),
                stored_path.to_string_lossy(),
                mime_type.clone(),
                size as i64,
                sha256
            ],
        )
        .map_err(|error| error.to_string())?;

    Ok(ImportedAsset {
        id: format!("asset_{sha256}"),
        original_path: filename,
        stored_path: stored_path.to_string_lossy().to_string(),
        asset_url: asset_url_for_path(&stored_path),
        mime_type,
        size,
        sha256,
    })
}

#[tauri::command]
fn load_state_snapshot(app: AppHandle) -> Result<Option<String>, String> {
    let connection = open_database(&app)?;
    connection
        .query_row("SELECT state_json FROM app_state WHERE id = 1", [], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_state_snapshot(app: AppHandle, state_json: String) -> Result<(), String> {
    let mut connection = open_database(&app)?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction
        .execute(
            "
            INSERT INTO app_state (id, state_json, updated_at)
            VALUES (1, ?1, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
              state_json = excluded.state_json,
              updated_at = excluded.updated_at
            ",
            params![state_json],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn import_local_asset(app: AppHandle, source_path: String) -> Result<ImportedAsset, String> {
    let connection = open_database(&app)?;
    import_asset_into_store(&connection, app_data_dir(&app)?, source_path)
}

#[tauri::command]
fn import_asset_bytes(
    app: AppHandle,
    filename: String,
    mime_type: String,
    bytes: Vec<u8>,
) -> Result<ImportedAsset, String> {
    let connection = open_database(&app)?;
    import_asset_bytes_into_store(&connection, app_data_dir(&app)?, filename, mime_type, bytes)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_state_snapshot,
            save_state_snapshot,
            import_local_asset,
            import_asset_bytes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn row_count(connection: &Connection) -> i64 {
        connection
            .query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0))
            .expect("attachments row count")
    }

    #[test]
    fn importing_local_assets_copies_media_files_and_deduplicates_metadata() {
        let source_root = tempfile::tempdir().expect("source temp dir");
        let source_dir = source_root
            .path()
            .join("Group Containers")
            .join("Markdown Import");
        fs::create_dir_all(&source_dir).expect("source dirs");
        let source_path = source_dir.join("sample travel image.jpeg");
        let bytes = b"\xff\xd8\xff\xe0not-a-real-jpeg-but-stable-test-bytes";
        fs::write(&source_path, bytes).expect("source image");
        let audio_path = source_dir.join("voice memo.m4a");
        let audio_bytes = b"not-a-real-m4a-but-stable-test-bytes";
        fs::write(&audio_path, audio_bytes).expect("source audio");

        let app_data = tempfile::tempdir().expect("app data temp dir");
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");

        let imported = import_asset_into_store(
            &connection,
            app_data.path().to_path_buf(),
            source_path.to_string_lossy().to_string(),
        )
        .expect("first asset import");

        assert_eq!(imported.original_path, source_path.to_string_lossy());
        assert_eq!(imported.mime_type, "image/jpeg");
        assert_eq!(imported.size, bytes.len() as u64);
        assert!(imported.asset_url.starts_with("asset://localhost/"));
        assert!(Path::new(&imported.stored_path).is_file());
        assert!(imported.stored_path.contains("/attachments/"));
        assert!(imported.stored_path.ends_with(".jpeg"));
        assert_eq!(row_count(&connection), 1);

        let imported_again = import_asset_into_store(
            &connection,
            app_data.path().to_path_buf(),
            source_path.to_string_lossy().to_string(),
        )
        .expect("second asset import");

        assert_eq!(imported_again.id, imported.id);
        assert_eq!(imported_again.sha256, imported.sha256);
        assert_eq!(imported_again.stored_path, imported.stored_path);
        assert_eq!(row_count(&connection), 1);

        let imported_audio = import_asset_into_store(
            &connection,
            app_data.path().to_path_buf(),
            audio_path.to_string_lossy().to_string(),
        )
        .expect("audio asset import");

        assert_eq!(imported_audio.original_path, audio_path.to_string_lossy());
        assert_eq!(imported_audio.mime_type, "audio/mp4");
        assert_eq!(imported_audio.size, audio_bytes.len() as u64);
        assert!(Path::new(&imported_audio.stored_path).is_file());
        assert!(imported_audio.stored_path.ends_with(".m4a"));
        assert_eq!(row_count(&connection), 2);
    }

    #[test]
    fn importing_missing_asset_returns_clear_error() {
        let app_data = tempfile::tempdir().expect("app data temp dir");
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        let missing_path = app_data.path().join("missing.png");

        let error = import_asset_into_store(
            &connection,
            app_data.path().to_path_buf(),
            missing_path.to_string_lossy().to_string(),
        )
        .expect_err("missing asset should fail");

        assert!(error.contains("Asset does not exist"));
        assert_eq!(row_count(&connection), 0);
    }

    #[test]
    fn importing_asset_bytes_copies_payload_and_deduplicates_metadata() {
        let app_data = tempfile::tempdir().expect("app data temp dir");
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        let payload = b"fake mp3 payload for stability".to_vec();

        let imported = import_asset_bytes_into_store(
            &connection,
            app_data.path().to_path_buf(),
            "voice memo.mp3".to_string(),
            "audio/mpeg".to_string(),
            payload.clone(),
        )
        .expect("byte asset import");

        assert_eq!(imported.original_path, "voice memo.mp3");
        assert_eq!(imported.mime_type, "audio/mpeg");
        assert_eq!(imported.size, payload.len() as u64);
        assert!(Path::new(&imported.stored_path).is_file());
        assert!(imported.stored_path.ends_with(".mp3"));
        assert_eq!(row_count(&connection), 1);

        let imported_again = import_asset_bytes_into_store(
            &connection,
            app_data.path().to_path_buf(),
            "voice memo.mp3".to_string(),
            "audio/mpeg".to_string(),
            payload,
        )
        .expect("second byte asset import");

        assert_eq!(imported_again.id, imported.id);
        assert_eq!(row_count(&connection), 1);
    }
}
