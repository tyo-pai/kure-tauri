//! Menu bar + system tray wiring for the desktop shell.
use std::path::PathBuf;

use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::path::BaseDirectory;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position, Size, WindowEvent, Wry};
use tauri_plugin_dialog::DialogExt;
use tauri::WebviewUrl;

fn repo_root() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .expect("src-tauri has parent")
    .to_path_buf()
}

fn tray_webview_url() -> WebviewUrl {
  if cfg!(debug_assertions) {
    WebviewUrl::External(
      "http://localhost:1420/tray-popup.html"
        .parse()
        .expect("tray dev url"),
    )
  } else {
    WebviewUrl::App("tray-popup.html".into())
  }
}

fn load_tray_icon(app: &AppHandle<Wry>) -> Result<Image<'static>, String> {
  let fallback = repo_root().join("src-tauri/icons/icon.png");
  if let Ok(res) = app.path().resolve("icons/icon.png", BaseDirectory::Resource) {
    if res.is_file() {
      return Image::from_path(res).map_err(|e| e.to_string());
    }
  }
  Image::from_path(fallback).map_err(|e| e.to_string())
}

/// Application menu (File / Edit / View / Window), macOS app menu.
pub fn build_app_menu(app: &AppHandle<Wry>) -> tauri::Result<Menu<Wry>> {
  #[cfg(target_os = "macos")]
  let app_menu = Submenu::with_items(
    app,
    "Stash",
    true,
    &[
      &PredefinedMenuItem::about(app, None, None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::services(app, None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::hide(app, None)?,
      &PredefinedMenuItem::hide_others(app, None)?,
      &PredefinedMenuItem::show_all(app, None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::quit(app, None)?,
    ],
  )?;

  let file_menu = {
    #[cfg(target_os = "macos")]
    {
      Submenu::with_items(
        app,
        "File",
        true,
        &[
          &MenuItem::with_id(
            app,
            "stash.file.choose_vault",
            "Choose vault folder…",
            true,
            None::<&str>,
          )?,
          &PredefinedMenuItem::separator(app)?,
          &PredefinedMenuItem::close_window(app, None)?,
        ],
      )?
    }
    #[cfg(not(target_os = "macos"))]
    {
      Submenu::with_items(
        app,
        "File",
        true,
        &[
          &MenuItem::with_id(
            app,
            "stash.file.choose_vault",
            "Choose vault folder…",
            true,
            None::<&str>,
          )?,
          &PredefinedMenuItem::separator(app)?,
          &PredefinedMenuItem::quit(app, None)?,
        ],
      )?
    }
  };

  #[cfg(target_os = "macos")]
  let edit_menu = Submenu::with_items(
    app,
    "Edit",
    true,
    &[
      &PredefinedMenuItem::undo(app, None)?,
      &PredefinedMenuItem::redo(app, None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::cut(app, None)?,
      &PredefinedMenuItem::copy(app, None)?,
      &PredefinedMenuItem::paste(app, None)?,
      &PredefinedMenuItem::select_all(app, None)?,
    ],
  )?;

  #[cfg(not(target_os = "macos"))]
  let edit_menu = Submenu::with_items(
    app,
    "Edit",
    true,
    &[
      &PredefinedMenuItem::cut(app, None)?,
      &PredefinedMenuItem::copy(app, None)?,
      &PredefinedMenuItem::paste(app, None)?,
      &PredefinedMenuItem::select_all(app, None)?,
    ],
  )?;

  let view_menu = Submenu::with_items(
    app,
    "View",
    true,
    &[
      &MenuItem::with_id(
        app,
        "stash.view.reload",
        "Reload",
        true,
        Some("CmdOrCtrl+R"),
      )?,
      &MenuItem::with_id(
        app,
        "stash.view.force_reload",
        "Force Reload",
        true,
        Some("CmdOrCtrl+Shift+R"),
      )?,
      &PredefinedMenuItem::separator(app)?,
      &MenuItem::with_id(
        app,
        "stash.view.shader_debug",
        "Shader Debug",
        true,
        Some("CmdOrCtrl+Shift+D"),
      )?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::fullscreen(app, None)?,
    ],
  )?;

  let window_menu = Submenu::with_items(
    app,
    "Window",
    true,
    &[
      &PredefinedMenuItem::minimize(app, None)?,
      &PredefinedMenuItem::maximize(app, None)?,
      &PredefinedMenuItem::separator(app)?,
      &PredefinedMenuItem::close_window(app, None)?,
    ],
  )?;

  #[cfg(target_os = "macos")]
  {
    Menu::with_items(
      app,
      &[
        &app_menu,
        &file_menu,
        &edit_menu,
        &view_menu,
        &window_menu,
      ],
    )
  }
  #[cfg(not(target_os = "macos"))]
  {
    Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu, &window_menu])
  }
}

/// Non-blocking folder dialog (see `pick_folder` in tauri-plugin-dialog); restarts the Node bridge on success.
pub fn prompt_vault_folder(app: &AppHandle<Wry>) {
  let vault_state = app.state::<crate::VaultPath>().inner().clone();
  let vault_configured = app.state::<crate::VaultConfigured>().inner().clone();
  let node_service = app.state::<crate::NodeService>().inner().clone();
  let app = app.clone();
  app
    .dialog()
    .file()
    .set_title("Choose your Stash vault folder")
    .pick_folder(move |folder| {
      let Some(fp) = folder else {
        return;
      };
      let path = match fp.into_path() {
        Ok(p) => p,
        Err(_) => return,
      };
      if !path.is_dir() {
        return;
      }
      let app_for_bridge = app.clone();
      let vault_state = vault_state.clone();
      let vault_configured = vault_configured.clone();
      let node_service = node_service.clone();
      std::thread::spawn(move || {
        match crate::restart_node_bridge(
          &app_for_bridge,
          path,
          &vault_state,
          &vault_configured,
          &node_service,
        ) {
          Ok(()) => {
            let _ = app_for_bridge.emit("vault:changed", ());
            let _ = app_for_bridge.emit("items:refresh", ());
          }
          Err(e) => eprintln!("[stash] vault restart failed: {e}"),
        }
      });
    });
}

pub fn handle_menu_event(app: &AppHandle<Wry>, event: &MenuEvent) {
  let id = event.id();
  match id.as_ref() {
    "stash.file.choose_vault" => {
      prompt_vault_folder(app);
      return;
    }
    _ => {}
  }
  let Some(main) = app.get_webview_window("main") else {
    return;
  };
  match id.as_ref() {
    "stash.view.reload" => {
      let _ = main.reload();
    }
    "stash.view.force_reload" => {
      let _ = main.reload();
    }
    "stash.view.shader_debug" => {
      let _ = app.emit_to("main", "toggle-shader-debug", ());
    }
    _ => {}
  }
}

#[tauri::command]
pub fn tray_chrome(app: AppHandle<Wry>, channel: String) -> Result<(), String> {
  match channel.as_str() {
    "tray:item-added" => {
      let _ = app.emit("items:refresh", ());
      if let Some(w) = app.get_webview_window("tray") {
        let _ = w.hide();
      }
    }
    "tray:close" => {
      if let Some(w) = app.get_webview_window("tray") {
        let _ = w.hide();
      }
    }
    _ => {}
  }
  Ok(())
}

fn position_and_show_tray_popup(app: &AppHandle<Wry>, rect: &tauri::Rect) -> Result<(), String> {
  let Some(tray_win) = app.get_webview_window("tray") else {
    return Err("tray window missing".into());
  };
  const POPUP_W: f64 = 320.0;
  let (px, py, sw, sh) = match (rect.position, rect.size) {
    (Position::Physical(p), Size::Physical(s)) => (p.x as f64, p.y as f64, s.width as f64, s.height as f64),
    _ => return Err("unexpected logical tray bounds".into()),
  };
  let x = px + sw / 2.0 - POPUP_W / 2.0;
  let y = py + sh + 4.0;
  tray_win
    .set_position(PhysicalPosition::new(x as i32, y as i32))
    .map_err(|e| e.to_string())?;
  tray_win.show().map_err(|e| e.to_string())?;
  tray_win.set_focus().map_err(|e| e.to_string())?;
  app
    .emit_to("tray", "tray:focus", ())
    .map_err(|e| e.to_string())?;
  Ok(())
}

/// Tray icon + Quick Add popup window.
pub fn setup_tray(app: &AppHandle<Wry>) -> Result<(), String> {
  let url = tray_webview_url();
  let mut builder = WebviewWindowBuilder::new(app, "tray", url)
    .title("Stash Quick Add")
    .inner_size(320.0, 180.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false);

  #[cfg(target_os = "macos")]
  {
    builder = builder
      .title_bar_style(tauri::TitleBarStyle::Transparent)
      .hidden_title(true);
  }

  let tray_win = builder.build().map_err(|e| e.to_string())?;

  let app_blur = app.clone();
  tray_win.on_window_event(move |ev| {
    if let WindowEvent::Focused(false) = ev {
      if let Some(w) = app_blur.get_webview_window("tray") {
        let _ = w.hide();
      }
    }
  });

  let icon = load_tray_icon(app)?;
  #[cfg(target_os = "linux")]
  let linux_stub_menu = Menu::new(app).map_err(|e| e.to_string())?;

  let app_tray = app.clone();
  let tray_builder = TrayIconBuilder::new()
    .icon(icon)
    .tooltip("Stash — Quick Add")
    .show_menu_on_left_click(false)
    .icon_as_template(true);

  #[cfg(target_os = "linux")]
  let tray_builder = tray_builder.menu(&linux_stub_menu);

  tray_builder
    .on_tray_icon_event(move |_tray, event| {
      let TrayIconEvent::Click {
        button,
        button_state,
        rect,
        ..
      } = event
      else {
        return;
      };
      if button != MouseButton::Left || button_state != MouseButtonState::Up {
        return;
      }
      let app = app_tray.clone();
      let visible = app
        .get_webview_window("tray")
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false);
      if visible {
        if let Some(w) = app.get_webview_window("tray") {
          let _ = w.hide();
        }
      } else if let Err(e) = position_and_show_tray_popup(&app, &rect) {
        eprintln!("[tray] show popup: {e}");
      }
    })
    .build(app)
    .map_err(|e| e.to_string())?;

  Ok(())
}
