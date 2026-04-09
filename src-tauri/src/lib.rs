use http::header::{CONTENT_RANGE, CONTENT_TYPE, RANGE};
use http::{Response, StatusCode};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType as PngCompressionType, FilterType as PngFilterType, PngEncoder};
use image::imageops::FilterType;
use image::{ColorType, ImageEncoder, ImageReader};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::io::{BufRead, BufReader, Write};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tauri::path::BaseDirectory;
use tauri::Manager;
use tauri::{AppHandle, Emitter, RunEvent, State};

mod chrome;

#[derive(Clone)]
pub struct VaultPath(pub Arc<Mutex<Option<PathBuf>>>);

#[derive(Clone)]
pub struct VaultConfigured(pub Arc<Mutex<bool>>);

struct VaultResolution {
  startup_path: Option<PathBuf>,
  display_path: PathBuf,
  should_prompt: bool,
}

#[derive(Serialize)]
struct VaultStatusPayload {
  path: String,
  configured: bool,
}

struct NodeInner {
  child: Child,
  stdin: Mutex<std::process::ChildStdin>,
  next_id: AtomicU32,
  pending: Mutex<HashMap<u32, Sender<Result<Value, String>>>>,
}

#[derive(Clone)]
pub struct NodeService(Arc<Mutex<Option<NodeInner>>>);

fn repo_root() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .expect("src-tauri has parent")
    .to_path_buf()
}

fn resolve_bundle_root(app: &AppHandle) -> Result<PathBuf, String> {
  let dev_root = repo_root();
  let dev_bridge = dev_root.join("dist-node/bridge.cjs");
  if dev_bridge.is_file() {
    return Ok(dev_root);
  }
  let res = app.path().resource_dir().map_err(|e| e.to_string())?;
  let packaged = res.join("dist-node/bridge.cjs");
  if packaged.is_file() {
    return Ok(res);
  }
  Err(format!(
    "Node bridge not found (dev: {}, packaged: {})",
    dev_bridge.display(),
    packaged.display()
  ))
}

/// Historical Stash desktop app support path (same layout as the pre-Tauri shell on each OS).
fn legacy_stash_app_support_dir() -> Option<PathBuf> {
  #[cfg(target_os = "macos")]
  {
    return std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/stash"));
  }
  #[cfg(target_os = "windows")]
  {
    return std::env::var_os("APPDATA").map(|h| PathBuf::from(h).join("stash"));
  }
  #[cfg(target_os = "linux")]
  {
    return std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config/stash"));
  }
  #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
  {
    None
  }
}

fn read_vault_from_file(config_path: &Path) -> Option<PathBuf> {
  let raw = std::fs::read_to_string(config_path).ok()?;
  let v: Value = serde_json::from_str(&raw).ok()?;
  let path = v.get("vaultPath")?.as_str()?;
  let pb = PathBuf::from(path);
  if pb.is_dir() {
    Some(pb)
  } else {
    None
  }
}

fn read_vault_from_config(app_data_candidates: &[PathBuf]) -> Option<PathBuf> {
  for root in app_data_candidates {
    let p = root.join("vault-config.json");
    if let Some(v) = read_vault_from_file(&p) {
      return Some(v);
    }
  }
  None
}

fn write_vault_config(app_data: &Path, vault: &Path) -> Result<(), String> {
  std::fs::create_dir_all(app_data).map_err(|e| e.to_string())?;
  let p = app_data.join("vault-config.json");
  let j = json!({ "vaultPath": vault.to_string_lossy() });
  std::fs::write(&p, serde_json::to_string_pretty(&j).unwrap()).map_err(|e| e.to_string())
}

fn default_vault_path() -> PathBuf {
  std::env::var("HOME")
    .map(PathBuf::from)
    .unwrap_or_else(|_| PathBuf::from("/"))
    .join("Stash")
}

