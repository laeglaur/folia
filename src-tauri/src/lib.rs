use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

const DATABASE_FILE: &str = "notebook.sqlite3";
const ATTACHMENTS_DIR: &str = "attachments";
const PAGE_REVISION_LIMIT: i64 = 20;

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentCleanupResult {
    removed_count: usize,
    removed_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownFilePayload {
    path: String,
    filename: String,
    markdown: String,
}

#[derive(Default)]
struct PendingMarkdownOpens(Mutex<Vec<String>>);

#[derive(Default)]
struct PendingCardOpens(Mutex<Vec<String>>);

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedNotebook {
    id: String,
    name: String,
    #[serde(default)]
    page_ids: Vec<String>,
    #[serde(default)]
    metadata: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedPageMetadata {
    #[serde(default)]
    source_filename: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(default)]
    frontmatter: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    emoji: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedPageContent {
    #[serde(default = "default_normalized_page_content_type")]
    content_type: String,
    #[serde(default = "default_normalized_page_content_version")]
    version: u32,
    #[serde(default)]
    blocks: Vec<NormalizedBlock>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedRichContent {
    html: String,
    plain_text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedBlock {
    id: String,
    page_id: String,
    content: NormalizedRichContent,
    collapsed: bool,
    pinned: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedPage {
    id: String,
    notebook_id: String,
    #[serde(default)]
    parent_id: Option<String>,
    title: String,
    block_ids: Vec<String>,
    #[serde(default)]
    block_order: Option<String>,
    metadata: NormalizedPageMetadata,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedOperationLogEntry {
    id: String,
    timestamp: String,
    entity: String,
    entity_id: String,
    kind: String,
    payload: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedAppState {
    notebooks: Vec<NormalizedNotebook>,
    pages: Vec<NormalizedPage>,
    blocks: Vec<NormalizedBlock>,
    #[serde(default)]
    active_notebook_id: String,
    #[serde(default)]
    active_page_id: String,
    #[serde(default)]
    shell: String,
    #[serde(default)]
    theme: String,
    #[serde(default)]
    content_theme: String,
    #[serde(default)]
    open_card_window_block_id: Option<String>,
    #[serde(default)]
    expanded_page_ids: Vec<String>,
    #[serde(default)]
    operations: Vec<NormalizedOperationLogEntry>,
    #[serde(default = "default_true")]
    show_page_metadata: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotebookTreePayload {
    notebooks: Vec<NormalizedNotebook>,
    pages: Vec<NormalizedPage>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageDocumentPayload {
    page: NormalizedPage,
    content: NormalizedPageContent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageRevisionPayload {
    id: i64,
    page_id: String,
    title: String,
    content: NormalizedPageContent,
    created_at: String,
    reason: Option<String>,
    size_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashItemPayload {
    id: i64,
    item_type: String,
    title: String,
    source_id: String,
    parent_id: Option<String>,
    deleted_at: String,
    size_bytes: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashSnapshot {
    item_type: String,
    title: String,
    source_id: String,
    parent_id: Option<String>,
    block_index: Option<usize>,
    notebooks: Vec<NormalizedNotebook>,
    pages: Vec<PageDocumentPayload>,
    blocks: Vec<NormalizedBlock>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PinnedBlockPayload {
    page: NormalizedPage,
    block: NormalizedBlock,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CalendarBlockPayload {
    page: NormalizedPage,
    block: NormalizedBlock,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PageSearchResult {
    page_id: String,
    notebook_id: String,
    title: String,
    snippet: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExternalCardRequest {
    page_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePreferencesPayload {
    active_notebook_id: String,
    active_page_id: String,
    shell: String,
    theme: String,
    content_theme: String,
    open_card_window_block_id: Option<String>,
    expanded_page_ids: Vec<String>,
    show_page_metadata: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePreferencesRequest {
    active_notebook_id: String,
    active_page_id: String,
    shell: String,
    theme: String,
    content_theme: String,
    open_card_window_block_id: Option<String>,
    expanded_page_ids: Vec<String>,
    show_page_metadata: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedImportBatch {
    notebook: NormalizedNotebook,
    pages: Vec<NormalizedPage>,
    blocks: Vec<NormalizedBlock>,
    operation: Option<NormalizedOperationLogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameEntityRequest {
    entity: String,
    entity_id: String,
    name: String,
    operation: Option<NormalizedOperationLogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MovePageRequest {
    page_id: String,
    notebook_id: String,
    parent_id: Option<String>,
    operation: Option<NormalizedOperationLogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateNotebookRequest {
    notebook: NormalizedNotebook,
    initial_page: NormalizedPage,
    operation: Option<NormalizedOperationLogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePageRequest {
    page: NormalizedPage,
    operation: Option<NormalizedOperationLogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePageDocumentRequest {
    page: NormalizedPage,
    blocks: Vec<NormalizedBlock>,
    operation: Option<NormalizedOperationLogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePageMetadataRequest {
    page_id: String,
    metadata: NormalizedPageMetadata,
    operation: Option<NormalizedOperationLogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateNotebookMetadataRequest {
    notebook_id: String,
    metadata: serde_json::Value,
    operation: Option<NormalizedOperationLogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestorePageRevisionRequest {
    page_id: String,
    revision_id: i64,
    operation: Option<NormalizedOperationLogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteBlockRequest {
    page_id: String,
    block_id: String,
    operation: Option<NormalizedOperationLogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreTrashItemRequest {
    trash_id: i64,
    operation: Option<NormalizedOperationLogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeletePageTreeRequest {
    page_id: String,
    fallback_page: Option<NormalizedPage>,
    operation: Option<NormalizedOperationLogEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteNotebookRequest {
    notebook_id: String,
    operation: Option<NormalizedOperationLogEntry>,
}

fn default_normalized_page_content_type() -> String {
    "page_document".to_string()
}

fn default_normalized_page_content_version() -> u32 {
    1
}

fn default_true() -> bool {
    true
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

            CREATE TABLE IF NOT EXISTS workspace_preferences (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              active_notebook_id TEXT NOT NULL DEFAULT '',
              active_page_id TEXT NOT NULL DEFAULT '',
              shell TEXT NOT NULL DEFAULT 'native-garden',
              theme TEXT NOT NULL DEFAULT 'garden',
              content_theme TEXT NOT NULL DEFAULT 'notebook',
              open_card_window_block_id TEXT,
              expanded_page_ids_json TEXT NOT NULL DEFAULT '[]',
              show_page_metadata INTEGER NOT NULL DEFAULT 1,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS notebooks (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              page_ids_json TEXT NOT NULL DEFAULT '[]',
              metadata_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS pages (
              id TEXT PRIMARY KEY,
              notebook_id TEXT NOT NULL,
              parent_id TEXT,
              title TEXT NOT NULL,
              block_ids_json TEXT NOT NULL DEFAULT '[]',
              block_order TEXT NOT NULL DEFAULT 'asc',
              metadata_json TEXT NOT NULL DEFAULT '{}',
              content_json TEXT NOT NULL DEFAULT '{}',
              search_text TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_pages_notebook_id ON pages(notebook_id);
            CREATE INDEX IF NOT EXISTS idx_pages_parent_id ON pages(parent_id);

            CREATE TABLE IF NOT EXISTS page_block_index (
              block_id TEXT PRIMARY KEY,
              page_id TEXT NOT NULL,
              notebook_id TEXT NOT NULL,
              sort_index INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              pinned INTEGER NOT NULL DEFAULT 0,
              collapsed INTEGER NOT NULL DEFAULT 0,
              plain_text TEXT NOT NULL DEFAULT '',
              block_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_page_block_index_page_id ON page_block_index(page_id);
            CREATE INDEX IF NOT EXISTS idx_page_block_index_pinned ON page_block_index(pinned, page_id);
            CREATE INDEX IF NOT EXISTS idx_page_block_index_calendar ON page_block_index(notebook_id, created_at);

            CREATE VIRTUAL TABLE IF NOT EXISTS fts_pages USING fts5(
              page_id UNINDEXED,
              title,
              search_text,
              metadata_text
            );

            CREATE TABLE IF NOT EXISTS operation_log (
              id TEXT PRIMARY KEY,
              timestamp TEXT NOT NULL,
              entity TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS page_revisions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              page_id TEXT NOT NULL,
              title TEXT NOT NULL,
              block_ids_json TEXT NOT NULL,
              block_order TEXT NOT NULL DEFAULT 'asc',
              metadata_json TEXT NOT NULL DEFAULT '{}',
              content_json TEXT NOT NULL,
              content_sha256 TEXT NOT NULL,
              size_bytes INTEGER NOT NULL DEFAULT 0,
              reason TEXT,
              page_updated_at TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_page_revisions_page_created
              ON page_revisions(page_id, created_at DESC, id DESC);

            CREATE TABLE IF NOT EXISTS trash_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              item_type TEXT NOT NULL,
              source_id TEXT NOT NULL,
              title TEXT NOT NULL,
              parent_id TEXT,
              snapshot_json TEXT NOT NULL,
              size_bytes INTEGER NOT NULL DEFAULT 0,
              deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_trash_items_deleted_at
              ON trash_items(deleted_at DESC, id DESC);

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
    ensure_column(
        connection,
        "notebooks",
        "metadata_json",
        "TEXT NOT NULL DEFAULT '{}'",
    )?;
    ensure_column(
        connection,
        "workspace_preferences",
        "show_page_metadata",
        "INTEGER NOT NULL DEFAULT 1",
    )?;
    ensure_page_block_index_backfilled(connection)?;
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let column_rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?;
    let columns = column_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if columns.iter().any(|name| name == column) {
        return Ok(());
    }
    connection
        .execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
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
    let mime_type =
        if mime_type_hint.trim().is_empty() || mime_type_hint == "application/octet-stream" {
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

fn cleanup_orphan_attachments_in_store(
    connection: &Connection,
    app_data_dir: PathBuf,
    referenced_asset_ids: Vec<String>,
) -> Result<AttachmentCleanupResult, String> {
    let referenced: HashSet<String> = referenced_asset_ids.into_iter().collect();
    let attachments_root = app_data_dir.join(ATTACHMENTS_DIR);
    let mut statement = connection
        .prepare("SELECT id, stored_path, size FROM attachments")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                PathBuf::from(row.get::<_, String>(1)?),
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;

    let mut removed_count = 0usize;
    let mut removed_bytes = 0u64;
    for row in rows {
        let (id, stored_path, size) = row.map_err(|error| error.to_string())?;
        if referenced.contains(&id) {
            continue;
        }
        if stored_path.starts_with(&attachments_root) {
            match fs::remove_file(&stored_path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        connection
            .execute("DELETE FROM attachments WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;
        removed_count += 1;
        removed_bytes += size.max(0) as u64;
    }

    Ok(AttachmentCleanupResult {
        removed_count,
        removed_bytes,
    })
}

fn is_asset_hash(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|character| character.is_ascii_hexdigit())
}

fn referenced_asset_ids_from_html(html: &str) -> Vec<String> {
    let mut ids = HashSet::new();
    let mut cursor = 0usize;
    while let Some(offset) = html[cursor..].find("asset_") {
        let start = cursor + offset + "asset_".len();
        let end = start + 64;
        if end <= html.len() {
            let hash = &html[start..end];
            if is_asset_hash(hash) {
                ids.insert(format!("asset_{}", hash.to_ascii_lowercase()));
            }
        }
        cursor = start;
    }
    ids.into_iter().collect()
}

fn referenced_asset_ids_from_database(connection: &Connection) -> Result<Vec<String>, String> {
    let mut ids = HashSet::new();
    let mut statement = connection
        .prepare("SELECT content_json FROM pages")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;

    for row in rows {
        let content_json = row.map_err(|error| error.to_string())?;
        page_content_from_json(&content_json)
            .blocks
            .iter()
            .flat_map(|block| referenced_asset_ids_from_html(&block.content.html))
            .for_each(|id| {
                ids.insert(id);
            });
    }
    let mut trash_statement = connection
        .prepare("SELECT snapshot_json FROM trash_items")
        .map_err(|error| error.to_string())?;
    let trash_rows = trash_statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    for row in trash_rows {
        let snapshot_json = row.map_err(|error| error.to_string())?;
        let Ok(snapshot) = serde_json::from_str::<TrashSnapshot>(&snapshot_json) else {
            continue;
        };
        snapshot
            .pages
            .iter()
            .flat_map(|document| document.content.blocks.iter())
            .chain(snapshot.blocks.iter())
            .flat_map(|block| referenced_asset_ids_from_html(&block.content.html))
            .for_each(|id| {
                ids.insert(id);
            });
    }

    Ok(ids.into_iter().collect())
}

fn cleanup_orphan_attachments_from_database(
    connection: &Connection,
    app_data_dir: PathBuf,
) -> Result<AttachmentCleanupResult, String> {
    let referenced_asset_ids = referenced_asset_ids_from_database(connection)?;
    cleanup_orphan_attachments_in_store(connection, app_data_dir, referenced_asset_ids)
}

fn cleanup_orphan_attachments_after_document_change(connection: &Connection, app: &AppHandle) {
    match app_data_dir(app)
        .and_then(|dir| cleanup_orphan_attachments_from_database(connection, dir))
    {
        Ok(_) => {}
        Err(error) => {
            eprintln!("Could not clean orphan attachments from SQLite documents: {error}")
        }
    }
}

fn normalize_json_value(value: serde_json::Value) -> String {
    serde_json::to_string(&value).unwrap_or_else(|_| "{}".to_string())
}

fn insert_trash_item(connection: &Connection, snapshot: &TrashSnapshot) -> Result<i64, String> {
    let snapshot_json = serde_json::to_string(snapshot).map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            INSERT INTO trash_items (
              item_type, source_id, title, parent_id, snapshot_json, size_bytes, deleted_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
            ",
            params![
                snapshot.item_type,
                snapshot.source_id,
                snapshot.title,
                snapshot.parent_id,
                snapshot_json,
                snapshot_json.len() as i64
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(connection.last_insert_rowid())
}

fn list_trash_items_from_database(
    connection: &Connection,
    limit: Option<u32>,
) -> Result<Vec<TrashItemPayload>, String> {
    let max_results = i64::from(limit.unwrap_or(100).clamp(1, 500));
    let mut statement = connection
        .prepare(
            "
            SELECT id, item_type, title, source_id, parent_id, deleted_at, size_bytes
            FROM trash_items
            ORDER BY deleted_at DESC, id DESC
            LIMIT ?1
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![max_results], |row| {
            Ok(TrashItemPayload {
                id: row.get(0)?,
                item_type: row.get(1)?,
                title: row.get(2)?,
                source_id: row.get(3)?,
                parent_id: row.get(4)?,
                deleted_at: row.get(5)?,
                size_bytes: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_trash_snapshot(connection: &Connection, trash_id: i64) -> Result<TrashSnapshot, String> {
    let snapshot_json = connection
        .query_row(
            "SELECT snapshot_json FROM trash_items WHERE id = ?1",
            params![trash_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(snapshot_json) = snapshot_json else {
        return Err(format!("Trash item not found: {trash_id}"));
    };
    serde_json::from_str::<TrashSnapshot>(&snapshot_json).map_err(|error| error.to_string())
}

fn normalize_text_from_metadata(metadata: &NormalizedPageMetadata) -> String {
    let mut pieces = Vec::new();
    if let Some(source_filename) = &metadata.source_filename {
        pieces.push(source_filename.clone());
    }
    if let Some(date) = &metadata.date {
        pieces.push(date.clone());
    }
    if let Some(status) = &metadata.status {
        pieces.push(status.clone());
    }
    pieces.extend(metadata.tags.iter().cloned());
    pieces.extend(metadata.aliases.iter().cloned());
    pieces.push(normalize_json_value(serde_json::Value::Object(
        metadata.frontmatter.clone(),
    )));
    pieces.join(" ")
}

fn normalize_text_from_blocks(blocks: &[NormalizedBlock]) -> String {
    blocks
        .iter()
        .map(|block| format!("{} {}", block.content.plain_text, block.content.html))
        .collect::<Vec<_>>()
        .join(" ")
}

fn page_content_json_from_blocks(blocks: &[NormalizedBlock]) -> Result<String, String> {
    serde_json::to_string(&NormalizedPageContent {
        content_type: default_normalized_page_content_type(),
        version: default_normalized_page_content_version(),
        blocks: blocks.to_vec(),
    })
    .map_err(|error| error.to_string())
}

fn blocks_from_page_content_json(content_json: &str) -> Vec<NormalizedBlock> {
    if let Ok(document) = serde_json::from_str::<NormalizedPageContent>(content_json) {
        return document.blocks;
    }
    serde_json::from_str::<Vec<NormalizedBlock>>(content_json).unwrap_or_default()
}

fn sha256_text(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn default_page_metadata() -> NormalizedPageMetadata {
    NormalizedPageMetadata {
        source_filename: None,
        tags: vec![],
        date: None,
        status: None,
        aliases: vec![],
        frontmatter: serde_json::Map::new(),
        emoji: None,
    }
}

fn page_content_from_json(content_json: &str) -> NormalizedPageContent {
    if let Ok(document) = serde_json::from_str::<NormalizedPageContent>(content_json) {
        return document;
    }
    NormalizedPageContent {
        content_type: default_normalized_page_content_type(),
        version: default_normalized_page_content_version(),
        blocks: serde_json::from_str::<Vec<NormalizedBlock>>(content_json).unwrap_or_default(),
    }
}

fn refresh_page_block_index(
    connection: &Connection,
    page: &NormalizedPage,
    page_blocks: &[NormalizedBlock],
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM page_block_index WHERE page_id = ?1",
            params![page.id],
        )
        .map_err(|error| error.to_string())?;

    for (index, block) in page_blocks.iter().enumerate() {
        let block_json = serde_json::to_string(block).map_err(|error| error.to_string())?;
        connection
            .execute(
                "
                INSERT INTO page_block_index (
                  block_id, page_id, notebook_id, sort_index, created_at, updated_at,
                  pinned, collapsed, plain_text, block_json
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                ON CONFLICT(block_id) DO UPDATE SET
                  page_id = excluded.page_id,
                  notebook_id = excluded.notebook_id,
                  sort_index = excluded.sort_index,
                  created_at = excluded.created_at,
                  updated_at = excluded.updated_at,
                  pinned = excluded.pinned,
                  collapsed = excluded.collapsed,
                  plain_text = excluded.plain_text,
                  block_json = excluded.block_json
                ",
                params![
                    block.id,
                    page.id,
                    page.notebook_id,
                    index as i64,
                    block.created_at,
                    block.updated_at,
                    if block.pinned { 1 } else { 0 },
                    if block.collapsed { 1 } else { 0 },
                    block.content.plain_text,
                    block_json,
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn rebuild_page_block_index_from_database(connection: &Connection) -> Result<(), String> {
    connection
        .execute("DELETE FROM page_block_index", [])
        .map_err(|error| error.to_string())?;
    for document in list_page_documents_from_database(connection, None)? {
        refresh_page_block_index(connection, &document.page, &document.content.blocks)?;
    }
    Ok(())
}

fn ensure_page_block_index_backfilled(connection: &Connection) -> Result<(), String> {
    let page_count = connection
        .query_row("SELECT COUNT(*) FROM pages", [], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?;
    if page_count == 0 {
        return Ok(());
    }
    let indexed_count = connection
        .query_row("SELECT COUNT(*) FROM page_block_index", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| error.to_string())?;
    let missing_indexed_pages = connection
        .query_row(
            "
            SELECT COUNT(*)
            FROM pages
            WHERE block_ids_json != '[]'
              AND id NOT IN (SELECT DISTINCT page_id FROM page_block_index)
            ",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    if indexed_count == 0 || missing_indexed_pages > 0 {
        rebuild_page_block_index_from_database(connection)?;
    }
    Ok(())
}

fn list_notebooks_from_database(
    connection: &Connection,
) -> Result<Vec<NormalizedNotebook>, String> {
    let mut statement = connection
        .prepare("SELECT id, name, page_ids_json, metadata_json FROM notebooks ORDER BY rowid")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let page_ids_json: String = row.get(2)?;
            let metadata_json: String = row.get(3)?;
            let page_ids = serde_json::from_str::<Vec<String>>(&page_ids_json).unwrap_or_default();
            Ok(NormalizedNotebook {
                id: row.get(0)?,
                name: row.get(1)?,
                page_ids,
                metadata: serde_json::from_str::<serde_json::Value>(&metadata_json)
                    .unwrap_or_else(|_| serde_json::json!({})),
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn normalized_page_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<NormalizedPage> {
    let block_ids_json: String = row.get(4)?;
    let metadata_json: String = row.get(6)?;
    Ok(NormalizedPage {
        id: row.get(0)?,
        notebook_id: row.get(1)?,
        parent_id: row.get(2)?,
        title: row.get(3)?,
        block_ids: serde_json::from_str::<Vec<String>>(&block_ids_json).unwrap_or_default(),
        block_order: row.get(5)?,
        metadata: serde_json::from_str::<NormalizedPageMetadata>(&metadata_json)
            .unwrap_or_else(|_| default_page_metadata()),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn list_pages_from_database(connection: &Connection) -> Result<Vec<NormalizedPage>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, notebook_id, parent_id, title, block_ids_json, block_order,
                   metadata_json, created_at, updated_at
            FROM pages
            ORDER BY rowid
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], normalized_page_from_row)
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn insert_page_revision_if_changed(
    connection: &Connection,
    page_id: &str,
    next_content_json: &str,
    reason: Option<&str>,
) -> Result<(), String> {
    let existing = connection
        .query_row(
            "
            SELECT title, block_ids_json, block_order, metadata_json, content_json, updated_at
            FROM pages
            WHERE id = ?1
            ",
            params![page_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((title, block_ids_json, block_order, metadata_json, content_json, updated_at)) =
        existing
    else {
        return Ok(());
    };
    if content_json == next_content_json {
        return Ok(());
    }

    let content_hash = sha256_text(&content_json);
    connection
        .execute(
            "
            INSERT INTO page_revisions (
              page_id, title, block_ids_json, block_order, metadata_json, content_json,
              content_sha256, size_bytes, reason, page_updated_at, created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, CURRENT_TIMESTAMP)
            ",
            params![
                page_id,
                title,
                block_ids_json,
                block_order,
                metadata_json,
                content_json,
                content_hash,
                content_json.len() as i64,
                reason,
                updated_at
            ],
        )
        .map_err(|error| error.to_string())?;
    prune_page_revisions(connection, page_id)
}

fn prune_page_revisions(connection: &Connection, page_id: &str) -> Result<(), String> {
    connection
        .execute(
            "
            DELETE FROM page_revisions
            WHERE page_id = ?1
              AND id NOT IN (
                SELECT id
                FROM page_revisions
                WHERE page_id = ?1
                ORDER BY created_at DESC, id DESC
                LIMIT ?2
              )
            ",
            params![page_id, PAGE_REVISION_LIMIT],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn load_page_metadata_from_database(
    connection: &Connection,
    page_id: &str,
) -> Result<Option<NormalizedPage>, String> {
    connection
        .query_row(
            "
            SELECT id, notebook_id, parent_id, title, block_ids_json, block_order,
                   metadata_json, created_at, updated_at
            FROM pages
            WHERE id = ?1
            ",
            params![page_id],
            normalized_page_from_row,
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn fts_query_from_search_text(query: &str) -> Option<String> {
    let tokens = query
        .split_whitespace()
        .map(|token| token.trim_matches(|character: char| character.is_ascii_punctuation()))
        .filter(|token| !token.is_empty())
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        let fallback = query.trim();
        if fallback.is_empty() {
            return None;
        }
        return Some(format!("\"{}\"", fallback.replace('"', "\"\"")));
    }
    Some(tokens.join(" "))
}

fn create_external_card_block_in_database(
    connection: &mut Connection,
    page_id: &str,
) -> Result<String, String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let Some(mut document) = load_page_document_from_database(&transaction, page_id)? else {
        return Err(format!("Page not found: {page_id}"));
    };
    let timestamp: String = transaction
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let id_suffix = timestamp
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>();
    let block_id = format!("block_card_{id_suffix}");
    let block = NormalizedBlock {
        id: block_id.clone(),
        page_id: document.page.id.clone(),
        content: NormalizedRichContent {
            html: "<p></p>".to_string(),
            plain_text: "".to_string(),
        },
        collapsed: false,
        pinned: true,
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
    };
    document.page.block_ids.push(block_id.clone());
    document.page.updated_at = timestamp;
    document.content.blocks.push(block);
    upsert_page_document(&transaction, &document.page, &document.content.blocks)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(block_id)
}

fn upsert_notebook(connection: &Connection, notebook: &NormalizedNotebook) -> Result<(), String> {
    connection
        .execute(
            "
        INSERT INTO notebooks (id, name, page_ids_json, metadata_json, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          page_ids_json = excluded.page_ids_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
        ",
            params![
                notebook.id,
                notebook.name,
                serde_json::to_string(&notebook.page_ids).map_err(|error| error.to_string())?,
                serde_json::to_string(&notebook.metadata).map_err(|error| error.to_string())?
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn upsert_page_document(
    connection: &Connection,
    page: &NormalizedPage,
    page_blocks: &[NormalizedBlock],
) -> Result<(), String> {
    let normalized_page_blocks = page_blocks
        .iter()
        .map(|block| NormalizedBlock {
            page_id: page.id.clone(),
            ..block.clone()
        })
        .collect::<Vec<_>>();
    let block_ids_json =
        serde_json::to_string(&page.block_ids).map_err(|error| error.to_string())?;
    let metadata_json = serde_json::to_string(&page.metadata).map_err(|error| error.to_string())?;
    let content_json = page_content_json_from_blocks(&normalized_page_blocks)?;
    let search_text = normalize_text_from_blocks(&normalized_page_blocks);
    let metadata_text = normalize_text_from_metadata(&page.metadata);

    connection
        .execute(
            "
        INSERT INTO pages (
          id, notebook_id, parent_id, title, block_ids_json, block_order,
          metadata_json, content_json, search_text, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET
          notebook_id = excluded.notebook_id,
          parent_id = excluded.parent_id,
          title = excluded.title,
          block_ids_json = excluded.block_ids_json,
          block_order = excluded.block_order,
          metadata_json = excluded.metadata_json,
          content_json = excluded.content_json,
          search_text = excluded.search_text,
          updated_at = excluded.updated_at
        ",
            params![
                page.id,
                page.notebook_id,
                page.parent_id,
                page.title,
                block_ids_json,
                page.block_order
                    .clone()
                    .unwrap_or_else(|| "asc".to_string()),
                metadata_json,
                content_json,
                search_text,
                page.created_at,
                page.updated_at,
            ],
        )
        .map_err(|error| error.to_string())?;

    connection
        .execute("DELETE FROM fts_pages WHERE page_id = ?1", params![page.id])
        .map_err(|error| error.to_string())?;
    connection.execute(
        "INSERT INTO fts_pages (page_id, title, search_text, metadata_text) VALUES (?1, ?2, ?3, ?4)",
        params![page.id, page.title, search_text, metadata_text],
    ).map_err(|error| error.to_string())?;
    refresh_page_block_index(connection, page, &normalized_page_blocks)?;
    Ok(())
}

fn insert_operation(
    connection: &Connection,
    operation: &NormalizedOperationLogEntry,
) -> Result<(), String> {
    connection
        .execute(
            "
        INSERT INTO operation_log (id, timestamp, entity, entity_id, kind, payload_json)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(id) DO UPDATE SET
          timestamp = excluded.timestamp,
          entity = excluded.entity,
          entity_id = excluded.entity_id,
          kind = excluded.kind,
          payload_json = excluded.payload_json
        ",
            params![
                operation.id,
                operation.timestamp,
                operation.entity,
                operation.entity_id,
                operation.kind,
                normalize_json_value(operation.payload.clone())
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
fn rebuild_normalized_tables(
    connection: &Connection,
    state: &NormalizedAppState,
) -> Result<(), String> {
    connection
        .execute("DELETE FROM fts_pages", [])
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM page_block_index", [])
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM pages", [])
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM notebooks", [])
        .map_err(|error| error.to_string())?;

    for notebook in &state.notebooks {
        upsert_notebook(connection, notebook)?;
    }

    let blocks_by_page = state.blocks.iter().fold(
        std::collections::HashMap::<String, Vec<NormalizedBlock>>::new(),
        |mut acc, block| {
            acc.entry(block.page_id.clone())
                .or_default()
                .push(block.clone());
            acc
        },
    );

    for page in &state.pages {
        let page_blocks = blocks_by_page.get(&page.id).cloned().unwrap_or_default();
        upsert_page_document(connection, page, &page_blocks)?;
    }

    connection
        .execute("DELETE FROM operation_log", [])
        .map_err(|error| error.to_string())?;
    for operation in &state.operations {
        insert_operation(connection, operation)?;
    }

    Ok(())
}

fn persist_import_batch_in_transaction(
    connection: &mut Connection,
    batch: &NormalizedImportBatch,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    upsert_notebook(&transaction, &batch.notebook)?;

    let blocks_by_page = batch.blocks.iter().fold(
        std::collections::HashMap::<String, Vec<NormalizedBlock>>::new(),
        |mut acc, block| {
            acc.entry(block.page_id.clone())
                .or_default()
                .push(block.clone());
            acc
        },
    );
    for page in &batch.pages {
        let page_blocks = blocks_by_page.get(&page.id).cloned().unwrap_or_default();
        upsert_page_document(&transaction, page, &page_blocks)?;
    }
    if let Some(operation) = &batch.operation {
        insert_operation(&transaction, operation)?;
    }

    transaction.commit().map_err(|error| error.to_string())
}

fn rename_entity_in_transaction(
    connection: &mut Connection,
    request: &RenameEntityRequest,
) -> Result<(), String> {
    let next_name = request.name.trim();
    if next_name.is_empty() {
        return Err("Name cannot be empty".to_string());
    }

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    match request.entity.as_str() {
        "notebook" => {
            let affected = transaction
                .execute(
                    "UPDATE notebooks SET name = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                    params![next_name, request.entity_id],
                )
                .map_err(|error| error.to_string())?;
            if affected == 0 {
                return Err(format!("Notebook not found: {}", request.entity_id));
            }
        }
        "page" => {
            let affected = transaction
                .execute(
                    "UPDATE pages SET title = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                    params![next_name, request.entity_id],
                )
                .map_err(|error| error.to_string())?;
            if affected == 0 {
                return Err(format!("Page not found: {}", request.entity_id));
            }
            transaction
                .execute(
                    "UPDATE fts_pages SET title = ?1 WHERE page_id = ?2",
                    params![next_name, request.entity_id],
                )
                .map_err(|error| error.to_string())?;
        }
        other => return Err(format!("Unsupported rename entity: {other}")),
    }

    if let Some(operation) = &request.operation {
        insert_operation(&transaction, operation)?;
    }

    transaction.commit().map_err(|error| error.to_string())
}

fn move_page_in_transaction(
    connection: &mut Connection,
    request: &MovePageRequest,
) -> Result<(), String> {
    if request.parent_id.as_deref() == Some(request.page_id.as_str()) {
        return Err("Page cannot be moved under itself".to_string());
    }

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let page_exists = transaction
        .query_row(
            "SELECT COUNT(*) FROM pages WHERE id = ?1",
            params![request.page_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?
        > 0;
    if !page_exists {
        return Err(format!("Page not found: {}", request.page_id));
    }
    let target_notebook_exists = transaction
        .query_row(
            "SELECT COUNT(*) FROM notebooks WHERE id = ?1",
            params![request.notebook_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?
        > 0;
    if !target_notebook_exists {
        return Err(format!("Notebook not found: {}", request.notebook_id));
    }

    if let Some(parent_id) = &request.parent_id {
        let parent_notebook_id = transaction
            .query_row(
                "SELECT notebook_id FROM pages WHERE id = ?1",
                params![parent_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some(parent_notebook_id) = parent_notebook_id else {
            return Err(format!("Parent page not found: {parent_id}"));
        };
        if parent_notebook_id != request.notebook_id {
            return Err("Parent page must be in the target notebook".to_string());
        }
        let mut cursor = Some(parent_id.clone());
        while let Some(current_id) = cursor {
            if current_id == request.page_id {
                return Err("Page cannot be moved under its descendant".to_string());
            }
            cursor = transaction
                .query_row(
                    "SELECT parent_id FROM pages WHERE id = ?1",
                    params![current_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()
                .map_err(|error| error.to_string())?
                .flatten();
        }
    }

    let moved_page_ids = transaction
        .prepare(
            "WITH RECURSIVE descendants(id) AS (
                SELECT ?1
                UNION ALL
                SELECT pages.id FROM pages JOIN descendants ON pages.parent_id = descendants.id
              )
              SELECT id FROM descendants",
        )
        .map_err(|error| error.to_string())?
        .query_map(params![request.page_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let notebook_ids: std::collections::HashSet<String> = moved_page_ids
        .iter()
        .map(|page_id| {
            transaction
                .query_row(
                    "SELECT notebook_id FROM pages WHERE id = ?1",
                    params![page_id],
                    |row| row.get::<_, String>(0),
                )
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?
        .into_iter()
        .chain(std::iter::once(request.notebook_id.clone()))
        .collect();

    transaction
        .execute(
            "UPDATE pages SET notebook_id = ?1, parent_id = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
            params![request.notebook_id, request.parent_id, request.page_id],
        )
        .map_err(|error| error.to_string())?;
    for page_id in moved_page_ids.iter().filter(|page_id| *page_id != &request.page_id) {
        transaction
            .execute(
                "UPDATE pages SET notebook_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                params![request.notebook_id, page_id],
            )
            .map_err(|error| error.to_string())?;
    }

    for notebook_id in notebook_ids {
        let page_ids: Vec<String> = transaction
            .prepare("SELECT id FROM pages WHERE notebook_id = ?1 ORDER BY created_at ASC, rowid ASC")
            .map_err(|error| error.to_string())?
            .query_map(params![notebook_id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE notebooks SET page_ids_json = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                params![
                    serde_json::to_string(&page_ids).map_err(|error| error.to_string())?,
                    notebook_id
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    if let Some(operation) = &request.operation {
        insert_operation(&transaction, operation)?;
    }

    transaction.commit().map_err(|error| error.to_string())
}

fn create_notebook_in_transaction(
    connection: &mut Connection,
    request: &CreateNotebookRequest,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    upsert_notebook(&transaction, &request.notebook)?;
    upsert_page_document(&transaction, &request.initial_page, &[])?;
    if let Some(operation) = &request.operation {
        insert_operation(&transaction, operation)?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn create_page_in_transaction(
    connection: &mut Connection,
    request: &CreatePageRequest,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let existing_page_ids_json = transaction
        .query_row(
            "SELECT page_ids_json FROM notebooks WHERE id = ?1",
            params![request.page.notebook_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(existing_page_ids_json) = existing_page_ids_json else {
        return Err(format!("Notebook not found: {}", request.page.notebook_id));
    };

    let mut page_ids =
        serde_json::from_str::<Vec<String>>(&existing_page_ids_json).unwrap_or_default();
    if !page_ids.iter().any(|id| id == &request.page.id) {
        page_ids.push(request.page.id.clone());
    }
    transaction
        .execute(
            "UPDATE notebooks SET page_ids_json = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![
                serde_json::to_string(&page_ids).map_err(|error| error.to_string())?,
                request.page.notebook_id
            ],
        )
        .map_err(|error| error.to_string())?;
    upsert_page_document(&transaction, &request.page, &[])?;
    if let Some(operation) = &request.operation {
        insert_operation(&transaction, operation)?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn save_page_document_in_transaction(
    connection: &mut Connection,
    request: &SavePageDocumentRequest,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let Some(existing_page) = load_page_metadata_from_database(&transaction, &request.page.id)?
    else {
        return Err(format!("Page not found: {}", request.page.id));
    };
    if existing_page.notebook_id != request.page.notebook_id {
        return Err(format!("Page notebook mismatch: {}", request.page.id));
    }
    let next_content_json = page_content_json_from_blocks(&request.blocks)?;
    let existing_blocks = blocks_from_page_content_json(
        &transaction
            .query_row(
                "SELECT content_json FROM pages WHERE id = ?1",
                params![request.page.id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| error.to_string())?,
    );
    let allows_empty_document = request
        .operation
        .as_ref()
        .map(|operation| operation.kind == "block.delete")
        .unwrap_or(false);
    if !existing_blocks.is_empty() && request.blocks.is_empty() && !allows_empty_document {
        return Err(format!(
            "Refusing to overwrite non-empty page with an empty document: {}",
            request.page.id
        ));
    }
    insert_page_revision_if_changed(
        &transaction,
        &request.page.id,
        &next_content_json,
        request
            .operation
            .as_ref()
            .map(|operation| operation.kind.as_str()),
    )?;

    let page_for_save = NormalizedPage {
        metadata: request.page.metadata.clone(),
        block_ids: request.page.block_ids.clone(),
        block_order: request.page.block_order.clone(),
        updated_at: request.page.updated_at.clone(),
        ..existing_page
    };
    upsert_page_document(&transaction, &page_for_save, &request.blocks)?;
    if let Some(operation) = &request.operation {
        insert_operation(&transaction, operation)?;
    }

    transaction.commit().map_err(|error| error.to_string())
}

fn update_page_metadata_in_transaction(
    connection: &mut Connection,
    request: &UpdatePageMetadataRequest,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    if load_page_metadata_from_database(&transaction, &request.page_id)?.is_none() {
        return Err(format!("Page not found: {}", request.page_id));
    }
    transaction
        .execute(
            "
            UPDATE pages
            SET metadata_json = ?1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?2
            ",
            params![
                serde_json::to_string(&request.metadata).map_err(|error| error.to_string())?,
                request.page_id
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE fts_pages SET metadata_text = ?1 WHERE page_id = ?2",
            params![
                normalize_text_from_metadata(&request.metadata),
                request.page_id
            ],
        )
        .map_err(|error| error.to_string())?;
    if let Some(operation) = &request.operation {
        insert_operation(&transaction, operation)?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn update_notebook_metadata_in_transaction(
    connection: &mut Connection,
    request: &UpdateNotebookMetadataRequest,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let affected = transaction
        .execute(
            "
            UPDATE notebooks
            SET metadata_json = ?1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?2
            ",
            params![
                serde_json::to_string(&request.metadata).map_err(|error| error.to_string())?,
                request.notebook_id
            ],
        )
        .map_err(|error| error.to_string())?;
    if affected == 0 {
        return Err(format!("Notebook not found: {}", request.notebook_id));
    }
    if let Some(operation) = &request.operation {
        insert_operation(&transaction, operation)?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn list_page_revisions_from_database(
    connection: &Connection,
    page_id: &str,
    limit: Option<u32>,
) -> Result<Vec<PageRevisionPayload>, String> {
    let max_results = i64::from(limit.unwrap_or(PAGE_REVISION_LIMIT as u32).clamp(1, 100));
    let mut statement = connection
        .prepare(
            "
            SELECT id, page_id, title, content_json, created_at, reason, size_bytes
            FROM page_revisions
            WHERE page_id = ?1
            ORDER BY created_at DESC, id DESC
            LIMIT ?2
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![page_id, max_results], |row| {
            let content_json: String = row.get(3)?;
            Ok(PageRevisionPayload {
                id: row.get(0)?,
                page_id: row.get(1)?,
                title: row.get(2)?,
                content: page_content_from_json(&content_json),
                created_at: row.get(4)?,
                reason: row.get(5)?,
                size_bytes: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn restore_page_revision_in_transaction(
    connection: &mut Connection,
    request: &RestorePageRevisionRequest,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let Some(existing_page) = load_page_metadata_from_database(&transaction, &request.page_id)?
    else {
        return Err(format!("Page not found: {}", request.page_id));
    };
    let revision = transaction
        .query_row(
            "
            SELECT block_ids_json, block_order, content_json
            FROM page_revisions
            WHERE id = ?1 AND page_id = ?2
            ",
            params![request.revision_id, request.page_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((block_ids_json, block_order, content_json)) = revision else {
        return Err(format!("Page revision not found: {}", request.revision_id));
    };
    insert_page_revision_if_changed(
        &transaction,
        &request.page_id,
        &content_json,
        Some("page.restore_revision"),
    )?;
    let restored_blocks = blocks_from_page_content_json(&content_json);
    let restored_page = NormalizedPage {
        block_ids: serde_json::from_str::<Vec<String>>(&block_ids_json).unwrap_or_else(|_| {
            restored_blocks
                .iter()
                .map(|block| block.id.clone())
                .collect::<Vec<_>>()
        }),
        block_order: Some(block_order),
        updated_at: request
            .operation
            .as_ref()
            .map(|operation| operation.timestamp.clone())
            .unwrap_or_else(|| existing_page.updated_at.clone()),
        ..existing_page
    };
    upsert_page_document(&transaction, &restored_page, &restored_blocks)?;
    if let Some(operation) = &request.operation {
        insert_operation(&transaction, operation)?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn delete_block_in_transaction(
    connection: &mut Connection,
    request: &DeleteBlockRequest,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let Some(document) = load_page_document_from_database(&transaction, &request.page_id)? else {
        return Err(format!("Page not found: {}", request.page_id));
    };
    let Some(index) = document
        .content
        .blocks
        .iter()
        .position(|block| block.id == request.block_id)
    else {
        return Err(format!("Block not found: {}", request.block_id));
    };
    let deleted_block = document.content.blocks[index].clone();
    insert_trash_item(
        &transaction,
        &TrashSnapshot {
            item_type: "block".to_string(),
            title: deleted_block
                .content
                .plain_text
                .chars()
                .take(80)
                .collect::<String>(),
            source_id: deleted_block.id.clone(),
            parent_id: Some(document.page.id.clone()),
            block_index: Some(index),
            notebooks: vec![],
            pages: vec![],
            blocks: vec![deleted_block],
        },
    )?;
    let mut next_blocks = document.content.blocks;
    next_blocks.remove(index);
    let next_page = NormalizedPage {
        block_ids: next_blocks.iter().map(|block| block.id.clone()).collect(),
        updated_at: request
            .operation
            .as_ref()
            .map(|operation| operation.timestamp.clone())
            .unwrap_or_else(|| document.page.updated_at.clone()),
        ..document.page
    };
    let next_content_json = page_content_json_from_blocks(&next_blocks)?;
    insert_page_revision_if_changed(
        &transaction,
        &next_page.id,
        &next_content_json,
        request
            .operation
            .as_ref()
            .map(|operation| operation.kind.as_str()),
    )?;
    upsert_page_document(&transaction, &next_page, &next_blocks)?;
    if let Some(operation) = &request.operation {
        insert_operation(&transaction, operation)?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn restore_trash_item_in_transaction(
    connection: &mut Connection,
    request: &RestoreTrashItemRequest,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let snapshot = load_trash_snapshot(&transaction, request.trash_id)?;
    match snapshot.item_type.as_str() {
        "notebook" => {
            for notebook in &snapshot.notebooks {
                upsert_notebook(&transaction, notebook)?;
            }
            for document in &snapshot.pages {
                upsert_page_document(&transaction, &document.page, &document.content.blocks)?;
            }
        }
        "page" => {
            let Some(first_document) = snapshot.pages.first() else {
                return Err("Trash page snapshot is empty".to_string());
            };
            let notebook_id = first_document.page.notebook_id.clone();
            let notebook_exists = transaction
                .query_row(
                    "SELECT COUNT(*) FROM notebooks WHERE id = ?1",
                    params![notebook_id],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| error.to_string())?
                > 0;
            if !notebook_exists {
                return Err(format!(
                    "Cannot restore page because notebook is missing: {}",
                    first_document.page.notebook_id
                ));
            }
            for document in &snapshot.pages {
                upsert_page_document(&transaction, &document.page, &document.content.blocks)?;
            }
            let current_page_ids = transaction
                .query_row(
                    "SELECT page_ids_json FROM notebooks WHERE id = ?1",
                    params![notebook_id],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|error| error.to_string())
                .and_then(|raw| {
                    serde_json::from_str::<Vec<String>>(&raw).map_err(|error| error.to_string())
                })?;
            let restored_page_ids = snapshot
                .pages
                .iter()
                .map(|document| document.page.id.clone())
                .collect::<std::collections::HashSet<_>>();
            let snapshot_page_ids = snapshot
                .notebooks
                .first()
                .filter(|notebook| notebook.id == notebook_id)
                .map(|notebook| notebook.page_ids.clone())
                .unwrap_or_else(|| {
                    snapshot
                        .pages
                        .iter()
                        .map(|document| document.page.id.clone())
                        .collect()
                });
            let mut next_page_ids = Vec::new();
            for page_id in snapshot_page_ids {
                if (restored_page_ids.contains(&page_id) || current_page_ids.contains(&page_id))
                    && !next_page_ids.contains(&page_id)
                {
                    next_page_ids.push(page_id);
                }
            }
            for page_id in current_page_ids {
                if !next_page_ids.contains(&page_id) {
                    next_page_ids.push(page_id);
                }
            }
            for page_id in restored_page_ids {
                if !next_page_ids.contains(&page_id) {
                    next_page_ids.push(page_id);
                }
            }
            transaction
                .execute(
                    "UPDATE notebooks SET page_ids_json = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                    params![
                        serde_json::to_string(&next_page_ids)
                            .map_err(|error| error.to_string())?,
                        notebook_id
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        "block" => {
            let Some(block) = snapshot.blocks.first().cloned() else {
                return Err("Trash block snapshot is empty".to_string());
            };
            let Some(document) = load_page_document_from_database(&transaction, &block.page_id)?
            else {
                return Err(format!(
                    "Cannot restore block because page is missing: {}",
                    block.page_id
                ));
            };
            if document
                .content
                .blocks
                .iter()
                .any(|candidate| candidate.id == block.id)
            {
                return Err(format!("Block already exists: {}", block.id));
            }
            let mut next_blocks = document.content.blocks;
            let insert_index = snapshot
                .block_index
                .unwrap_or(next_blocks.len())
                .min(next_blocks.len());
            next_blocks.insert(insert_index, block);
            let next_page = NormalizedPage {
                block_ids: next_blocks.iter().map(|block| block.id.clone()).collect(),
                updated_at: request
                    .operation
                    .as_ref()
                    .map(|operation| operation.timestamp.clone())
                    .unwrap_or_else(|| document.page.updated_at.clone()),
                ..document.page
            };
            let next_content_json = page_content_json_from_blocks(&next_blocks)?;
            insert_page_revision_if_changed(
                &transaction,
                &next_page.id,
                &next_content_json,
                request
                    .operation
                    .as_ref()
                    .map(|operation| operation.kind.as_str()),
            )?;
            upsert_page_document(&transaction, &next_page, &next_blocks)?;
        }
        other => return Err(format!("Unsupported trash item type: {other}")),
    }

    transaction
        .execute(
            "DELETE FROM trash_items WHERE id = ?1",
            params![request.trash_id],
        )
        .map_err(|error| error.to_string())?;
    if let Some(operation) = &request.operation {
        insert_operation(&transaction, operation)?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn empty_trash_in_transaction(
    connection: &mut Connection,
) -> Result<AttachmentCleanupResult, String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let (removed_count, removed_bytes) = transaction
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(size_bytes), 0) FROM trash_items",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM trash_items", [])
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(AttachmentCleanupResult {
        removed_count: removed_count.max(0) as usize,
        removed_bytes: removed_bytes.max(0) as u64,
    })
}

fn delete_page_tree_in_transaction(
    connection: &mut Connection,
    request: &DeletePageTreeRequest,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let root_page = transaction
        .query_row(
            "SELECT id, notebook_id FROM pages WHERE id = ?1",
            params![request.page_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((root_page_id, notebook_id)) = root_page else {
        return Err(format!("Page not found: {}", request.page_id));
    };

    let deleted_page_ids = transaction
        .prepare(
            "WITH RECURSIVE descendants(id) AS (
                SELECT ?1
                UNION ALL
                SELECT pages.id FROM pages JOIN descendants ON pages.parent_id = descendants.id
              )
              SELECT id FROM descendants",
        )
        .map_err(|error| error.to_string())?
        .query_map(params![root_page_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let deleted_page_set = deleted_page_ids
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let deleted_documents = load_page_documents_from_database(&transaction, &deleted_page_ids)?;
    let root_document = deleted_documents
        .iter()
        .find(|document| document.page.id == root_page_id);
    let snapshot_notebook = list_notebooks_from_database(&transaction)?
        .into_iter()
        .find(|notebook| notebook.id == notebook_id);
    insert_trash_item(
        &transaction,
        &TrashSnapshot {
            item_type: "page".to_string(),
            title: root_document
                .map(|document| document.page.title.clone())
                .unwrap_or_else(|| "Deleted page".to_string()),
            source_id: root_page_id.clone(),
            parent_id: root_document.and_then(|document| document.page.parent_id.clone()),
            block_index: None,
            notebooks: snapshot_notebook.into_iter().collect(),
            pages: deleted_documents.clone(),
            blocks: vec![],
        },
    )?;

    for deleted_page_id in &deleted_page_ids {
        transaction
            .execute(
                "DELETE FROM fts_pages WHERE page_id = ?1",
                params![deleted_page_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM page_block_index WHERE page_id = ?1",
                params![deleted_page_id],
            )
            .map_err(|error| error.to_string())?;
    }
    for deleted_page_id in &deleted_page_ids {
        transaction
            .execute(
                "DELETE FROM pages WHERE notebook_id = ?1 AND id = ?2",
                params![notebook_id, deleted_page_id],
            )
            .map_err(|error| error.to_string())?;
    }

    let mut page_ids = transaction
        .query_row(
            "SELECT page_ids_json FROM notebooks WHERE id = ?1",
            params![notebook_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| error.to_string())
        .and_then(|raw| {
            serde_json::from_str::<Vec<String>>(&raw).map_err(|error| error.to_string())
        })?;
    page_ids.retain(|id| !deleted_page_set.contains(id));

    if page_ids.is_empty() && request.fallback_page.is_none() {
        return Err(format!(
            "Deleting page tree would leave notebook without pages: {notebook_id}"
        ));
    }

    if let Some(fallback_page) = request
        .fallback_page
        .as_ref()
        .filter(|page| page.notebook_id == notebook_id && page_ids.is_empty())
    {
        page_ids.push(fallback_page.id.clone());
        upsert_page_document(&transaction, fallback_page, &[])?;
    }

    transaction
        .execute(
            "UPDATE notebooks SET page_ids_json = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![
                serde_json::to_string(&page_ids).map_err(|error| error.to_string())?,
                notebook_id
            ],
        )
        .map_err(|error| error.to_string())?;

    if let Some(operation) = &request.operation {
        insert_operation(&transaction, operation)?;
    }

    transaction.commit().map_err(|error| error.to_string())
}

fn delete_notebook_in_transaction(
    connection: &mut Connection,
    request: &DeleteNotebookRequest,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let notebook_count = transaction
        .query_row("SELECT COUNT(*) FROM notebooks", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| error.to_string())?;
    if notebook_count <= 1 {
        return Err("Cannot delete the last notebook".to_string());
    }

    let notebook_exists = transaction
        .query_row(
            "SELECT COUNT(*) FROM notebooks WHERE id = ?1",
            params![request.notebook_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?
        > 0;
    if !notebook_exists {
        return Err(format!("Notebook not found: {}", request.notebook_id));
    }

    let deleted_pages = transaction
        .prepare("SELECT id FROM pages WHERE notebook_id = ?1")
        .map_err(|error| error.to_string())?
        .query_map(params![request.notebook_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let notebook = list_notebooks_from_database(&transaction)?
        .into_iter()
        .find(|notebook| notebook.id == request.notebook_id)
        .ok_or_else(|| format!("Notebook not found: {}", request.notebook_id))?;
    let deleted_documents = load_page_documents_from_database(&transaction, &deleted_pages)?;
    insert_trash_item(
        &transaction,
        &TrashSnapshot {
            item_type: "notebook".to_string(),
            title: notebook.name.clone(),
            source_id: notebook.id.clone(),
            parent_id: None,
            block_index: None,
            notebooks: vec![notebook],
            pages: deleted_documents,
            blocks: vec![],
        },
    )?;

    for deleted_page_id in &deleted_pages {
        transaction
            .execute(
                "DELETE FROM fts_pages WHERE page_id = ?1",
                params![deleted_page_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM page_block_index WHERE page_id = ?1",
                params![deleted_page_id],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction
        .execute(
            "DELETE FROM pages WHERE notebook_id = ?1",
            params![request.notebook_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM notebooks WHERE id = ?1",
            params![request.notebook_id],
        )
        .map_err(|error| error.to_string())?;

    if let Some(operation) = &request.operation {
        insert_operation(&transaction, operation)?;
    }

    transaction.commit().map_err(|error| error.to_string())
}

fn read_normalized_state_json(connection: &Connection) -> Result<Option<String>, String> {
    let notebook_count = connection
        .query_row("SELECT COUNT(*) FROM notebooks", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| error.to_string())?;
    if notebook_count == 0 {
        return Ok(None);
    }

    let notebooks = list_notebooks_from_database(connection)?;
    let pages = list_pages_from_database(connection)?;

    let mut block_statement = connection
        .prepare("SELECT content_json FROM pages ORDER BY rowid")
        .map_err(|error| error.to_string())?;
    let block_rows = block_statement
        .query_map([], |row| {
            let content_json: String = row.get(0)?;
            let blocks = blocks_from_page_content_json(&content_json);
            Ok(blocks)
        })
        .map_err(|error| error.to_string())?;
    let blocks = block_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();

    let mut operation_statement = connection
        .prepare("SELECT id, timestamp, entity, entity_id, kind, payload_json FROM operation_log ORDER BY rowid")
        .map_err(|error| error.to_string())?;
    let operation_rows = operation_statement
        .query_map([], |row| {
            let payload_json: String = row.get(5)?;
            let payload = serde_json::from_str::<serde_json::Value>(&payload_json)
                .unwrap_or(serde_json::Value::Null);
            Ok(NormalizedOperationLogEntry {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                entity: row.get(2)?,
                entity_id: row.get(3)?,
                kind: row.get(4)?,
                payload,
            })
        })
        .map_err(|error| error.to_string())?;
    let operations = operation_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let preferences = read_workspace_preferences(connection)?;

    let state = NormalizedAppState {
        notebooks,
        pages,
        blocks,
        active_notebook_id: preferences.active_notebook_id,
        active_page_id: preferences.active_page_id,
        shell: preferences.shell,
        theme: preferences.theme,
        content_theme: preferences.content_theme,
        open_card_window_block_id: preferences.open_card_window_block_id,
        expanded_page_ids: preferences.expanded_page_ids,
        operations,
        show_page_metadata: preferences.show_page_metadata,
    };

    serde_json::to_string(&state)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn read_workspace_preferences(
    connection: &Connection,
) -> Result<WorkspacePreferencesPayload, String> {
    let preferences_row = connection
        .query_row(
            "SELECT active_notebook_id, active_page_id, shell, theme, content_theme, open_card_window_block_id, expanded_page_ids_json, show_page_metadata FROM workspace_preferences WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let snapshot_json = if preferences_row.is_none() {
        connection
            .query_row("SELECT state_json FROM app_state WHERE id = 1", [], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(|error| error.to_string())?
    } else {
        None
    };
    let snapshot =
        snapshot_json.and_then(|raw| serde_json::from_str::<NormalizedAppState>(&raw).ok());

    let (
        active_notebook_id,
        active_page_id,
        shell,
        theme,
        content_theme,
        open_card_window_block_id,
        expanded_page_ids,
        show_page_metadata,
    ) = if let Some((
        active_notebook_id,
        active_page_id,
        shell,
        theme,
        content_theme,
        open_card_window_block_id,
        expanded_page_ids_json,
        show_page_metadata,
    )) = preferences_row
    {
        (
            active_notebook_id,
            active_page_id,
            shell,
            theme,
            content_theme,
            open_card_window_block_id,
            serde_json::from_str::<Vec<String>>(&expanded_page_ids_json).unwrap_or_default(),
            show_page_metadata != 0,
        )
    } else {
        (
            snapshot
                .as_ref()
                .map(|state| state.active_notebook_id.clone())
                .unwrap_or_default(),
            snapshot
                .as_ref()
                .map(|state| state.active_page_id.clone())
                .unwrap_or_default(),
            snapshot
                .as_ref()
                .map(|state| state.shell.clone())
                .unwrap_or_else(|| "native-garden".to_string()),
            snapshot
                .as_ref()
                .map(|state| state.theme.clone())
                .unwrap_or_else(|| "garden".to_string()),
            snapshot
                .as_ref()
                .map(|state| state.content_theme.clone())
                .unwrap_or_else(|| "notebook".to_string()),
            snapshot
                .as_ref()
                .and_then(|state| state.open_card_window_block_id.clone()),
            snapshot
                .as_ref()
                .map(|state| state.expanded_page_ids.clone())
                .unwrap_or_default(),
            true,
        )
    };
    let notebook_exists = if active_notebook_id.is_empty() {
        false
    } else {
        connection
            .query_row(
                "SELECT 1 FROM notebooks WHERE id = ?1 LIMIT 1",
                params![&active_notebook_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .is_some()
    };
    let active_notebook_id = if notebook_exists {
        active_notebook_id
    } else {
        connection
            .query_row(
                "SELECT id FROM notebooks ORDER BY rowid LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .unwrap_or_default()
    };

    let active_page_exists = if active_page_id.is_empty() {
        false
    } else {
        connection
            .query_row(
                "SELECT 1 FROM pages WHERE id = ?1 LIMIT 1",
                params![&active_page_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .is_some()
    };
    let active_page_id = if active_page_exists {
        active_page_id
    } else {
        let same_notebook_page_id = connection
            .query_row(
                "SELECT id FROM pages WHERE notebook_id = ?1 ORDER BY rowid LIMIT 1",
                params![&active_notebook_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        match same_notebook_page_id {
            Some(page_id) => page_id,
            None => connection
                .query_row("SELECT id FROM pages ORDER BY rowid LIMIT 1", [], |row| {
                    row.get::<_, String>(0)
                })
                .optional()
                .map_err(|error| error.to_string())?
                .unwrap_or_default(),
        }
    };

    Ok(WorkspacePreferencesPayload {
        active_notebook_id,
        active_page_id,
        shell,
        theme,
        content_theme,
        open_card_window_block_id,
        expanded_page_ids,
        show_page_metadata,
    })
}

fn save_workspace_preferences_in_transaction(
    connection: &mut Connection,
    request: &WorkspacePreferencesRequest,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO workspace_preferences (id, active_notebook_id, active_page_id, shell, theme, content_theme, open_card_window_block_id, expanded_page_ids_json, show_page_metadata, updated_at) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET active_notebook_id = excluded.active_notebook_id, active_page_id = excluded.active_page_id, shell = excluded.shell, theme = excluded.theme, content_theme = excluded.content_theme, open_card_window_block_id = excluded.open_card_window_block_id, expanded_page_ids_json = excluded.expanded_page_ids_json, show_page_metadata = excluded.show_page_metadata, updated_at = excluded.updated_at",
            params![
                request.active_notebook_id,
                request.active_page_id,
                request.shell,
                request.theme,
                request.content_theme,
                request.open_card_window_block_id,
                serde_json::to_string(&request.expanded_page_ids).map_err(|error| error.to_string())?,
                if request.show_page_metadata { 1 } else { 0 }
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
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
fn load_normalized_state(app: AppHandle) -> Result<Option<String>, String> {
    let connection = open_database(&app)?;
    read_normalized_state_json(&connection)
}

#[tauri::command]
fn load_workspace_preferences(app: AppHandle) -> Result<WorkspacePreferencesPayload, String> {
    let connection = open_database(&app)?;
    read_workspace_preferences(&connection)
}

#[tauri::command]
fn save_workspace_preferences(
    app: AppHandle,
    request: WorkspacePreferencesRequest,
) -> Result<(), String> {
    let mut connection = open_database(&app)?;
    save_workspace_preferences_in_transaction(&mut connection, &request)
}

#[tauri::command]
fn list_notebook_tree(app: AppHandle) -> Result<NotebookTreePayload, String> {
    let connection = open_database(&app)?;
    Ok(NotebookTreePayload {
        notebooks: list_notebooks_from_database(&connection)?,
        pages: list_pages_from_database(&connection)?,
    })
}

#[tauri::command]
fn load_page_document(
    app: AppHandle,
    page_id: String,
) -> Result<Option<PageDocumentPayload>, String> {
    let connection = open_database(&app)?;
    load_page_document_from_database(&connection, &page_id)
}

fn load_page_document_from_database(
    connection: &Connection,
    page_id: &str,
) -> Result<Option<PageDocumentPayload>, String> {
    load_page_documents_from_database(connection, &[page_id.to_string()])
        .map(|documents| documents.into_iter().next())
}

#[tauri::command]
fn load_page_documents(
    app: AppHandle,
    page_ids: Vec<String>,
) -> Result<Vec<PageDocumentPayload>, String> {
    let connection = open_database(&app)?;
    load_page_documents_from_database(&connection, &page_ids)
}

fn load_page_documents_from_database(
    connection: &Connection,
    page_ids: &[String],
) -> Result<Vec<PageDocumentPayload>, String> {
    if page_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut documents_by_id = HashMap::new();
    for chunk in page_ids.chunks(800) {
        let placeholders = vec!["?"; chunk.len()].join(", ");
        let sql = format!(
            "SELECT id, notebook_id, parent_id, title, block_ids_json, block_order, metadata_json, created_at, updated_at, content_json FROM pages WHERE id IN ({placeholders})"
        );
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params_from_iter(chunk.iter()), page_document_from_row)
            .map_err(|error| error.to_string())?;

        for row in rows {
            let document = row.map_err(|error| error.to_string())?;
            documents_by_id.insert(document.page.id.clone(), document);
        }
    }

    Ok(page_ids
        .iter()
        .filter_map(|page_id| documents_by_id.remove(page_id))
        .collect())
}

fn page_document_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PageDocumentPayload> {
    let content_json: String = row.get(9)?;
    let page = normalized_page_from_row(row)?;

    Ok(PageDocumentPayload {
        page,
        content: page_content_from_json(&content_json),
    })
}

fn indexed_block_payload_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<(NormalizedPage, String)> {
    let page = normalized_page_from_row(row)?;
    let block_json: String = row.get(9)?;
    Ok((page, block_json))
}

fn parse_indexed_block(block_json: &str) -> Result<NormalizedBlock, String> {
    serde_json::from_str::<NormalizedBlock>(block_json).map_err(|error| error.to_string())
}

fn list_page_documents_from_database(
    connection: &Connection,
    notebook_id: Option<&str>,
) -> Result<Vec<PageDocumentPayload>, String> {
    let select_sql = "
        SELECT id, notebook_id, parent_id, title, block_ids_json, block_order,
               metadata_json, created_at, updated_at, content_json
        FROM pages
    ";

    if let Some(notebook_id) = notebook_id {
        let sql = format!("{select_sql} WHERE notebook_id = ?1 ORDER BY rowid");
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![notebook_id], page_document_from_row)
            .map_err(|error| error.to_string())?;
        return rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string());
    }

    let sql = format!("{select_sql} ORDER BY rowid");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], page_document_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_block_document_from_database(
    connection: &Connection,
    block_id: &str,
) -> Result<Option<PageDocumentPayload>, String> {
    let indexed_page_id = connection
        .query_row(
            "SELECT page_id FROM page_block_index WHERE block_id = ?1 LIMIT 1",
            params![block_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some(page_id) = indexed_page_id {
        if let Some(document) = load_page_document_from_database(connection, &page_id)? {
            if document
                .content
                .blocks
                .iter()
                .any(|block| block.id == block_id)
            {
                return Ok(Some(document));
            }
        }
    }

    for document in list_page_documents_from_database(connection, None)? {
        if document
            .content
            .blocks
            .iter()
            .any(|block| block.id == block_id)
        {
            refresh_page_block_index(connection, &document.page, &document.content.blocks)?;
            return Ok(Some(document));
        }
    }

    Ok(None)
}

fn list_pinned_blocks_from_database(
    connection: &Connection,
) -> Result<Vec<PinnedBlockPayload>, String> {
    let mut pinned_blocks = Vec::new();
    let mut statement = connection
        .prepare(
            "
            SELECT pages.id, pages.notebook_id, pages.parent_id, pages.title,
                   pages.block_ids_json, pages.block_order, pages.metadata_json,
                   pages.created_at, pages.updated_at, page_block_index.block_json
            FROM page_block_index
            JOIN pages ON pages.id = page_block_index.page_id
            WHERE page_block_index.pinned = 1
            ORDER BY pages.rowid, page_block_index.sort_index
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], indexed_block_payload_from_row)
        .map_err(|error| error.to_string())?;

    for row in rows {
        let (page, block_json) = row.map_err(|error| error.to_string())?;
        pinned_blocks.push(PinnedBlockPayload {
            page,
            block: parse_indexed_block(&block_json)?,
        });
    }
    Ok(pinned_blocks)
}

fn list_calendar_blocks_from_database(
    connection: &Connection,
    notebook_id: &str,
    month: &str,
) -> Result<Vec<CalendarBlockPayload>, String> {
    let mut calendar_blocks = Vec::new();
    let month_prefix = format!("{month}%");
    let mut statement = connection
        .prepare(
            "
            SELECT pages.id, pages.notebook_id, pages.parent_id, pages.title,
                   pages.block_ids_json, pages.block_order, pages.metadata_json,
                   pages.created_at, pages.updated_at, page_block_index.block_json
            FROM page_block_index
            JOIN pages ON pages.id = page_block_index.page_id
            WHERE page_block_index.notebook_id = ?1
              AND page_block_index.created_at LIKE ?2
            ORDER BY page_block_index.created_at, pages.rowid, page_block_index.sort_index
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![notebook_id, month_prefix],
            indexed_block_payload_from_row,
        )
        .map_err(|error| error.to_string())?;

    for row in rows {
        let (page, block_json) = row.map_err(|error| error.to_string())?;
        calendar_blocks.push(CalendarBlockPayload {
            page,
            block: parse_indexed_block(&block_json)?,
        });
    }
    Ok(calendar_blocks)
}

#[tauri::command]
fn load_block_document(
    app: AppHandle,
    block_id: String,
) -> Result<Option<PageDocumentPayload>, String> {
    let connection = open_database(&app)?;
    load_block_document_from_database(&connection, &block_id)
}

#[tauri::command]
fn list_pinned_blocks(app: AppHandle) -> Result<Vec<PinnedBlockPayload>, String> {
    let connection = open_database(&app)?;
    list_pinned_blocks_from_database(&connection)
}

#[tauri::command]
fn list_calendar_blocks(
    app: AppHandle,
    notebook_id: String,
    month: String,
) -> Result<Vec<CalendarBlockPayload>, String> {
    let connection = open_database(&app)?;
    list_calendar_blocks_from_database(&connection, &notebook_id, &month)
}

#[tauri::command]
fn search_pages(
    app: AppHandle,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<PageSearchResult>, String> {
    let connection = open_database(&app)?;
    search_pages_in_database(&connection, &query, limit)
}

fn search_pages_in_database(
    connection: &Connection,
    query: &str,
    limit: Option<u32>,
) -> Result<Vec<PageSearchResult>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }
    let Some(fts_query) = fts_query_from_search_text(trimmed) else {
        return Ok(vec![]);
    };
    let max_results = i64::from(limit.unwrap_or(30).clamp(1, 100));
    let mut statement = connection
        .prepare(
            "
            SELECT
              fts_pages.page_id,
              pages.notebook_id,
              pages.title,
              snippet(fts_pages, 2, '<mark>', '</mark>', '...', 12),
              CASE
                WHEN lower(pages.title) = lower(?3) THEN 0
                WHEN lower(pages.title) LIKE lower(?3 || '%') THEN 1
                WHEN lower(pages.title) LIKE lower('%' || ?3 || '%') THEN 2
                ELSE 3
              END AS title_priority
            FROM fts_pages
            JOIN pages ON pages.id = fts_pages.page_id
            WHERE fts_pages MATCH ?1
            ORDER BY title_priority, rank
            LIMIT ?2
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![fts_query, max_results, trimmed], |row| {
            Ok(PageSearchResult {
                page_id: row.get(0)?,
                notebook_id: row.get(1)?,
                title: row.get(2)?,
                snippet: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn persist_import_batch(
    app: AppHandle,
    batch: NormalizedImportBatch,
) -> Result<NotebookTreePayload, String> {
    let mut connection = open_database(&app)?;
    persist_import_batch_in_transaction(&mut connection, &batch)?;
    Ok(NotebookTreePayload {
        notebooks: list_notebooks_from_database(&connection)?,
        pages: list_pages_from_database(&connection)?,
    })
}

#[tauri::command]
fn rename_entity(
    app: AppHandle,
    request: RenameEntityRequest,
) -> Result<NotebookTreePayload, String> {
    let mut connection = open_database(&app)?;
    rename_entity_in_transaction(&mut connection, &request)?;
    Ok(NotebookTreePayload {
        notebooks: list_notebooks_from_database(&connection)?,
        pages: list_pages_from_database(&connection)?,
    })
}

#[tauri::command]
fn move_page(app: AppHandle, request: MovePageRequest) -> Result<NotebookTreePayload, String> {
    let mut connection = open_database(&app)?;
    move_page_in_transaction(&mut connection, &request)?;
    Ok(NotebookTreePayload {
        notebooks: list_notebooks_from_database(&connection)?,
        pages: list_pages_from_database(&connection)?,
    })
}

#[tauri::command]
fn create_notebook(
    app: AppHandle,
    request: CreateNotebookRequest,
) -> Result<NotebookTreePayload, String> {
    let mut connection = open_database(&app)?;
    create_notebook_in_transaction(&mut connection, &request)?;
    Ok(NotebookTreePayload {
        notebooks: list_notebooks_from_database(&connection)?,
        pages: list_pages_from_database(&connection)?,
    })
}

#[tauri::command]
fn create_page(app: AppHandle, request: CreatePageRequest) -> Result<NotebookTreePayload, String> {
    let mut connection = open_database(&app)?;
    create_page_in_transaction(&mut connection, &request)?;
    Ok(NotebookTreePayload {
        notebooks: list_notebooks_from_database(&connection)?,
        pages: list_pages_from_database(&connection)?,
    })
}

#[tauri::command]
fn update_page_metadata(
    app: AppHandle,
    request: UpdatePageMetadataRequest,
) -> Result<NotebookTreePayload, String> {
    let mut connection = open_database(&app)?;
    update_page_metadata_in_transaction(&mut connection, &request)?;
    Ok(NotebookTreePayload {
        notebooks: list_notebooks_from_database(&connection)?,
        pages: list_pages_from_database(&connection)?,
    })
}

#[tauri::command]
fn update_notebook_metadata(
    app: AppHandle,
    request: UpdateNotebookMetadataRequest,
) -> Result<NotebookTreePayload, String> {
    let mut connection = open_database(&app)?;
    update_notebook_metadata_in_transaction(&mut connection, &request)?;
    Ok(NotebookTreePayload {
        notebooks: list_notebooks_from_database(&connection)?,
        pages: list_pages_from_database(&connection)?,
    })
}

#[tauri::command]
fn save_page_document(
    app: AppHandle,
    request: SavePageDocumentRequest,
) -> Result<PageDocumentPayload, String> {
    let mut connection = open_database(&app)?;
    save_page_document_in_transaction(&mut connection, &request)?;
    load_page_document(app, request.page.id)?
        .ok_or_else(|| "Saved page document could not be loaded".to_string())
}

#[tauri::command]
fn list_page_revisions(
    app: AppHandle,
    page_id: String,
    limit: Option<u32>,
) -> Result<Vec<PageRevisionPayload>, String> {
    let connection = open_database(&app)?;
    list_page_revisions_from_database(&connection, &page_id, limit)
}

#[tauri::command]
fn restore_page_revision(
    app: AppHandle,
    request: RestorePageRevisionRequest,
) -> Result<PageDocumentPayload, String> {
    let mut connection = open_database(&app)?;
    restore_page_revision_in_transaction(&mut connection, &request)?;
    load_page_document(app, request.page_id)?
        .ok_or_else(|| "Restored page document could not be loaded".to_string())
}

#[tauri::command]
fn delete_block(
    app: AppHandle,
    request: DeleteBlockRequest,
) -> Result<PageDocumentPayload, String> {
    let page_id = request.page_id.clone();
    let mut connection = open_database(&app)?;
    delete_block_in_transaction(&mut connection, &request)?;
    load_page_document(app, page_id)?
        .ok_or_else(|| "Updated page document could not be loaded".to_string())
}

#[tauri::command]
fn delete_page_tree(
    app: AppHandle,
    request: DeletePageTreeRequest,
) -> Result<NotebookTreePayload, String> {
    let mut connection = open_database(&app)?;
    delete_page_tree_in_transaction(&mut connection, &request)?;
    cleanup_orphan_attachments_after_document_change(&connection, &app);
    Ok(NotebookTreePayload {
        notebooks: list_notebooks_from_database(&connection)?,
        pages: list_pages_from_database(&connection)?,
    })
}

#[tauri::command]
fn list_trash_items(app: AppHandle, limit: Option<u32>) -> Result<Vec<TrashItemPayload>, String> {
    let connection = open_database(&app)?;
    list_trash_items_from_database(&connection, limit)
}

#[tauri::command]
fn restore_trash_item(
    app: AppHandle,
    request: RestoreTrashItemRequest,
) -> Result<NotebookTreePayload, String> {
    let mut connection = open_database(&app)?;
    restore_trash_item_in_transaction(&mut connection, &request)?;
    Ok(NotebookTreePayload {
        notebooks: list_notebooks_from_database(&connection)?,
        pages: list_pages_from_database(&connection)?,
    })
}

#[tauri::command]
fn empty_trash(app: AppHandle) -> Result<AttachmentCleanupResult, String> {
    let mut connection = open_database(&app)?;
    empty_trash_in_transaction(&mut connection)?;
    cleanup_orphan_attachments_from_database(&connection, app_data_dir(&app)?)
}

#[tauri::command]
fn delete_notebook(
    app: AppHandle,
    request: DeleteNotebookRequest,
) -> Result<NotebookTreePayload, String> {
    let mut connection = open_database(&app)?;
    delete_notebook_in_transaction(&mut connection, &request)?;
    cleanup_orphan_attachments_after_document_change(&connection, &app);
    Ok(NotebookTreePayload {
        notebooks: list_notebooks_from_database(&connection)?,
        pages: list_pages_from_database(&connection)?,
    })
}

fn save_state_snapshot_in_transaction(
    connection: &mut Connection,
    state_json: String,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
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
fn save_state_snapshot(app: AppHandle, state_json: String) -> Result<(), String> {
    let mut connection = open_database(&app)?;
    save_state_snapshot_in_transaction(&mut connection, state_json)
}

#[tauri::command]
fn import_local_asset(app: AppHandle, source_path: String) -> Result<ImportedAsset, String> {
    let connection = open_database(&app)?;
    import_asset_into_store(&connection, app_data_dir(&app)?, source_path)
}

#[tauri::command]
fn import_remote_asset(app: AppHandle, url: String) -> Result<ImportedAsset, String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("Only http and https URLs are supported".to_string());
    }

    let response = ureq::get(trimmed)
        .set("User-Agent", "Notebook/1.0")
        .call()
        .map_err(|error| error.to_string())?;

    let mime_type = response
        .header("content-type")
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .trim()
        .to_string();

    let mut bytes = Vec::new();
    response
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;

    let filename = trimmed
        .split('?')
        .next()
        .unwrap_or(trimmed)
        .rsplit('/')
        .next()
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "online-icon.png".to_string());

    let connection = open_database(&app)?;
    let mut imported = import_asset_bytes_into_store(
        &connection,
        app_data_dir(&app)?,
        filename,
        mime_type,
        bytes,
    )?;
    imported.original_path = trimmed.to_string();
    Ok(imported)
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

fn is_markdown_path(path: &PathBuf) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_lowercase().as_str(), "md" | "markdown" | "txt"))
        .unwrap_or(false)
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<MarkdownFilePayload, String> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("The selected Markdown file does not exist.".to_string());
    }
    if !is_markdown_path(&source) {
        return Err("Only .md, .markdown, and .txt files can be opened.".to_string());
    }
    let metadata = fs::metadata(&source).map_err(|error| error.to_string())?;
    const MAX_MARKDOWN_BYTES: u64 = 16 * 1024 * 1024;
    if metadata.len() > MAX_MARKDOWN_BYTES {
        return Err("Markdown file is larger than 16 MB.".to_string());
    }
    let markdown = fs::read_to_string(&source).map_err(|error| error.to_string())?;
    let filename = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled.md")
        .to_string();
    Ok(MarkdownFilePayload {
        path,
        filename,
        markdown,
    })
}

#[tauri::command]
fn drain_pending_markdown_opens(app: AppHandle) -> Result<Vec<String>, String> {
    let pending = app.state::<PendingMarkdownOpens>();
    let mut paths = pending.0.lock().map_err(|error| error.to_string())?;
    Ok(paths.drain(..).collect())
}

#[tauri::command]
fn acknowledge_markdown_open(app: AppHandle, path: String) -> Result<(), String> {
    let pending = app.state::<PendingMarkdownOpens>();
    let mut paths = pending.0.lock().map_err(|error| error.to_string())?;
    paths.retain(|candidate| candidate != &path);
    Ok(())
}

#[tauri::command]
fn drain_pending_card_opens(app: AppHandle) -> Result<Vec<String>, String> {
    let pending = app.state::<PendingCardOpens>();
    let mut block_ids = pending.0.lock().map_err(|error| error.to_string())?;
    Ok(block_ids.drain(..).collect())
}

#[tauri::command]
fn create_external_card(app: AppHandle, page_id: String) -> Result<String, String> {
    let mut connection = open_database(&app)?;
    create_external_card_block_in_database(&mut connection, &page_id)
}

fn handle_external_card_request(app: &AppHandle, path: &PathBuf) -> Result<(), String> {
    let request_text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let request: ExternalCardRequest =
        serde_json::from_str(&request_text).map_err(|error| error.to_string())?;
    let mut connection = open_database(app)?;
    let block_id = create_external_card_block_in_database(&mut connection, &request.page_id)?;
    if let Ok(mut pending) = app.state::<PendingCardOpens>().0.lock() {
        if !pending.contains(&block_id) {
            pending.push(block_id.clone());
        }
    }
    let _ = app.emit("notebook://open-card-block", block_id);
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.hide();
    }
    Ok(())
}

#[tauri::command]
fn cleanup_orphan_attachments(
    app: AppHandle,
    referenced_asset_ids: Vec<String>,
) -> Result<AttachmentCleanupResult, String> {
    let connection = open_database(&app)?;
    cleanup_orphan_attachments_in_store(&connection, app_data_dir(&app)?, referenced_asset_ids)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PendingMarkdownOpens::default())
        .manage(PendingCardOpens::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_normalized_state,
            load_workspace_preferences,
            save_workspace_preferences,
            list_notebook_tree,
            load_page_document,
            load_page_documents,
            load_block_document,
            list_pinned_blocks,
            list_calendar_blocks,
            search_pages,
            persist_import_batch,
            rename_entity,
            move_page,
            create_notebook,
            create_page,
            update_page_metadata,
            update_notebook_metadata,
            save_page_document,
            list_page_revisions,
            restore_page_revision,
            list_trash_items,
            restore_trash_item,
            empty_trash,
            delete_block,
            delete_page_tree,
            delete_notebook,
            load_state_snapshot,
            save_state_snapshot,
            import_local_asset,
            import_remote_asset,
            import_asset_bytes,
            read_markdown_file,
            drain_pending_markdown_opens,
            acknowledge_markdown_open,
            drain_pending_card_opens,
            create_external_card,
            cleanup_orphan_attachments
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let RunEvent::Opened { urls } = event {
                for url in urls {
                    if url.scheme() != "file" {
                        continue;
                    }
                    let Ok(path) = url.to_file_path() else {
                        continue;
                    };
                    if path.extension().and_then(|value| value.to_str()) == Some("notecard") {
                        let _ = handle_external_card_request(app, &path);
                        continue;
                    }
                    if !is_markdown_path(&path) {
                        continue;
                    }
                    let path = path.to_string_lossy().to_string();
                    if let Ok(mut pending) = app.state::<PendingMarkdownOpens>().0.lock() {
                        if !pending.contains(&path) {
                            pending.push(path.clone());
                        }
                    }
                    let _ = app.emit(
                        "notebook://open-markdown-file",
                        path,
                    );
                }
            }
        });
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

    fn demo_normalized_state() -> NormalizedAppState {
        NormalizedAppState {
            notebooks: vec![NormalizedNotebook {
                id: "notebook_demo".to_string(),
                name: "Demo".to_string(),
                page_ids: vec!["page_demo".to_string()],
                metadata: serde_json::json!({}),
            }],
            show_page_metadata: true,
            pages: vec![NormalizedPage {
                id: "page_demo".to_string(),
                notebook_id: "notebook_demo".to_string(),
                parent_id: None,
                title: "Inbox".to_string(),
                block_ids: vec!["block_a".to_string(), "block_b".to_string()],
                block_order: Some("asc".to_string()),
                metadata: NormalizedPageMetadata {
                    source_filename: Some("demo.md".to_string()),
                    tags: vec!["work".to_string()],
                    date: Some("2026-06-15".to_string()),
                    status: Some("draft".to_string()),
                    aliases: vec!["Inbox alias".to_string()],
                    frontmatter: serde_json::Map::new(),
                    emoji: None,
                },
                created_at: "2026-06-15T00:00:00Z".to_string(),
                updated_at: "2026-06-15T00:00:00Z".to_string(),
            }],
            blocks: vec![
                NormalizedBlock {
                    id: "block_a".to_string(),
                    page_id: "page_demo".to_string(),
                    content: NormalizedRichContent {
                        html: "<p>Hello world</p>".to_string(),
                        plain_text: "Hello world".to_string(),
                    },
                    collapsed: false,
                    pinned: false,
                    created_at: "2026-06-15T00:00:00Z".to_string(),
                    updated_at: "2026-06-15T00:00:00Z".to_string(),
                },
                NormalizedBlock {
                    id: "block_b".to_string(),
                    page_id: "page_demo".to_string(),
                    content: NormalizedRichContent {
                        html: "<p>Second block</p>".to_string(),
                        plain_text: "Second block".to_string(),
                    },
                    collapsed: true,
                    pinned: true,
                    created_at: "2026-06-15T00:00:00Z".to_string(),
                    updated_at: "2026-06-15T00:00:00Z".to_string(),
                },
            ],
            active_notebook_id: "notebook_demo".to_string(),
            active_page_id: "page_demo".to_string(),
            shell: "native-garden".to_string(),
            theme: "garden".to_string(),
            content_theme: "notebook".to_string(),
            open_card_window_block_id: None,
            expanded_page_ids: vec!["page_demo".to_string()],
            operations: vec![NormalizedOperationLogEntry {
                id: "op_demo".to_string(),
                timestamp: "2026-06-15T00:00:00Z".to_string(),
                entity: "page".to_string(),
                entity_id: "page_demo".to_string(),
                kind: "page.create".to_string(),
                payload: serde_json::json!({"pageId": "page_demo"}),
            }],
        }
    }

    #[test]
    fn normalized_tables_rebuild_from_snapshot_state() {
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        let notebook_name: String = connection
            .query_row(
                "SELECT name FROM notebooks WHERE id = 'notebook_demo'",
                [],
                |row| row.get(0),
            )
            .expect("notebook row");
        assert_eq!(notebook_name, "Demo");

        let page: (String, String, String) = connection
            .query_row(
                "SELECT title, search_text, metadata_json FROM pages WHERE id = 'page_demo'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("page row");
        assert_eq!(page.0, "Inbox");
        assert!(page.1.contains("Hello world"));
        assert!(page.2.contains("demo.md"));

        let operation_kind: String = connection
            .query_row(
                "SELECT kind FROM operation_log WHERE id = 'op_demo'",
                [],
                |row| row.get(0),
            )
            .expect("operation row");
        assert_eq!(operation_kind, "page.create");
    }

    #[test]
    fn normalized_page_content_is_stored_as_document_json() {
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        let content_json: String = connection
            .query_row(
                "SELECT content_json FROM pages WHERE id = 'page_demo'",
                [],
                |row| row.get(0),
            )
            .expect("page content json");
        let content =
            serde_json::from_str::<serde_json::Value>(&content_json).expect("page content value");

        assert_eq!(content["contentType"], "page_document");
        assert_eq!(content["version"], 1);
        assert_eq!(content["blocks"][0]["id"], "block_a");
    }

    #[test]
    fn legacy_block_array_page_content_still_reads_back() {
        let blocks = vec![NormalizedBlock {
            id: "legacy_block".to_string(),
            page_id: "legacy_page".to_string(),
            content: NormalizedRichContent {
                html: "<p>Legacy body</p>".to_string(),
                plain_text: "Legacy body".to_string(),
            },
            collapsed: false,
            pinned: false,
            created_at: "2026-06-15T00:00:00Z".to_string(),
            updated_at: "2026-06-15T00:00:00Z".to_string(),
        }];

        let parsed = blocks_from_page_content_json(
            &serde_json::to_string(&blocks).expect("legacy blocks json"),
        );

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "legacy_block");
        assert_eq!(parsed[0].content.plain_text, "Legacy body");
    }

    #[test]
    fn notebook_tree_query_returns_lightweight_notebooks_and_pages() {
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        let tree = NotebookTreePayload {
            notebooks: list_notebooks_from_database(&connection).expect("notebooks"),
            pages: list_pages_from_database(&connection).expect("pages"),
        };

        assert_eq!(tree.notebooks.len(), 1);
        assert_eq!(tree.notebooks[0].page_ids, vec!["page_demo"]);
        assert_eq!(tree.pages.len(), 1);
        assert_eq!(tree.pages[0].block_ids, vec!["block_a", "block_b"]);
    }

    #[test]
    fn page_document_query_returns_content_wrapper() {
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        let page = list_pages_from_database(&connection)
            .expect("pages")
            .into_iter()
            .find(|page| page.id == "page_demo")
            .expect("demo page");
        let content_json: String = connection
            .query_row(
                "SELECT content_json FROM pages WHERE id = 'page_demo'",
                [],
                |row| row.get(0),
            )
            .expect("content json");
        let document = PageDocumentPayload {
            page,
            content: page_content_from_json(&content_json),
        };

        assert_eq!(document.page.title, "Inbox");
        assert_eq!(document.content.content_type, "page_document");
        assert_eq!(document.content.blocks.len(), 2);
    }

    #[test]
    fn page_documents_query_returns_requested_documents_and_skips_missing_pages() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        persist_import_batch_in_transaction(
            &mut connection,
            &NormalizedImportBatch {
                notebook: NormalizedNotebook {
                    id: "notebook_batch_docs".to_string(),
                    name: "Batch Docs".to_string(),
                    page_ids: vec!["page_one".to_string(), "page_two".to_string()],
                    metadata: serde_json::json!({}),
                },
                pages: vec![
                    NormalizedPage {
                        id: "page_one".to_string(),
                        notebook_id: "notebook_batch_docs".to_string(),
                        parent_id: None,
                        title: "One".to_string(),
                        block_ids: vec!["block_one".to_string()],
                        block_order: Some("asc".to_string()),
                        metadata: default_page_metadata(),
                        created_at: "2026-06-16T00:00:00Z".to_string(),
                        updated_at: "2026-06-16T00:00:00Z".to_string(),
                    },
                    NormalizedPage {
                        id: "page_two".to_string(),
                        notebook_id: "notebook_batch_docs".to_string(),
                        parent_id: None,
                        title: "Two".to_string(),
                        block_ids: vec!["block_two".to_string()],
                        block_order: Some("asc".to_string()),
                        metadata: default_page_metadata(),
                        created_at: "2026-06-16T00:00:00Z".to_string(),
                        updated_at: "2026-06-16T00:00:00Z".to_string(),
                    },
                ],
                blocks: vec![
                    NormalizedBlock {
                        id: "block_one".to_string(),
                        page_id: "page_one".to_string(),
                        content: NormalizedRichContent {
                            html: "<p>One</p>".to_string(),
                            plain_text: "One".to_string(),
                        },
                        collapsed: false,
                        pinned: false,
                        created_at: "2026-06-16T00:00:00Z".to_string(),
                        updated_at: "2026-06-16T00:00:00Z".to_string(),
                    },
                    NormalizedBlock {
                        id: "block_two".to_string(),
                        page_id: "page_two".to_string(),
                        content: NormalizedRichContent {
                            html: "<p>Two</p>".to_string(),
                            plain_text: "Two".to_string(),
                        },
                        collapsed: false,
                        pinned: false,
                        created_at: "2026-06-16T00:00:00Z".to_string(),
                        updated_at: "2026-06-16T00:00:00Z".to_string(),
                    },
                ],
                operation: None,
            },
        )
        .expect("seed batch docs");

        let documents = ["page_one", "missing_page", "page_two"]
            .iter()
            .filter_map(|page_id| {
                load_page_document_from_database(&connection, page_id).expect("load page document")
            })
            .collect::<Vec<_>>();

        assert_eq!(documents.len(), 2);
        assert_eq!(documents[0].page.id, "page_one");
        assert_eq!(documents[1].page.id, "page_two");
        assert_eq!(documents[1].content.blocks[0].content.plain_text, "Two");
    }

    #[test]
    fn block_document_query_finds_owning_page_document() {
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        let document = load_block_document_from_database(&connection, "block_b")
            .expect("block document query")
            .expect("block document");

        assert_eq!(document.page.id, "page_demo");
        assert_eq!(document.content.blocks.len(), 2);
        assert!(document
            .content
            .blocks
            .iter()
            .any(|block| block.id == "block_b"));
    }

    #[test]
    fn pinned_block_query_returns_pinned_blocks_with_pages() {
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        let pinned = list_pinned_blocks_from_database(&connection).expect("pinned blocks");

        assert_eq!(pinned.len(), 1);
        assert_eq!(pinned[0].page.id, "page_demo");
        assert_eq!(pinned[0].block.id, "block_b");
    }

    #[test]
    fn page_block_index_backfills_existing_page_documents() {
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");
        connection
            .execute("DELETE FROM page_block_index", [])
            .expect("clear block index");

        ensure_page_block_index_backfilled(&connection).expect("backfill block index");

        let indexed_blocks: i64 = connection
            .query_row("SELECT COUNT(*) FROM page_block_index", [], |row| {
                row.get(0)
            })
            .expect("indexed block count");
        let indexed_pinned: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM page_block_index WHERE pinned = 1",
                [],
                |row| row.get(0),
            )
            .expect("indexed pinned count");
        assert_eq!(indexed_blocks, 2);
        assert_eq!(indexed_pinned, 1);
    }

    #[test]
    fn page_document_save_refreshes_block_index_for_pinned_queries() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");
        let page = load_page_metadata_from_database(&connection, "page_demo")
            .expect("page metadata")
            .expect("page");
        let document = load_page_document_from_database(&connection, "page_demo")
            .expect("page document")
            .expect("page document");
        let blocks = document
            .content
            .blocks
            .into_iter()
            .map(|block| NormalizedBlock {
                pinned: block.id == "block_a",
                ..block
            })
            .collect::<Vec<_>>();

        save_page_document_in_transaction(
            &mut connection,
            &SavePageDocumentRequest {
                page,
                blocks,
                operation: None,
            },
        )
        .expect("save page document");

        let pinned = list_pinned_blocks_from_database(&connection).expect("pinned blocks");

        assert_eq!(pinned.len(), 1);
        assert_eq!(pinned[0].block.id, "block_a");
    }

    #[test]
    fn calendar_block_query_returns_month_entries_for_notebook() {
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        let entries = list_calendar_blocks_from_database(&connection, "notebook_demo", "2026-06")
            .expect("calendar entries");
        let empty = list_calendar_blocks_from_database(&connection, "notebook_demo", "2026-07")
            .expect("empty calendar entries");

        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|entry| entry.page.id == "page_demo"));
        assert!(empty.is_empty());
    }

    #[test]
    fn workspace_preferences_read_active_ids_and_theme_without_state_rebuild() {
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        let state = NormalizedAppState {
            shell: "typora-base".to_string(),
            theme: "ledger".to_string(),
            content_theme: "typora-swiss".to_string(),
            expanded_page_ids: vec!["page_demo".to_string()],
            show_page_metadata: true,
            ..demo_normalized_state()
        };
        connection
            .execute(
                "INSERT INTO app_state (id, state_json) VALUES (1, ?1)",
                params![serde_json::to_string(&state).expect("state json")],
            )
            .expect("snapshot insert");
        rebuild_normalized_tables(&connection, &state).expect("normalized rebuild");

        let preferences = read_workspace_preferences(&connection).expect("preferences");

        assert_eq!(preferences.active_notebook_id, "notebook_demo");
        assert_eq!(preferences.active_page_id, "page_demo");
        assert_eq!(preferences.shell, "typora-base");
        assert_eq!(preferences.content_theme, "typora-swiss");
        assert_eq!(preferences.expanded_page_ids, vec!["page_demo"]);
    }

    #[test]
    fn state_snapshot_does_not_rebuild_page_documents_from_partial_state() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");
        let snapshot = NormalizedAppState {
            blocks: vec![],
            show_page_metadata: true,
            ..demo_normalized_state()
        };

        save_state_snapshot_in_transaction(
            &mut connection,
            serde_json::to_string(&snapshot).expect("snapshot json"),
        )
        .expect("snapshot save");

        let content_json: String = connection
            .query_row(
                "SELECT content_json FROM pages WHERE id = 'page_demo'",
                [],
                |row| row.get(0),
            )
            .expect("page content");
        assert_eq!(page_content_from_json(&content_json).blocks.len(), 2);
        let indexed_blocks: i64 = connection
            .query_row("SELECT COUNT(*) FROM page_block_index", [], |row| {
                row.get(0)
            })
            .expect("indexed block count");
        assert_eq!(indexed_blocks, 2);
    }

    #[test]
    fn workspace_preferences_fall_back_without_loading_full_library() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        save_workspace_preferences_in_transaction(
            &mut connection,
            &WorkspacePreferencesRequest {
                active_notebook_id: "missing_notebook".to_string(),
                active_page_id: "missing_page".to_string(),
                shell: "native-ledger".to_string(),
                theme: "ledger".to_string(),
                content_theme: "notebook".to_string(),
                open_card_window_block_id: None,
                expanded_page_ids: vec![],
                show_page_metadata: true,
            },
        )
        .expect("workspace preferences save");

        let preferences = read_workspace_preferences(&connection).expect("preferences");

        assert_eq!(preferences.active_notebook_id, "notebook_demo");
        assert_eq!(preferences.active_page_id, "page_demo");
        assert_eq!(preferences.shell, "native-ledger");
    }

    #[test]
    fn workspace_preferences_save_and_read_from_dedicated_table() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        save_workspace_preferences_in_transaction(
            &mut connection,
            &WorkspacePreferencesRequest {
                active_notebook_id: "notebook_demo".to_string(),
                active_page_id: "page_demo".to_string(),
                shell: "typora-base".to_string(),
                theme: "ledger".to_string(),
                content_theme: "typora-swiss".to_string(),
                open_card_window_block_id: Some("block_a".to_string()),
                expanded_page_ids: vec!["page_demo".to_string()],
                show_page_metadata: false,
            },
        )
        .expect("save workspace preferences");

        let preferences = read_workspace_preferences(&connection).expect("preferences");

        assert_eq!(preferences.active_notebook_id, "notebook_demo");
        assert_eq!(preferences.active_page_id, "page_demo");
        assert_eq!(preferences.shell, "typora-base");
        assert_eq!(preferences.theme, "ledger");
        assert_eq!(preferences.content_theme, "typora-swiss");
        assert_eq!(
            preferences.open_card_window_block_id,
            Some("block_a".to_string())
        );
        assert_eq!(preferences.expanded_page_ids, vec!["page_demo"]);
    }

    #[test]
    fn import_batch_persists_pages_documents_fts_and_operation() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        let mut state = demo_normalized_state();
        state.notebooks[0].id = "notebook_import".to_string();
        state.notebooks[0].name = "Imported".to_string();
        state.notebooks[0].page_ids = vec!["page_import".to_string()];
        state.pages[0].id = "page_import".to_string();
        state.pages[0].notebook_id = "notebook_import".to_string();
        state.pages[0].title = "Imported page".to_string();
        state.blocks.iter_mut().for_each(|block| {
            block.page_id = "page_import".to_string();
        });

        let batch = NormalizedImportBatch {
            notebook: state.notebooks[0].clone(),
            pages: state.pages.clone(),
            blocks: state.blocks.clone(),
            operation: Some(NormalizedOperationLogEntry {
                id: "op_import".to_string(),
                timestamp: "2026-06-15T00:00:00Z".to_string(),
                entity: "notebook".to_string(),
                entity_id: "notebook_import".to_string(),
                kind: "notebook.import_markdown_folder".to_string(),
                payload: serde_json::json!({"pageCount": 1}),
            }),
        };

        persist_import_batch_in_transaction(&mut connection, &batch).expect("persist import batch");

        let notebook_name: String = connection
            .query_row(
                "SELECT name FROM notebooks WHERE id = 'notebook_import'",
                [],
                |row| row.get(0),
            )
            .expect("notebook row");
        let content_json: String = connection
            .query_row(
                "SELECT content_json FROM pages WHERE id = 'page_import'",
                [],
                |row| row.get(0),
            )
            .expect("page content row");
        let fts_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM fts_pages WHERE fts_pages MATCH 'Imported OR Hello'",
                [],
                |row| row.get(0),
            )
            .expect("fts count");
        let operation_kind: String = connection
            .query_row(
                "SELECT kind FROM operation_log WHERE id = 'op_import'",
                [],
                |row| row.get(0),
            )
            .expect("operation row");

        assert_eq!(notebook_name, "Imported");
        assert_eq!(page_content_from_json(&content_json).blocks.len(), 2);
        assert_eq!(fts_count, 1);
        assert_eq!(operation_kind, "notebook.import_markdown_folder");
    }

    #[test]
    fn large_import_batch_persists_many_pages_and_blocks() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");

        let page_count = 1005;
        let block_count = 851;
        let notebook = NormalizedNotebook {
            id: "notebook_large_import".to_string(),
            name: "Large import".to_string(),
            page_ids: (0..page_count)
                .map(|index| format!("page_{index:04}"))
                .collect(),
            metadata: serde_json::json!({}),
        };
        let pages: Vec<NormalizedPage> = (0..page_count)
            .map(|index| NormalizedPage {
                id: format!("page_{index:04}"),
                notebook_id: notebook.id.clone(),
                parent_id: None,
                title: format!("Page {index:04}"),
                block_ids: if index < block_count {
                    vec![format!("block_{index:04}")]
                } else {
                    vec![]
                },
                block_order: Some("asc".to_string()),
                metadata: default_page_metadata(),
                created_at: "2026-06-15T06:00:00Z".to_string(),
                updated_at: "2026-06-15T06:00:00Z".to_string(),
            })
            .collect();
        let blocks: Vec<NormalizedBlock> = (0..block_count)
            .map(|index| NormalizedBlock {
                id: format!("block_{index:04}"),
                page_id: format!("page_{index:04}"),
                content: NormalizedRichContent {
                    html: format!("<p>Block {index:04}</p>"),
                    plain_text: format!("Block {index:04}"),
                },
                collapsed: false,
                pinned: false,
                created_at: "2026-06-15T06:00:00Z".to_string(),
                updated_at: "2026-06-15T06:00:00Z".to_string(),
            })
            .collect();

        persist_import_batch_in_transaction(&mut connection, &NormalizedImportBatch {
            notebook: notebook.clone(),
            pages: pages.clone(),
            blocks: blocks.clone(),
            operation: Some(NormalizedOperationLogEntry {
                id: "op_large_import".to_string(),
                timestamp: "2026-06-15T06:01:00Z".to_string(),
                entity: "notebook".to_string(),
                entity_id: notebook.id.clone(),
                kind: "notebook.import_markdown_folder".to_string(),
                payload: serde_json::json!({"pageCount": page_count, "blockCount": block_count}),
            }),
        }).expect("persist large import batch");

        let persisted_pages: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pages WHERE notebook_id = 'notebook_large_import'",
                [],
                |row| row.get(0),
            )
            .expect("persisted pages count");
        let persisted_blocks: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM fts_pages WHERE fts_pages MATCH 'Block 0001 OR Block 0850'",
                [],
                |row| row.get(0),
            )
            .expect("persisted fts count");
        assert_eq!(persisted_pages, page_count as i64);
        assert_eq!(persisted_blocks, 2);
    }

    #[test]
    fn rename_entity_updates_tables_fts_and_operation_log() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        rename_entity_in_transaction(
            &mut connection,
            &RenameEntityRequest {
                entity: "notebook".to_string(),
                entity_id: "notebook_demo".to_string(),
                name: "Renamed notebook".to_string(),
                operation: Some(NormalizedOperationLogEntry {
                    id: "op_rename_notebook".to_string(),
                    timestamp: "2026-06-15T01:00:00Z".to_string(),
                    entity: "notebook".to_string(),
                    entity_id: "notebook_demo".to_string(),
                    kind: "notebook.rename".to_string(),
                    payload: serde_json::json!({"name": "Renamed notebook"}),
                }),
            },
        )
        .expect("rename notebook");

        let notebook_name: String = connection
            .query_row(
                "SELECT name FROM notebooks WHERE id = 'notebook_demo'",
                [],
                |row| row.get(0),
            )
            .expect("renamed notebook row");
        assert_eq!(notebook_name, "Renamed notebook");

        rename_entity_in_transaction(
            &mut connection,
            &RenameEntityRequest {
                entity: "page".to_string(),
                entity_id: "page_demo".to_string(),
                name: "Renamed page".to_string(),
                operation: Some(NormalizedOperationLogEntry {
                    id: "op_rename_page".to_string(),
                    timestamp: "2026-06-15T01:01:00Z".to_string(),
                    entity: "page".to_string(),
                    entity_id: "page_demo".to_string(),
                    kind: "page.rename".to_string(),
                    payload: serde_json::json!({"title": "Renamed page"}),
                }),
            },
        )
        .expect("rename page");

        let page_title: String = connection
            .query_row(
                "SELECT title FROM pages WHERE id = 'page_demo'",
                [],
                |row| row.get(0),
            )
            .expect("renamed page row");
        assert_eq!(page_title, "Renamed page");

        let fts_match_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM fts_pages WHERE fts_pages MATCH 'Renamed'",
                [],
                |row| row.get(0),
            )
            .expect("renamed fts match count");
        assert_eq!(fts_match_count, 1);

        let operation_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM operation_log WHERE kind IN ('notebook.rename', 'page.rename')", [], |row| row.get(0))
            .expect("rename operation count");
        assert_eq!(operation_count, 2);
    }

    #[test]
    fn move_page_updates_parent_and_logs_operation() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");

        let batch = NormalizedImportBatch {
            notebook: NormalizedNotebook {
                id: "notebook_move".to_string(),
                name: "Move Demo".to_string(),
                page_ids: vec!["page_parent".to_string(), "page_child".to_string()],
                metadata: serde_json::json!({}),
            },
            pages: vec![
                NormalizedPage {
                    id: "page_parent".to_string(),
                    notebook_id: "notebook_move".to_string(),
                    parent_id: None,
                    title: "Parent".to_string(),
                    block_ids: vec![],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T00:00:00Z".to_string(),
                    updated_at: "2026-06-15T00:00:00Z".to_string(),
                },
                NormalizedPage {
                    id: "page_child".to_string(),
                    notebook_id: "notebook_move".to_string(),
                    parent_id: Some("page_parent".to_string()),
                    title: "Child".to_string(),
                    block_ids: vec![],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T00:00:00Z".to_string(),
                    updated_at: "2026-06-15T00:00:00Z".to_string(),
                },
            ],
            blocks: vec![],
            operation: None,
        };

        persist_import_batch_in_transaction(&mut connection, &batch).expect("seed pages");

        let cycle_result = move_page_in_transaction(
            &mut connection,
            &MovePageRequest {
                page_id: "page_parent".to_string(),
                notebook_id: "notebook_move".to_string(),
                parent_id: Some("page_child".to_string()),
                operation: None,
            },
        );
        assert!(cycle_result.is_err());

        move_page_in_transaction(
            &mut connection,
            &MovePageRequest {
                page_id: "page_child".to_string(),
                notebook_id: "notebook_move".to_string(),
                parent_id: None,
                operation: Some(NormalizedOperationLogEntry {
                    id: "op_move_page".to_string(),
                    timestamp: "2026-06-15T02:00:00Z".to_string(),
                    entity: "page".to_string(),
                    entity_id: "page_child".to_string(),
                    kind: "page.move".to_string(),
                    payload: serde_json::json!({"parentId": null}),
                }),
            },
        )
        .expect("move page to root");

        let parent_id: Option<String> = connection
            .query_row(
                "SELECT parent_id FROM pages WHERE id = 'page_child'",
                [],
                |row| row.get(0),
            )
            .expect("moved page row");
        assert!(parent_id.is_none());

        let operation_kind: String = connection
            .query_row(
                "SELECT kind FROM operation_log WHERE id = 'op_move_page'",
                [],
                |row| row.get(0),
            )
            .expect("move operation row");
        assert_eq!(operation_kind, "page.move");
    }

    #[test]
    fn move_page_to_another_notebook_moves_descendants() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");

        let batch = NormalizedImportBatch {
            notebook: NormalizedNotebook {
                id: "notebook_source".to_string(),
                name: "Source".to_string(),
                page_ids: vec!["page_parent".to_string(), "page_child".to_string()],
                metadata: serde_json::json!({}),
            },
            pages: vec![
                NormalizedPage {
                    id: "page_parent".to_string(),
                    notebook_id: "notebook_source".to_string(),
                    parent_id: None,
                    title: "Parent".to_string(),
                    block_ids: vec![],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T00:00:00Z".to_string(),
                    updated_at: "2026-06-15T00:00:00Z".to_string(),
                },
                NormalizedPage {
                    id: "page_child".to_string(),
                    notebook_id: "notebook_source".to_string(),
                    parent_id: Some("page_parent".to_string()),
                    title: "Child".to_string(),
                    block_ids: vec![],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T00:01:00Z".to_string(),
                    updated_at: "2026-06-15T00:01:00Z".to_string(),
                },
            ],
            blocks: vec![],
            operation: None,
        };
        persist_import_batch_in_transaction(&mut connection, &batch).expect("seed source pages");
        create_notebook_in_transaction(
            &mut connection,
            &CreateNotebookRequest {
                notebook: NormalizedNotebook {
                    id: "notebook_target".to_string(),
                    name: "Target".to_string(),
                    page_ids: vec!["page_target_home".to_string()],
                    metadata: serde_json::json!({}),
                },
                initial_page: NormalizedPage {
                    id: "page_target_home".to_string(),
                    notebook_id: "notebook_target".to_string(),
                    parent_id: None,
                    title: "Target home".to_string(),
                    block_ids: vec![],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T00:02:00Z".to_string(),
                    updated_at: "2026-06-15T00:02:00Z".to_string(),
                },
                operation: None,
            },
        )
        .expect("seed target notebook");

        move_page_in_transaction(
            &mut connection,
            &MovePageRequest {
                page_id: "page_parent".to_string(),
                notebook_id: "notebook_target".to_string(),
                parent_id: None,
                operation: None,
            },
        )
        .expect("move page tree");

        let child_notebook: String = connection
            .query_row(
                "SELECT notebook_id FROM pages WHERE id = 'page_child'",
                [],
                |row| row.get(0),
            )
            .expect("child notebook row");
        assert_eq!(child_notebook, "notebook_target");

        let child_parent: Option<String> = connection
            .query_row(
                "SELECT parent_id FROM pages WHERE id = 'page_child'",
                [],
                |row| row.get(0),
            )
            .expect("child parent row");
        assert_eq!(child_parent, Some("page_parent".to_string()));

        let target_pages_json: String = connection
            .query_row(
                "SELECT page_ids_json FROM notebooks WHERE id = 'notebook_target'",
                [],
                |row| row.get(0),
            )
            .expect("target page ids");
        let target_pages: Vec<String> = serde_json::from_str(&target_pages_json).expect("target page ids json");
        assert!(target_pages.contains(&"page_parent".to_string()));
        assert!(target_pages.contains(&"page_child".to_string()));
    }

    #[test]
    fn create_notebook_and_page_persist_rows_and_links() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");

        create_notebook_in_transaction(
            &mut connection,
            &CreateNotebookRequest {
                notebook: NormalizedNotebook {
                    id: "notebook_new".to_string(),
                    name: "New notebook".to_string(),
                    page_ids: vec!["page_new".to_string()],
                    metadata: serde_json::json!({}),
                },
                initial_page: NormalizedPage {
                    id: "page_new".to_string(),
                    notebook_id: "notebook_new".to_string(),
                    parent_id: None,
                    title: "Inbox".to_string(),
                    block_ids: vec![],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T03:00:00Z".to_string(),
                    updated_at: "2026-06-15T03:00:00Z".to_string(),
                },
                operation: Some(NormalizedOperationLogEntry {
                    id: "op_create_notebook".to_string(),
                    timestamp: "2026-06-15T03:00:00Z".to_string(),
                    entity: "notebook".to_string(),
                    entity_id: "notebook_new".to_string(),
                    kind: "notebook.create".to_string(),
                    payload: serde_json::json!({"name": "New notebook"}),
                }),
            },
        )
        .expect("create notebook");

        let notebook_pages: String = connection
            .query_row(
                "SELECT page_ids_json FROM notebooks WHERE id = 'notebook_new'",
                [],
                |row| row.get(0),
            )
            .expect("notebook page ids");
        assert_eq!(notebook_pages, serde_json::json!(["page_new"]).to_string());

        create_page_in_transaction(
            &mut connection,
            &CreatePageRequest {
                page: NormalizedPage {
                    id: "page_child_new".to_string(),
                    notebook_id: "notebook_new".to_string(),
                    parent_id: Some("page_new".to_string()),
                    title: "Child".to_string(),
                    block_ids: vec![],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T03:01:00Z".to_string(),
                    updated_at: "2026-06-15T03:01:00Z".to_string(),
                },
                operation: Some(NormalizedOperationLogEntry {
                    id: "op_create_page".to_string(),
                    timestamp: "2026-06-15T03:01:00Z".to_string(),
                    entity: "page".to_string(),
                    entity_id: "page_child_new".to_string(),
                    kind: "page.create".to_string(),
                    payload: serde_json::json!({"title": "Child"}),
                }),
            },
        )
        .expect("create page");

        let child_parent: Option<String> = connection
            .query_row(
                "SELECT parent_id FROM pages WHERE id = 'page_child_new'",
                [],
                |row| row.get(0),
            )
            .expect("created child page");
        assert_eq!(child_parent, Some("page_new".to_string()));

        let notebook_kind: String = connection
            .query_row(
                "SELECT kind FROM operation_log WHERE id = 'op_create_notebook'",
                [],
                |row| row.get(0),
            )
            .expect("create notebook op");
        assert_eq!(notebook_kind, "notebook.create");

        let page_kind: String = connection
            .query_row(
                "SELECT kind FROM operation_log WHERE id = 'op_create_page'",
                [],
                |row| row.get(0),
            )
            .expect("create page op");
        assert_eq!(page_kind, "page.create");
    }

    #[test]
    fn save_page_document_updates_content_without_overwriting_structure() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        let mut metadata = default_page_metadata();
        metadata.tags = vec!["sqlite".to_string(), "rich-text".to_string()];
        metadata.source_filename = Some("saved.md".to_string());
        let page = NormalizedPage {
            id: "page_demo".to_string(),
            notebook_id: "notebook_demo".to_string(),
            parent_id: None,
            title: "Saved document".to_string(),
            block_ids: vec!["block_saved".to_string()],
            block_order: Some("desc".to_string()),
            metadata,
            created_at: "2026-06-15T00:00:00Z".to_string(),
            updated_at: "2026-06-15T05:00:00Z".to_string(),
        };
        let blocks = vec![NormalizedBlock {
            id: "block_saved".to_string(),
            page_id: "page_demo".to_string(),
            content: NormalizedRichContent {
                html: "<p>Fresh SQLite body</p>".to_string(),
                plain_text: "Fresh SQLite body".to_string(),
            },
            collapsed: true,
            pinned: true,
            created_at: "2026-06-15T05:00:00Z".to_string(),
            updated_at: "2026-06-15T05:00:00Z".to_string(),
        }];

        save_page_document_in_transaction(
            &mut connection,
            &SavePageDocumentRequest {
                page,
                blocks,
                operation: Some(NormalizedOperationLogEntry {
                    id: "op_save_document".to_string(),
                    timestamp: "2026-06-15T05:00:00Z".to_string(),
                    entity: "page".to_string(),
                    entity_id: "page_demo".to_string(),
                    kind: "page.save_document".to_string(),
                    payload: serde_json::json!({"blockCount": 1}),
                }),
            },
        )
        .expect("save page document");

        let saved: (String, String, String, String, String) = connection
            .query_row(
                "SELECT title, block_ids_json, block_order, metadata_json, content_json FROM pages WHERE id = 'page_demo'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .expect("saved page row");
        assert_eq!(saved.0, "Inbox");
        assert_eq!(saved.1, serde_json::json!(["block_saved"]).to_string());
        assert_eq!(saved.2, "desc");
        assert!(saved.3.contains("saved.md"));
        assert!(saved.3.contains("sqlite"));
        assert_eq!(
            page_content_from_json(&saved.4).blocks[0]
                .content
                .plain_text,
            "Fresh SQLite body"
        );

        let fts_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM fts_pages WHERE fts_pages MATCH 'Fresh OR sqlite'",
                [],
                |row| row.get(0),
            )
            .expect("saved document fts match count");
        assert_eq!(fts_count, 1);

        let operation_kind: String = connection
            .query_row(
                "SELECT kind FROM operation_log WHERE id = 'op_save_document'",
                [],
                |row| row.get(0),
            )
            .expect("save document operation");
        assert_eq!(operation_kind, "page.save_document");
    }

    #[test]
    fn save_page_document_refuses_accidental_empty_overwrite() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");
        let page = NormalizedPage {
            id: "page_demo".to_string(),
            notebook_id: "notebook_demo".to_string(),
            parent_id: None,
            title: "Inbox".to_string(),
            block_ids: vec![],
            block_order: Some("asc".to_string()),
            metadata: default_page_metadata(),
            created_at: "2026-06-15T00:00:00Z".to_string(),
            updated_at: "2026-06-15T05:00:00Z".to_string(),
        };

        let result = save_page_document_in_transaction(
            &mut connection,
            &SavePageDocumentRequest {
                page,
                blocks: vec![],
                operation: None,
            },
        );

        assert!(result
            .expect_err("empty overwrite should fail")
            .contains("Refusing to overwrite non-empty page"));
        let content_json: String = connection
            .query_row(
                "SELECT content_json FROM pages WHERE id = 'page_demo'",
                [],
                |row| row.get(0),
            )
            .expect("page content");
        assert_eq!(page_content_from_json(&content_json).blocks.len(), 2);
    }

    #[test]
    fn page_document_save_records_revision_and_restore_can_recover_it() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");
        let page = load_page_metadata_from_database(&connection, "page_demo")
            .expect("page metadata")
            .expect("page exists");
        let next_block = NormalizedBlock {
            id: "block_saved".to_string(),
            page_id: "page_demo".to_string(),
            content: NormalizedRichContent {
                html: "<p>Fresh sqlite body</p>".to_string(),
                plain_text: "Fresh sqlite body".to_string(),
            },
            collapsed: false,
            pinned: false,
            created_at: "2026-06-15T05:00:00Z".to_string(),
            updated_at: "2026-06-15T05:00:00Z".to_string(),
        };

        save_page_document_in_transaction(
            &mut connection,
            &SavePageDocumentRequest {
                page: NormalizedPage {
                    block_ids: vec![next_block.id.clone()],
                    updated_at: "2026-06-15T05:00:00Z".to_string(),
                    ..page
                },
                blocks: vec![next_block],
                operation: Some(NormalizedOperationLogEntry {
                    id: "op_save_revision".to_string(),
                    timestamp: "2026-06-15T05:00:00Z".to_string(),
                    entity: "page".to_string(),
                    entity_id: "page_demo".to_string(),
                    kind: "page.save_document".to_string(),
                    payload: serde_json::json!({}),
                }),
            },
        )
        .expect("save revised page");

        let revisions = list_page_revisions_from_database(&connection, "page_demo", None)
            .expect("page revisions");
        assert_eq!(revisions.len(), 1);
        assert_eq!(revisions[0].content.blocks.len(), 2);
        assert_eq!(
            revisions[0].content.blocks[0].content.plain_text,
            "Hello world"
        );

        restore_page_revision_in_transaction(
            &mut connection,
            &RestorePageRevisionRequest {
                page_id: "page_demo".to_string(),
                revision_id: revisions[0].id,
                operation: Some(NormalizedOperationLogEntry {
                    id: "op_restore_revision".to_string(),
                    timestamp: "2026-06-15T05:10:00Z".to_string(),
                    entity: "page".to_string(),
                    entity_id: "page_demo".to_string(),
                    kind: "page.restore_revision".to_string(),
                    payload: serde_json::json!({"revisionId": revisions[0].id}),
                }),
            },
        )
        .expect("restore revision");

        let restored = load_page_document_from_database(&connection, "page_demo")
            .expect("load restored page")
            .expect("restored page exists");
        assert_eq!(restored.content.blocks.len(), 2);
        assert_eq!(restored.content.blocks[0].id, "block_a");
        assert_eq!(restored.content.blocks[0].content.plain_text, "Hello world");
    }

    #[test]
    fn metadata_update_does_not_create_page_revision() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");
        let mut metadata = default_page_metadata();
        metadata.tags = vec!["metadataonly".to_string()];

        update_page_metadata_in_transaction(
            &mut connection,
            &UpdatePageMetadataRequest {
                page_id: "page_demo".to_string(),
                metadata,
                operation: None,
            },
        )
        .expect("update metadata");

        let revision_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM page_revisions", [], |row| row.get(0))
            .expect("revision count");
        assert_eq!(revision_count, 0);
        let content_json: String = connection
            .query_row(
                "SELECT content_json FROM pages WHERE id = 'page_demo'",
                [],
                |row| row.get(0),
            )
            .expect("page content");
        assert_eq!(page_content_from_json(&content_json).blocks.len(), 2);
        let fts_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM fts_pages WHERE fts_pages MATCH 'metadataonly'",
                [],
                |row| row.get(0),
            )
            .expect("metadata fts count");
        assert_eq!(fts_count, 1);
    }

    #[test]
    fn page_revisions_are_pruned_per_page() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        for index in 0..(PAGE_REVISION_LIMIT + 5) {
            let page = load_page_metadata_from_database(&connection, "page_demo")
                .expect("page metadata")
                .expect("page exists");
            let block = NormalizedBlock {
                id: format!("block_saved_{index}"),
                page_id: "page_demo".to_string(),
                content: NormalizedRichContent {
                    html: format!("<p>Version {index}</p>"),
                    plain_text: format!("Version {index}"),
                },
                collapsed: false,
                pinned: false,
                created_at: format!("2026-06-15T05:{index:02}:00Z"),
                updated_at: format!("2026-06-15T05:{index:02}:00Z"),
            };
            save_page_document_in_transaction(
                &mut connection,
                &SavePageDocumentRequest {
                    page: NormalizedPage {
                        block_ids: vec![block.id.clone()],
                        updated_at: block.updated_at.clone(),
                        ..page
                    },
                    blocks: vec![block],
                    operation: None,
                },
            )
            .expect("save page revision");
        }

        let revision_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM page_revisions", [], |row| row.get(0))
            .expect("revision count");
        assert_eq!(revision_count, PAGE_REVISION_LIMIT);
    }

    #[test]
    fn delete_page_tree_removes_descendants_updates_notebook_and_keeps_fallback_page() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");

        let batch = NormalizedImportBatch {
            notebook: NormalizedNotebook {
                id: "notebook_delete_page".to_string(),
                name: "Delete Page Demo".to_string(),
                page_ids: vec![
                    "page_root".to_string(),
                    "page_child".to_string(),
                    "page_sibling".to_string(),
                ],
                metadata: serde_json::json!({}),
            },
            pages: vec![
                NormalizedPage {
                    id: "page_root".to_string(),
                    notebook_id: "notebook_delete_page".to_string(),
                    parent_id: None,
                    title: "Root".to_string(),
                    block_ids: vec!["block_root".to_string()],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T04:00:00Z".to_string(),
                    updated_at: "2026-06-15T04:00:00Z".to_string(),
                },
                NormalizedPage {
                    id: "page_child".to_string(),
                    notebook_id: "notebook_delete_page".to_string(),
                    parent_id: Some("page_root".to_string()),
                    title: "Child".to_string(),
                    block_ids: vec!["block_child".to_string()],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T04:00:00Z".to_string(),
                    updated_at: "2026-06-15T04:00:00Z".to_string(),
                },
                NormalizedPage {
                    id: "page_sibling".to_string(),
                    notebook_id: "notebook_delete_page".to_string(),
                    parent_id: None,
                    title: "Sibling".to_string(),
                    block_ids: vec!["block_sibling".to_string()],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T04:00:00Z".to_string(),
                    updated_at: "2026-06-15T04:00:00Z".to_string(),
                },
            ],
            blocks: vec![
                NormalizedBlock {
                    id: "block_root".to_string(),
                    page_id: "page_root".to_string(),
                    content: NormalizedRichContent {
                        html: "<p>Root text</p>".to_string(),
                        plain_text: "Root text".to_string(),
                    },
                    collapsed: false,
                    pinned: false,
                    created_at: "2026-06-15T04:00:00Z".to_string(),
                    updated_at: "2026-06-15T04:00:00Z".to_string(),
                },
                NormalizedBlock {
                    id: "block_child".to_string(),
                    page_id: "page_child".to_string(),
                    content: NormalizedRichContent {
                        html: "<p>Child text</p>".to_string(),
                        plain_text: "Child text".to_string(),
                    },
                    collapsed: false,
                    pinned: false,
                    created_at: "2026-06-15T04:00:00Z".to_string(),
                    updated_at: "2026-06-15T04:00:00Z".to_string(),
                },
                NormalizedBlock {
                    id: "block_sibling".to_string(),
                    page_id: "page_sibling".to_string(),
                    content: NormalizedRichContent {
                        html: "<p>Sibling text</p>".to_string(),
                        plain_text: "Sibling text".to_string(),
                    },
                    collapsed: false,
                    pinned: false,
                    created_at: "2026-06-15T04:00:00Z".to_string(),
                    updated_at: "2026-06-15T04:00:00Z".to_string(),
                },
            ],
            operation: None,
        };

        persist_import_batch_in_transaction(&mut connection, &batch)
            .expect("seed delete tree notebook");

        delete_page_tree_in_transaction(
            &mut connection,
            &DeletePageTreeRequest {
                page_id: "page_root".to_string(),
                fallback_page: None,
                operation: Some(NormalizedOperationLogEntry {
                    id: "op_delete_tree".to_string(),
                    timestamp: "2026-06-15T04:01:00Z".to_string(),
                    entity: "page".to_string(),
                    entity_id: "page_root".to_string(),
                    kind: "page.delete_tree".to_string(),
                    payload: serde_json::json!({"pageCount": 2, "blockCount": 2}),
                }),
            },
        )
        .expect("delete page tree");

        let remaining_pages: Vec<String> = connection
            .prepare("SELECT id FROM pages WHERE notebook_id = 'notebook_delete_page' ORDER BY id")
            .expect("remaining pages stmt")
            .query_map([], |row| row.get(0))
            .expect("remaining pages query")
            .collect::<Result<Vec<_>, _>>()
            .expect("remaining pages collect");
        assert_eq!(remaining_pages, vec!["page_sibling".to_string()]);

        let notebook_pages: String = connection
            .query_row(
                "SELECT page_ids_json FROM notebooks WHERE id = 'notebook_delete_page'",
                [],
                |row| row.get(0),
            )
            .expect("notebook page ids after delete");
        assert_eq!(
            notebook_pages,
            serde_json::json!(["page_sibling"]).to_string()
        );

        let fts_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM fts_pages WHERE page_id IN ('page_root', 'page_child')",
                [],
                |row| row.get(0),
            )
            .expect("deleted fts count");
        assert_eq!(fts_count, 0);

        let operation_kind: String = connection
            .query_row(
                "SELECT kind FROM operation_log WHERE id = 'op_delete_tree'",
                [],
                |row| row.get(0),
            )
            .expect("delete tree operation");
        assert_eq!(operation_kind, "page.delete_tree");
    }

    #[test]
    fn delete_page_tree_inserts_fallback_page_for_empty_notebook() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");

        let batch = NormalizedImportBatch {
            notebook: NormalizedNotebook {
                id: "notebook_fallback".to_string(),
                name: "Fallback Demo".to_string(),
                page_ids: vec!["page_only".to_string()],
                metadata: serde_json::json!({}),
            },
            pages: vec![NormalizedPage {
                id: "page_only".to_string(),
                notebook_id: "notebook_fallback".to_string(),
                parent_id: None,
                title: "Only".to_string(),
                block_ids: vec![],
                block_order: Some("asc".to_string()),
                metadata: default_page_metadata(),
                created_at: "2026-06-15T04:10:00Z".to_string(),
                updated_at: "2026-06-15T04:10:00Z".to_string(),
            }],
            blocks: vec![],
            operation: None,
        };

        persist_import_batch_in_transaction(&mut connection, &batch)
            .expect("seed fallback notebook");

        let fallback_page = NormalizedPage {
            id: "page_fallback".to_string(),
            notebook_id: "notebook_fallback".to_string(),
            parent_id: None,
            title: "Inbox".to_string(),
            block_ids: vec![],
            block_order: Some("asc".to_string()),
            metadata: default_page_metadata(),
            created_at: "2026-06-15T04:11:00Z".to_string(),
            updated_at: "2026-06-15T04:11:00Z".to_string(),
        };

        delete_page_tree_in_transaction(
            &mut connection,
            &DeletePageTreeRequest {
                page_id: "page_only".to_string(),
                fallback_page: Some(fallback_page.clone()),
                operation: None,
            },
        )
        .expect("delete page tree with fallback");

        let notebook_pages: String = connection
            .query_row(
                "SELECT page_ids_json FROM notebooks WHERE id = 'notebook_fallback'",
                [],
                |row| row.get(0),
            )
            .expect("fallback notebook page ids");
        assert_eq!(
            notebook_pages,
            serde_json::json!(["page_fallback"]).to_string()
        );

        let page_title: String = connection
            .query_row(
                "SELECT title FROM pages WHERE id = 'page_fallback'",
                [],
                |row| row.get(0),
            )
            .expect("fallback page row");
        assert_eq!(page_title, "Inbox");
    }

    #[test]
    fn delete_block_trashes_and_restore_reinserts_at_original_index() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        delete_block_in_transaction(
            &mut connection,
            &DeleteBlockRequest {
                page_id: "page_demo".to_string(),
                block_id: "block_a".to_string(),
                operation: Some(NormalizedOperationLogEntry {
                    id: "op_delete_block".to_string(),
                    timestamp: "2026-06-15T04:40:00Z".to_string(),
                    entity: "block".to_string(),
                    entity_id: "block_a".to_string(),
                    kind: "block.delete".to_string(),
                    payload: serde_json::json!({"pageId": "page_demo"}),
                }),
            },
        )
        .expect("delete block");

        let document = load_page_documents_from_database(&connection, &["page_demo".to_string()])
            .expect("load page document")
            .pop()
            .expect("page document");
        assert_eq!(
            document
                .content
                .blocks
                .iter()
                .map(|block| block.id.as_str())
                .collect::<Vec<_>>(),
            vec!["block_b"]
        );

        let trash_items = list_trash_items_from_database(&connection, None).expect("list trash");
        assert_eq!(trash_items.len(), 1);
        assert_eq!(trash_items[0].item_type, "block");
        assert_eq!(trash_items[0].source_id, "block_a");
        assert_eq!(trash_items[0].parent_id.as_deref(), Some("page_demo"));

        restore_trash_item_in_transaction(
            &mut connection,
            &RestoreTrashItemRequest {
                trash_id: trash_items[0].id,
                operation: Some(NormalizedOperationLogEntry {
                    id: "op_restore_block".to_string(),
                    timestamp: "2026-06-15T04:41:00Z".to_string(),
                    entity: "block".to_string(),
                    entity_id: "block_a".to_string(),
                    kind: "block.restore_delete".to_string(),
                    payload: serde_json::json!({"trashId": trash_items[0].id}),
                }),
            },
        )
        .expect("restore block");

        let restored_document =
            load_page_documents_from_database(&connection, &["page_demo".to_string()])
                .expect("load restored page document")
                .pop()
                .expect("restored page document");
        assert_eq!(
            restored_document
                .content
                .blocks
                .iter()
                .map(|block| block.id.as_str())
                .collect::<Vec<_>>(),
            vec!["block_a", "block_b"]
        );
        assert!(list_trash_items_from_database(&connection, None)
            .expect("list trash after restore")
            .is_empty());
    }

    #[test]
    fn delete_page_tree_trashes_and_restore_preserves_notebook_order() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");

        let batch = NormalizedImportBatch {
            notebook: NormalizedNotebook {
                id: "notebook_restore_page".to_string(),
                name: "Restore Page Demo".to_string(),
                page_ids: vec![
                    "page_root".to_string(),
                    "page_child".to_string(),
                    "page_sibling".to_string(),
                ],
                metadata: serde_json::json!({}),
            },
            pages: vec![
                NormalizedPage {
                    id: "page_root".to_string(),
                    notebook_id: "notebook_restore_page".to_string(),
                    parent_id: None,
                    title: "Root".to_string(),
                    block_ids: vec![],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T04:50:00Z".to_string(),
                    updated_at: "2026-06-15T04:50:00Z".to_string(),
                },
                NormalizedPage {
                    id: "page_child".to_string(),
                    notebook_id: "notebook_restore_page".to_string(),
                    parent_id: Some("page_root".to_string()),
                    title: "Child".to_string(),
                    block_ids: vec![],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T04:50:00Z".to_string(),
                    updated_at: "2026-06-15T04:50:00Z".to_string(),
                },
                NormalizedPage {
                    id: "page_sibling".to_string(),
                    notebook_id: "notebook_restore_page".to_string(),
                    parent_id: None,
                    title: "Sibling".to_string(),
                    block_ids: vec![],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T04:50:00Z".to_string(),
                    updated_at: "2026-06-15T04:50:00Z".to_string(),
                },
            ],
            blocks: vec![],
            operation: None,
        };

        persist_import_batch_in_transaction(&mut connection, &batch)
            .expect("seed restore page notebook");
        delete_page_tree_in_transaction(
            &mut connection,
            &DeletePageTreeRequest {
                page_id: "page_root".to_string(),
                fallback_page: None,
                operation: None,
            },
        )
        .expect("delete page tree");

        let trash_items = list_trash_items_from_database(&connection, None).expect("list trash");
        assert_eq!(trash_items.len(), 1);
        assert_eq!(trash_items[0].item_type, "page");
        assert_eq!(trash_items[0].source_id, "page_root");

        restore_trash_item_in_transaction(
            &mut connection,
            &RestoreTrashItemRequest {
                trash_id: trash_items[0].id,
                operation: None,
            },
        )
        .expect("restore page tree");

        let page_ids_json: String = connection
            .query_row(
                "SELECT page_ids_json FROM notebooks WHERE id = 'notebook_restore_page'",
                [],
                |row| row.get(0),
            )
            .expect("restored notebook page ids");
        assert_eq!(
            page_ids_json,
            serde_json::json!(["page_root", "page_child", "page_sibling"]).to_string()
        );
        let restored_pages: Vec<String> = connection
            .prepare("SELECT id FROM pages WHERE notebook_id = 'notebook_restore_page' ORDER BY id")
            .expect("restored pages stmt")
            .query_map([], |row| row.get(0))
            .expect("restored pages query")
            .collect::<Result<Vec<_>, _>>()
            .expect("restored pages collect");
        assert_eq!(
            restored_pages,
            vec![
                "page_child".to_string(),
                "page_root".to_string(),
                "page_sibling".to_string()
            ]
        );
    }

    #[test]
    fn delete_notebook_removes_notebook_pages_fts_and_logs_operation() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");

        let batch = NormalizedImportBatch {
            notebook: NormalizedNotebook {
                id: "notebook_delete".to_string(),
                name: "Delete Demo".to_string(),
                page_ids: vec!["page_delete_a".to_string(), "page_delete_b".to_string()],
                metadata: serde_json::json!({}),
            },
            pages: vec![
                NormalizedPage {
                    id: "page_delete_a".to_string(),
                    notebook_id: "notebook_delete".to_string(),
                    parent_id: None,
                    title: "Delete A".to_string(),
                    block_ids: vec![],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T04:20:00Z".to_string(),
                    updated_at: "2026-06-15T04:20:00Z".to_string(),
                },
                NormalizedPage {
                    id: "page_delete_b".to_string(),
                    notebook_id: "notebook_delete".to_string(),
                    parent_id: None,
                    title: "Delete B".to_string(),
                    block_ids: vec![],
                    block_order: Some("asc".to_string()),
                    metadata: default_page_metadata(),
                    created_at: "2026-06-15T04:20:00Z".to_string(),
                    updated_at: "2026-06-15T04:20:00Z".to_string(),
                },
            ],
            blocks: vec![],
            operation: None,
        };

        persist_import_batch_in_transaction(&mut connection, &batch).expect("seed delete notebook");
        upsert_notebook(
            &connection,
            &NormalizedNotebook {
                id: "notebook_spare".to_string(),
                name: "Spare Notebook".to_string(),
                page_ids: vec![],
                metadata: serde_json::json!({}),
            },
        )
        .expect("seed spare notebook");

        delete_notebook_in_transaction(
            &mut connection,
            &DeleteNotebookRequest {
                notebook_id: "notebook_delete".to_string(),
                operation: Some(NormalizedOperationLogEntry {
                    id: "op_delete_notebook".to_string(),
                    timestamp: "2026-06-15T04:21:00Z".to_string(),
                    entity: "notebook".to_string(),
                    entity_id: "notebook_delete".to_string(),
                    kind: "notebook.delete".to_string(),
                    payload: serde_json::json!({"pageCount": 2}),
                }),
            },
        )
        .expect("delete notebook");

        let notebook_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM notebooks WHERE id = 'notebook_delete'",
                [],
                |row| row.get(0),
            )
            .expect("deleted notebook count");
        assert_eq!(notebook_count, 0);

        let page_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pages WHERE notebook_id = 'notebook_delete'",
                [],
                |row| row.get(0),
            )
            .expect("deleted page count");
        assert_eq!(page_count, 0);

        let fts_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM fts_pages WHERE page_id IN ('page_delete_a', 'page_delete_b')", [], |row| row.get(0))
            .expect("deleted notebook fts count");
        assert_eq!(fts_count, 0);

        let operation_kind: String = connection
            .query_row(
                "SELECT kind FROM operation_log WHERE id = 'op_delete_notebook'",
                [],
                |row| row.get(0),
            )
            .expect("delete notebook operation");
        assert_eq!(operation_kind, "notebook.delete");
    }

    #[test]
    fn delete_notebook_refuses_to_remove_the_last_notebook() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");

        let batch = NormalizedImportBatch {
            notebook: NormalizedNotebook {
                id: "notebook_single".to_string(),
                name: "Single Notebook".to_string(),
                page_ids: vec!["page_single".to_string()],
                metadata: serde_json::json!({}),
            },
            pages: vec![NormalizedPage {
                id: "page_single".to_string(),
                notebook_id: "notebook_single".to_string(),
                parent_id: None,
                title: "Only page".to_string(),
                block_ids: vec![],
                block_order: Some("asc".to_string()),
                metadata: default_page_metadata(),
                created_at: "2026-06-15T04:30:00Z".to_string(),
                updated_at: "2026-06-15T04:30:00Z".to_string(),
            }],
            blocks: vec![],
            operation: None,
        };

        persist_import_batch_in_transaction(&mut connection, &batch).expect("seed single notebook");

        let result = delete_notebook_in_transaction(
            &mut connection,
            &DeleteNotebookRequest {
                notebook_id: "notebook_single".to_string(),
                operation: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn fts_pages_indexes_title_body_and_metadata() {
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");

        let match_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM fts_pages WHERE fts_pages MATCH 'hello OR demo'",
                [],
                |row| row.get(0),
            )
            .expect("fts match count");
        assert_eq!(match_count, 1);
    }

    #[test]
    fn search_pages_prioritizes_title_matches() {
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        connection
            .execute(
                "INSERT INTO notebooks (id, name, page_ids_json, metadata_json) VALUES ('notebook_search', 'Search', '[]', '{}')",
                [],
            )
            .expect("insert notebook");
        for (id, title, search_text) in [
            ("page_body_match", "Distributed notes", "cuda cuda cuda tensor kernels"),
            ("page_title_match", "CUDA notes", "general gpu notes"),
        ] {
            connection
                .execute(
                    "
                    INSERT INTO pages (id, notebook_id, title, block_ids_json, block_order, metadata_json, content_json, search_text)
                    VALUES (?1, 'notebook_search', ?2, '[]', 'asc', '{}', '{}', ?3)
                    ",
                    params![id, title, search_text],
                )
                .expect("insert page");
            connection
                .execute(
                    "INSERT INTO fts_pages (page_id, title, search_text, metadata_text) VALUES (?1, ?2, ?3, '')",
                    params![id, title, search_text],
                )
                .expect("insert fts page");
        }

        let results = search_pages_in_database(&connection, "cuda", Some(10)).expect("search pages");
        assert_eq!(results.first().map(|result| result.page_id.as_str()), Some("page_title_match"));
    }

    #[test]
    fn search_text_is_converted_to_safe_fts_query() {
        assert_eq!(
            fts_query_from_search_text("hello world"),
            Some("\"hello\" \"world\"".to_string())
        );
        assert_eq!(
            fts_query_from_search_text("  #demo!  "),
            Some("\"demo\"".to_string())
        );
        assert_eq!(
            fts_query_from_search_text("中文"),
            Some("\"中文\"".to_string())
        );
    }

    #[test]
    fn normalized_state_reads_back_as_app_state_json() {
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");
        rebuild_normalized_tables(&connection, &demo_normalized_state())
            .expect("normalized rebuild");
        save_workspace_preferences_in_transaction(
            &mut connection,
            &WorkspacePreferencesRequest {
                active_notebook_id: "notebook_demo".to_string(),
                active_page_id: "page_demo".to_string(),
                shell: "typora-base".to_string(),
                theme: "ledger".to_string(),
                content_theme: "typora-swiss".to_string(),
                open_card_window_block_id: Some("block_b".to_string()),
                expanded_page_ids: vec!["page_demo".to_string(), "missing_page".to_string()],
                show_page_metadata: true,
            },
        )
        .expect("save workspace preferences");

        let raw = read_normalized_state_json(&connection)
            .expect("read normalized state")
            .expect("state json");
        let state =
            serde_json::from_str::<NormalizedAppState>(&raw).expect("normalized state json");

        assert_eq!(state.notebooks.len(), 1);
        assert_eq!(state.notebooks[0].name, "Demo");
        assert_eq!(state.pages.len(), 1);
        assert_eq!(state.pages[0].title, "Inbox");
        assert_eq!(state.blocks.len(), 2);
        assert_eq!(state.blocks[0].content.plain_text, "Hello world");
        assert_eq!(state.active_page_id, "page_demo");
        assert_eq!(state.shell, "typora-base");
        assert_eq!(state.theme, "ledger");
        assert_eq!(state.content_theme, "typora-swiss");
        assert_eq!(state.open_card_window_block_id.as_deref(), Some("block_b"));
        assert_eq!(
            state.expanded_page_ids,
            vec!["page_demo".to_string(), "missing_page".to_string()]
        );
        assert_eq!(state.operations.len(), 1);
        assert_eq!(state.operations[0].kind, "page.create");
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

    #[test]
    fn cleanup_orphan_attachments_removes_unreferenced_files_and_rows() {
        let app_data = tempfile::tempdir().expect("app data temp dir");
        let connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");

        let kept = import_asset_bytes_into_store(
            &connection,
            app_data.path().to_path_buf(),
            "keep.png".to_string(),
            "image/png".to_string(),
            b"keep image payload".to_vec(),
        )
        .expect("kept asset import");
        let removed = import_asset_bytes_into_store(
            &connection,
            app_data.path().to_path_buf(),
            "remove.png".to_string(),
            "image/png".to_string(),
            b"remove image payload".to_vec(),
        )
        .expect("removed asset import");

        assert_eq!(row_count(&connection), 2);
        assert!(Path::new(&kept.stored_path).is_file());
        assert!(Path::new(&removed.stored_path).is_file());

        let result = cleanup_orphan_attachments_in_store(
            &connection,
            app_data.path().to_path_buf(),
            vec![kept.id.clone()],
        )
        .expect("cleanup orphan attachments");

        assert_eq!(result.removed_count, 1);
        assert_eq!(row_count(&connection), 1);
        assert!(Path::new(&kept.stored_path).is_file());
        assert!(!Path::new(&removed.stored_path).exists());
    }

    #[test]
    fn database_attachment_cleanup_scans_page_documents() {
        let app_data = tempfile::tempdir().expect("app data temp dir");
        let mut connection = Connection::open_in_memory().expect("memory database");
        initialize_database(&connection).expect("database schema");

        let kept = import_asset_bytes_into_store(
            &connection,
            app_data.path().to_path_buf(),
            "keep-from-doc.png".to_string(),
            "image/png".to_string(),
            b"keep from document".to_vec(),
        )
        .expect("kept asset import");
        let removed = import_asset_bytes_into_store(
            &connection,
            app_data.path().to_path_buf(),
            "remove-from-doc.png".to_string(),
            "image/png".to_string(),
            b"remove from document".to_vec(),
        )
        .expect("removed asset import");

        let batch = NormalizedImportBatch {
            notebook: NormalizedNotebook {
                id: "notebook_assets".to_string(),
                name: "Assets".to_string(),
                page_ids: vec!["page_assets".to_string()],
                metadata: serde_json::json!({}),
            },
            pages: vec![NormalizedPage {
                id: "page_assets".to_string(),
                notebook_id: "notebook_assets".to_string(),
                parent_id: None,
                title: "Assets".to_string(),
                block_ids: vec!["block_assets".to_string()],
                block_order: Some("asc".to_string()),
                metadata: default_page_metadata(),
                created_at: "2026-06-16T00:00:00Z".to_string(),
                updated_at: "2026-06-16T00:00:00Z".to_string(),
            }],
            blocks: vec![NormalizedBlock {
                id: "block_assets".to_string(),
                page_id: "page_assets".to_string(),
                content: NormalizedRichContent {
                    html: format!(
                        "<p><img src=\"{}\" data-asset-id=\"{}\"></p>",
                        kept.asset_url, kept.id
                    ),
                    plain_text: "asset reference".to_string(),
                },
                collapsed: false,
                pinned: false,
                created_at: "2026-06-16T00:00:00Z".to_string(),
                updated_at: "2026-06-16T00:00:00Z".to_string(),
            }],
            operation: None,
        };
        persist_import_batch_in_transaction(&mut connection, &batch)
            .expect("persist asset reference page");

        let result =
            cleanup_orphan_attachments_from_database(&connection, app_data.path().to_path_buf())
                .expect("database attachment cleanup");

        assert_eq!(result.removed_count, 1);
        assert_eq!(row_count(&connection), 1);
        assert!(Path::new(&kept.stored_path).is_file());
        assert!(!Path::new(&removed.stored_path).exists());
    }
}