fn resolve_node_binary() -> PathBuf {
  if let Ok(raw) = std::env::var("STASH_NODE_BINARY") {
    let candidate = PathBuf::from(raw);
    if candidate.is_file() {
      return candidate;
    }
  }

  let mut candidates = vec![
    PathBuf::from("/opt/homebrew/bin/node"),
    PathBuf::from("/usr/local/bin/node"),
  ];

  if let Some(home) = std::env::var_os("HOME") {
    let nvm_root = PathBuf::from(home).join(".nvm/versions/node");
    if let Ok(entries) = std::fs::read_dir(nvm_root) {
      let mut versions: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .collect();
      versions.sort();
      versions.reverse();
      for version_dir in versions {
        candidates.push(version_dir.join("bin/node"));
      }
    }
  }

  candidates
    .into_iter()
    .find(|candidate| candidate.is_file())
    .unwrap_or_else(|| PathBuf::from("node"))
}

fn resolve_tauri_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
  app
    .path()
    .resolve("", BaseDirectory::AppData)
    .map_err(|e| e.to_string())
}

fn resolve_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
  if let Some(p) = legacy_stash_app_support_dir() {
    return Ok(p);
  }
  resolve_tauri_app_data_dir(app)
}

fn packaged_vault_confirmation_marker(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(resolve_tauri_app_data_dir(app)?.join("vault-confirmed"))
}

fn has_packaged_vault_confirmation(app: &AppHandle) -> bool {
  if cfg!(debug_assertions) {
    return true;
  }

  packaged_vault_confirmation_marker(app)
    .map(|path| path.is_file())
    .unwrap_or(false)
}

fn write_packaged_vault_confirmation(app: &AppHandle) -> Result<(), String> {
  if cfg!(debug_assertions) {
    return Ok(());
  }

  let marker = packaged_vault_confirmation_marker(app)?;
  if let Some(parent) = marker.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  std::fs::write(marker, b"confirmed").map_err(|e| e.to_string())
}

fn resolve_vault_path(app: &AppHandle) -> Result<VaultResolution, String> {
  if let Ok(raw) = std::env::var("STASH_VAULT_PATH") {
    let pb = PathBuf::from(raw);
    if pb.is_dir() {
      return Ok(VaultResolution {
        startup_path: Some(pb.clone()),
        display_path: pb,
        should_prompt: false,
      });
    }
  }

  let tauri_app_data = resolve_tauri_app_data_dir(app)?;
  let mut candidates: Vec<PathBuf> = Vec::new();
  if let Some(p) = legacy_stash_app_support_dir() {
    candidates.push(p);
  }
  candidates.push(tauri_app_data);

  if let Some(p) = read_vault_from_config(&candidates) {
    if has_packaged_vault_confirmation(app) {
      return Ok(VaultResolution {
        startup_path: Some(p.clone()),
        display_path: p,
        should_prompt: false,
      });
    }

    return Ok(VaultResolution {
      startup_path: None,
      display_path: p,
      should_prompt: true,
    });
  }

  // On first launch we only suggest the historical default path. We don't start the bridge or
  // persist anything until the user explicitly confirms a vault folder.
  Ok(VaultResolution {
    startup_path: None,
    display_path: default_vault_path(),
    should_prompt: true,
  })
}

/// Kill the Node bridge, persist the new vault path, spawn a fresh bridge (same pattern as startup).
pub(crate) fn restart_node_bridge(
  app: &AppHandle,
  vault: PathBuf,
  vault_state: &VaultPath,
  vault_configured: &VaultConfigured,
  node_service: &NodeService,
) -> Result<(), String> {
  let app_data = resolve_app_data_dir(app)?;
  write_vault_config(&app_data, &vault)?;
  *vault_state.0.lock() = Some(vault.clone());
  *vault_configured.0.lock() = true;

  if let Some(mut inner) = node_service.0.lock().take() {
    let _ = inner.child.kill();
    let _ = inner.child.wait();
  }

  let user_data = resolve_app_data_dir(app)?;
  let bundle_root = resolve_bundle_root(app)?;
  let bridge = bundle_root.join("dist-node/bridge.cjs");
  let (inner, stdout_reader) = spawn_node_bridge(&vault, &user_data, &bridge, &bundle_root)?;
  start_stdout_reader(app.clone(), stdout_reader, node_service.clone());
  *node_service.0.lock() = Some(inner);
  write_packaged_vault_confirmation(app)?;
  Ok(())
}

fn spawn_node_bridge(
  vault: &Path,
  user_data: &Path,
  bridge: &Path,
  cwd: &Path,
) -> Result<(NodeInner, BufReader<std::process::ChildStdout>), String> {
  if !bridge.is_file() {
    return Err(format!(
      "Node bridge not built: {} (run npm run build:node-bridge)",
      bridge.display()
    ));
  }

  let node_binary = resolve_node_binary();

  let mut child = Command::new(&node_binary)
    .current_dir(cwd)
    .arg(bridge)
    .env("VAULT_PATH", vault.as_os_str())
    .env("STASH_USER_DATA_DIR", user_data.as_os_str())
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::inherit())
    .spawn()
    .map_err(|e| format!("failed to spawn node bridge via {}: {e}", node_binary.display()))?;

  let stdin = child.stdin.take().ok_or("no stdin")?;
  let stdout = child.stdout.take().ok_or("no stdout")?;

  let mut reader = BufReader::new(stdout);
  let mut line = String::new();
  reader
    .read_line(&mut line)
    .map_err(|e| format!("read bridge stdout: {e}"))?;
  let msg: Value = serde_json::from_str(line.trim()).map_err(|e| format!("bridge json: {e}"))?;
  if msg.get("type").and_then(|t| t.as_str()) != Some("ready") {
    return Err("node bridge did not emit ready".into());
  }

  let inner = NodeInner {
    child,
    stdin: Mutex::new(stdin),
    next_id: AtomicU32::new(1),
    pending: Mutex::new(HashMap::new()),
  };

  Ok((inner, reader))
}

fn start_stdout_reader(app: AppHandle, mut reader: BufReader<std::process::ChildStdout>, node: NodeService) {
  std::thread::spawn(move || {
    let mut line = String::new();
    loop {
      line.clear();
      if reader.read_line(&mut line).unwrap_or(0) == 0 {
        break;
      }
      let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else {
        continue;
      };
      let ty = msg.get("type").and_then(|t| t.as_str());
      match ty {
        Some("response") => {
          let id = msg.get("id").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
          let result = msg.get("result").cloned().unwrap_or(Value::Null);
          if let Some(guard) = node.0.lock().as_ref() {
            if let Some(tx) = guard.pending.lock().remove(&id) {
              let _ = tx.send(Ok(result));
            }
          }
        }
        Some("error") => {
          let id = msg.get("id").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
          let err = msg
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error")
            .to_string();
          if let Some(guard) = node.0.lock().as_ref() {
            if let Some(tx) = guard.pending.lock().remove(&id) {
              let _ = tx.send(Err(err));
            }
          }
        }
        Some("event") => {
          let channel = msg
            .get("channel")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
          let payload = msg.get("payload").cloned().unwrap_or(Value::Null);
          let _ = app.emit(channel, payload);
        }
        Some("dialog_request") => {
          let request_id = msg
            .get("requestId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
          let options = msg.get("options").cloned().unwrap_or(Value::Null);
          let result = run_open_dialog(&options);
          let out = format!(
            "{}\n",
            json!({
              "type": "dialog_response",
              "requestId": request_id,
              "result": result
            })
          );
          if let Some(guard) = node.0.lock().as_ref() {
            let mut stdin = guard.stdin.lock();
            let _ = stdin.write_all(out.as_bytes());
            let _ = stdin.flush();
          }
        }
        _ => {}
      }
    }
  });
}

#[derive(Deserialize)]
struct OpenDialogFilter {
  extensions: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct OpenDialogOptions {
  filters: Option<Vec<OpenDialogFilter>>,
}

fn run_open_dialog(options: &Value) -> Value {
  let opts: OpenDialogOptions = match serde_json::from_value(options.clone()) {
    Ok(o) => o,
    Err(_) => OpenDialogOptions { filters: None },
  };
  let mut dlg = rfd::FileDialog::new();
  if let Some(filters) = &opts.filters {
    for f in filters {
      let exts: Vec<&str> = f
        .extensions
        .as_ref()
        .map(|v| v.iter().map(|s| s.as_str()).collect())
        .unwrap_or_default();
      if !exts.is_empty() {
        dlg = dlg.add_filter("Files", &exts);
      }
    }
  }
  match dlg.pick_file() {
    Some(p) => json!({
      "canceled": false,
      "filePaths": [p.to_string_lossy().to_string()]
    }),
    None => json!({ "canceled": true, "filePaths": [] }),
  }
}

impl NodeService {
  fn invoke(&self, method: String, params: Vec<Value>) -> Result<Value, String> {
    let guard = self.0.lock();
    let inner = guard.as_ref().ok_or("node bridge not running")?;

    let id = inner.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    inner.pending.lock().insert(id, tx);

    let payload = json!({
      "type": "invoke",
      "id": id,
      "method": method,
      "params": params
    });
    let line = format!("{}\n", payload);
    {
      let mut stdin = inner.stdin.lock();
      stdin
        .write_all(line.as_bytes())
        .map_err(|e| e.to_string())?;
      stdin.flush().map_err(|e| e.to_string())?;
    }

    drop(guard);

    rx.recv()
      .map_err(|_| "node bridge closed")?
      .map_err(|e| e)
  }
}

fn stash_response(vault_root: &Path, request: &http::Request<Vec<u8>>) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
  let uri = request.uri().to_string();
  let uri_without_query = uri.split('?').next().unwrap_or(&uri);
  let path_part = uri_without_query
    .strip_prefix("stash://asset/")
    .or_else(|| uri_without_query.strip_prefix("stash:///asset/"))
    .map(|s| s.to_string())
    .or_else(|| {
      let u = http::Uri::try_from(uri.as_str()).ok()?;
      let host = u.host()?;
      if host == "asset" {
        Some(u.path().trim_start_matches('/').to_string())
      } else {
        None
      }
    })
    .ok_or("bad stash url")?;

  let decoded = urlencoding::decode(&path_part)?.into_owned();
  let rel = Path::new(&decoded);
  let full = vault_root.join(rel);
  let full = full.canonicalize().unwrap_or(full);

  if !full.starts_with(vault_root) {
    return Ok(
      Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(b"not found".to_vec())?,
    );
  }

  if !full.is_file() {
    return Ok(
      Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(b"not found".to_vec())?,
    );
  }

  if request.headers().get(RANGE).is_none() {
    if let Some(width) = asset_request_width(request) {
      if let Some((bytes, mime)) = read_resized_asset(&full, width)? {
        return Ok(
          Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, mime)
            .body(bytes)?,
        );
      }
    }
  }

  let data = std::fs::read(&full)?;
  let mime = mime_guess::from_path(&full)
    .first_or_octet_stream()
    .essence_str()
    .to_string();

  let mut res = Response::builder().status(StatusCode::OK).header(CONTENT_TYPE, mime);

  if let Some(range_hdr) = request.headers().get(RANGE) {
    if let Ok(s) = range_hdr.to_str() {
      if let Some(rest) = s.strip_prefix("bytes=") {
        let parts: Vec<&str> = rest.split('-').collect();
        if parts.len() == 2 {
          if let Ok(start) = parts[0].parse::<usize>() {
            let end = if parts[1].is_empty() {
              data.len().saturating_sub(1)
            } else if let Ok(e) = parts[1].parse::<usize>() {
              e.min(data.len().saturating_sub(1))
            } else {
              data.len().saturating_sub(1)
            };
            if start < data.len() && end >= start {
              let slice = data[start..=end].to_vec();
              let total = data.len();
              res = res
                .status(StatusCode::PARTIAL_CONTENT)
                .header(CONTENT_RANGE, format!("bytes {start}-{end}/{total}"));
              return Ok(res.body(slice)?);
            }
          }
        }
      }
    }
  }

  Ok(res.body(data)?)
}

fn asset_request_width(request: &http::Request<Vec<u8>>) -> Option<u32> {
  parse_query_width(request.uri().query()).or_else(|| {
    let raw = request.uri().to_string();
    raw.split_once('?')
      .and_then(|(_, query)| parse_query_width(Some(query)))
  })
}

fn parse_query_width(query: Option<&str>) -> Option<u32> {
  query?.split('&').find_map(|part| {
    let mut parts = part.splitn(2, '=');
    let key = parts.next()?;
    if key != "w" {
      return None;
    }

    let value = parts.next().unwrap_or_default();
    let decoded = urlencoding::decode(value).ok()?;
    decoded.parse::<u32>().ok()
  }).map(|width| width.clamp(64, 1600))
}

fn read_resized_asset(full: &Path, requested_width: u32) -> Result<Option<(Vec<u8>, String)>, Box<dyn std::error::Error>> {
  let ext = full
    .extension()
    .and_then(|ext| ext.to_str())
    .map(|ext| ext.to_ascii_lowercase())
    .unwrap_or_default();

  let (cache_ext, mime) = match ext.as_str() {
    "jpg" | "jpeg" => ("jpg", "image/jpeg"),
    "png" | "webp" => ("png", "image/png"),
    _ => return Ok(None),
  };

  let (source_width, source_height) = image::image_dimensions(full)?;
  if requested_width >= source_width {
    return Ok(None);
  }

  let cache_path = resized_asset_cache_path(full, requested_width, cache_ext);
  if cache_path.is_file() {
    return Ok(Some((std::fs::read(cache_path)?, mime.to_string())));
  }

  let image = ImageReader::open(full)?.with_guessed_format()?.decode()?;
  let target_height =
    ((source_height as f32 * requested_width as f32) / source_width as f32).round().max(1.0) as u32;
  let resized = image.resize(requested_width, target_height, FilterType::Triangle);

  let mut bytes = Vec::new();
  match cache_ext {
    "jpg" => {
      let rgb = resized.to_rgb8();
      let encoder = JpegEncoder::new_with_quality(&mut bytes, 82);
      encoder.write_image(rgb.as_raw(), rgb.width(), rgb.height(), ColorType::Rgb8.into())?;
    }
    _ => {
      let rgba = resized.to_rgba8();
      let encoder = PngEncoder::new_with_quality(
        &mut bytes,
        PngCompressionType::Fast,
        PngFilterType::NoFilter,
      );
      encoder.write_image(rgba.as_raw(), rgba.width(), rgba.height(), ColorType::Rgba8.into())?;
    }
  }

  if let Some(parent) = cache_path.parent() {
    let _ = std::fs::create_dir_all(parent);
  }
  let _ = std::fs::write(&cache_path, &bytes);

  Ok(Some((bytes, mime.to_string())))
}

fn resized_asset_cache_path(source: &Path, width: u32, ext: &str) -> PathBuf {
  let modified = std::fs::metadata(source)
    .ok()
    .and_then(|meta| meta.modified().ok())
    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
    .map(|duration| duration.as_secs())
    .unwrap_or_default();

  let mut hasher = DefaultHasher::new();
  source.hash(&mut hasher);
  modified.hash(&mut hasher);
  width.hash(&mut hasher);

  std::env::temp_dir()
    .join("stash-image-cache")
    .join(format!("{:016x}.{ext}", hasher.finish()))
}

#[tauri::command]
async fn invoke_ipc(
  node: State<'_, NodeService>,
  method: String,
  params: Vec<Value>,
) -> Result<Value, String> {
  let node = node.inner().clone();
  // `invoke` waits on the Node bridge response; keep that wait off the AppKit main thread or
  // macOS will flag the app as unresponsive during startup / large vault scans.
  tauri::async_runtime::spawn_blocking(move || node.invoke(method, params))
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
  let trimmed = url.trim();
  let uri = http::Uri::try_from(trimmed).map_err(|_| "invalid url".to_string())?;
  match uri.scheme_str() {
    Some("http") | Some("https") => {}
    _ => return Err("unsupported url scheme".into()),
  }

  opener::open_browser(trimmed).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_get_status(
  vault: State<'_, VaultPath>,
  configured: State<'_, VaultConfigured>,
) -> Result<VaultStatusPayload, String> {
  let path = vault
    .0
    .lock()
    .clone()
    .ok_or("vault path unavailable")?;
  Ok(VaultStatusPayload {
    path: path.to_string_lossy().to_string(),
    configured: *configured.0.lock(),
  })
}

#[tauri::command]
fn vault_pick_folder(app: AppHandle) -> Result<(), String> {
  chrome::prompt_vault_folder(&app);
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let vault_state = VaultPath(Arc::new(Mutex::new(None)));
  let vault_configured = VaultConfigured(Arc::new(Mutex::new(false)));
  let node_service = NodeService(Arc::new(Mutex::new(None)));

  let node_service_for_exit = node_service.clone();

  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .enable_macos_default_menu(false)
    .menu(|app| chrome::build_app_menu(app))
    .on_menu_event(|app, event| chrome::handle_menu_event(app, &event))
    .manage(vault_state.clone())
    .manage(vault_configured.clone())
    .manage(node_service.clone())
    .register_uri_scheme_protocol("stash", move |ctx, request| {
      let vault = ctx.app_handle().state::<VaultPath>();
      let vault_root = vault.0.lock().clone().unwrap_or_else(|| PathBuf::from("/"));
      stash_response(&vault_root, &request).unwrap_or_else(|e| {
        Response::builder()
          .status(StatusCode::INTERNAL_SERVER_ERROR)
          .header(CONTENT_TYPE, "text/plain")
          .body(format!("{e}").into_bytes())
          .unwrap()
      })
    })
    .invoke_handler(tauri::generate_handler![
      invoke_ipc,
      open_external_url,
      vault_get_status,
      vault_pick_folder,
      chrome::tray_chrome
    ])
    .setup(move |app| {
      let handle = app.handle().clone();
      let vault = match resolve_vault_path(&handle) {
        Ok(vault) => vault,
        Err(err) => {
          eprintln!("[startup] resolve_vault_path failed: {err}");
          VaultResolution {
            startup_path: None,
            display_path: default_vault_path(),
            should_prompt: true,
          }
        }
      };
      *vault_state.0.lock() = Some(vault.display_path.clone());
      *vault_configured.0.lock() = !vault.should_prompt;

      if let Err(err) = chrome::setup_tray(&handle) {
        eprintln!("[startup] tray setup failed: {err}");
      }

      if let Some(startup_path) = vault.startup_path {
        let startup_result = (|| -> Result<(), String> {
          let user_data = resolve_app_data_dir(&handle)?;
          let bundle_root = resolve_bundle_root(&handle)?;
          let bridge = bundle_root.join("dist-node/bridge.cjs");
          let (inner, stdout_reader) =
            spawn_node_bridge(&startup_path, &user_data, &bridge, &bundle_root)?;
          start_stdout_reader(handle.clone(), stdout_reader, node_service.clone());
          *node_service.0.lock() = Some(inner);
          Ok(())
        })();

        if let Err(err) = startup_result {
          eprintln!("[startup] node bridge init failed: {err}");
        }
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error building tauri")
    .run(move |_app, event| {
      if let RunEvent::Exit = event {
        if let Some(mut inner) = node_service_for_exit.0.lock().take() {
          let _ = inner.child.kill();
        }
      }
    });
}
