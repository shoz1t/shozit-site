//! Лаунчер Shozit Developments: установка, запуск и обновление игр.
//! Вся работа с сетью и файлами идёт здесь, в Rust. Интерфейс (папка ui/) только вызывает команды.

mod config;
mod installer;

use config::{Installed, Settings};
use installer::{InstallError, Tree};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

/// Откуда читаем version.json и news.json. Если основной адрес недоступен, пробуем запасной.
const SITES: [&str; 2] = ["https://shozit.ru", "https://shoz1t.github.io/shozit-site"];
/// Ссылки, которые можно открыть из интерфейса.
const OPEN_ALLOWED: [&str; 4] = ["https://shozit.ru", "https://shoz1t.github.io/", "https://github.com/shoz1t", "https://t.me/shozitdev"];
const GAMES: [&str; 2] = ["rigged", "deep-roll"];
const OS: &str = if cfg!(target_os = "windows") { "windows" } else { "linux" };

struct AppState {
    settings: Mutex<Settings>,
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
    client: reqwest::Client,
}

fn sites() -> Vec<String> {
    match std::env::var("SHOZIT_SITE_URL") {
        Ok(u) if !u.is_empty() => vec![u],
        _ => SITES.iter().map(|s| s.to_string()).collect(),
    }
}

/* ---------- журнал ---------- */

fn iso_utc(secs: u64) -> String {
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02} UTC", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn log_dir(app: &AppHandle) -> PathBuf {
    app.path().app_log_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/// Записывает строку в журнал ошибок (launcher.log). Файл больше 1 МБ откладывается в launcher.old.log.
fn log(app: &AppHandle, msg: &str) {
    let dir = log_dir(app);
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("launcher.log");
    if std::fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("launcher.old.log"));
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{}] {}", iso_utc(now), msg);
    }
}

/* ---------- пути и настройки ---------- */

fn settings_path(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from(".")).join("settings.json")
}
fn manifest_path(app: &AppHandle, game: &str) -> PathBuf {
    app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from(".")).join("manifests").join(format!("{game}.json"))
}
fn cache_path(app: &AppHandle, name: &str) -> PathBuf {
    app.path().app_cache_dir().unwrap_or_else(|_| PathBuf::from(".")).join(name)
}
fn default_install_dir(app: &AppHandle) -> PathBuf {
    app.path().app_local_data_dir().unwrap_or_else(|_| PathBuf::from(".")).join("games")
}
/// Папка, в которую ставится игра (внутри неё создаётся подпапка с именем игры).
fn effective_root(app: &AppHandle, s: &Settings, game: &str) -> PathBuf {
    if s.per_game_dirs {
        if let Some(d) = s.game_dirs.get(game).filter(|d| !d.is_empty()) {
            return PathBuf::from(d);
        }
    }
    s.install_dir.as_ref().filter(|d| !d.is_empty()).map(PathBuf::from).unwrap_or_else(|| default_install_dir(app))
}
fn root_for(app: &AppHandle, st: &AppState, game: &str) -> PathBuf {
    effective_root(app, &st.settings.lock().unwrap(), game)
}
fn persist(app: &AppHandle, st: &AppState) -> Result<(), String> {
    let s = st.settings.lock().unwrap().clone();
    config::save(&settings_path(app), &s).map_err(|e| format!("io|{e}"))
}
fn same_path(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a.to_string_lossy().replace('\\', "/").trim_end_matches('/').eq_ignore_ascii_case(b.to_string_lossy().replace('\\', "/").trim_end_matches('/')),
    }
}

#[derive(Serialize)]
struct StateDto {
    platform: &'static str,
    app_version: String,
    lang: Option<String>,
    install_dir: String,
    per_game_dirs: bool,
    dirs: BTreeMap<String, String>,
    installed: BTreeMap<String, Installed>,
    busy: Vec<String>,
    auto_update_games: bool,
    auto_update_launcher: bool,
    after_launch: String,
    reduce_animations: Option<bool>,
    log_path: String,
}

#[tauri::command]
fn app_state(app: AppHandle, st: State<'_, AppState>) -> StateDto {
    let s = st.settings.lock().unwrap().clone();
    let dirs = GAMES.iter().map(|g| (g.to_string(), effective_root(&app, &s, g).to_string_lossy().to_string())).collect();
    let install_dir = s.install_dir.clone().filter(|d| !d.is_empty()).unwrap_or_else(|| default_install_dir(&app).to_string_lossy().to_string());
    let busy = st.active.lock().unwrap().keys().cloned().collect();
    StateDto {
        platform: OS,
        app_version: app.package_info().version.to_string(),
        lang: s.lang,
        install_dir,
        per_game_dirs: s.per_game_dirs,
        dirs,
        installed: s.installed,
        busy,
        auto_update_games: s.auto_update_games,
        auto_update_launcher: s.auto_update_launcher,
        after_launch: s.after_launch,
        reduce_animations: s.reduce_animations,
        log_path: log_dir(&app).join("launcher.log").to_string_lossy().to_string(),
    }
}

/// Меняет настройки по словарю {поле: значение}. Неизвестные поля и неверные значения отклоняются.
#[tauri::command]
fn update_settings(app: AppHandle, st: State<'_, AppState>, patch: Value) -> Result<(), String> {
    let obj = patch.as_object().ok_or("bad patch")?;
    {
        let mut s = st.settings.lock().unwrap();
        for (k, v) in obj {
            match (k.as_str(), v) {
                ("lang", Value::String(l)) if l == "ru" || l == "en" => s.lang = Some(l.clone()),
                ("per_game_dirs", Value::Bool(b)) => s.per_game_dirs = *b,
                ("auto_update_games", Value::Bool(b)) => s.auto_update_games = *b,
                ("auto_update_launcher", Value::Bool(b)) => s.auto_update_launcher = *b,
                ("after_launch", Value::String(a)) if ["keep", "minimize", "close"].contains(&a.as_str()) => s.after_launch = a.clone(),
                ("reduce_animations", Value::Bool(b)) => s.reduce_animations = Some(*b),
                _ => return Err(format!("bad setting: {k}")),
            }
        }
    }
    persist(&app, &st)
}

#[derive(Serialize)]
struct DirCheck {
    writable: bool,
    free: u64,
    error: Option<String>,
}

/// Проверка папки без изменений на диске: свободное место берётся с ближайшей существующей папки.
fn check_dir_impl(path: &Path) -> DirCheck {
    let mut probe = path.to_path_buf();
    while !probe.exists() {
        if !probe.pop() {
            break;
        }
    }
    let free = fs2::available_space(&probe).unwrap_or(0);
    let writable = std::fs::metadata(&probe).map(|m| m.is_dir() && !m.permissions().readonly()).unwrap_or(false);
    DirCheck { writable, free, error: if writable { None } else { Some("not writable".into()) } }
}

#[tauri::command]
fn check_dir(path: String) -> DirCheck {
    check_dir_impl(Path::new(&path))
}

#[derive(Serialize)]
struct SetDirDto {
    check: DirCheck,
    /// Установленные игры, которые лежат не в новой папке (их можно перенести).
    affected: Vec<String>,
}

/// Задаёт папку установки: общую (game = None) или для одной игры. Папка создаётся и проверяется записью.
#[tauri::command]
fn set_dir(app: AppHandle, st: State<'_, AppState>, game: Option<String>, path: String) -> Result<SetDirDto, String> {
    let p = PathBuf::from(&path);
    std::fs::create_dir_all(&p).map_err(|e| format!("io|{e}"))?;
    let probe = p.join(".shozit-write-test");
    std::fs::write(&probe, b"ok").map_err(|e| format!("io|{e}"))?;
    let _ = std::fs::remove_file(&probe);
    {
        let mut s = st.settings.lock().unwrap();
        match &game {
            Some(g) if GAMES.contains(&g.as_str()) => {
                s.game_dirs.insert(g.clone(), path.clone());
            }
            Some(_) => return Err("bad game".into()),
            None => s.install_dir = Some(path.clone()),
        }
    }
    persist(&app, &st)?;
    let s = st.settings.lock().unwrap().clone();
    let affected = s
        .installed
        .iter()
        .filter(|(g, i)| (game.is_none() || game.as_deref() == Some(g.as_str())) && !same_path(Path::new(&i.dir), &effective_root(&app, &s, g).join(g)))
        .map(|(g, _)| g.clone())
        .collect();
    log(&app, &format!("set_dir game={:?} path={}", game, path));
    Ok(SetDirDto { check: check_dir_impl(&p), affected })
}

#[derive(Serialize)]
struct RemoteDto {
    online: bool,
    source: String,
    manifest: Option<Value>,
    news: Option<Value>,
}

async fn fetch_json(client: &reqwest::Client, name: &str) -> Option<(Value, String)> {
    for base in sites() {
        let url = format!("{}/{}", base.trim_end_matches('/'), name);
        if let Ok(r) = client.get(&url).timeout(Duration::from_secs(12)).send().await {
            if r.status().is_success() {
                if let Ok(t) = r.text().await {
                    if let Ok(v) = serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')) {
                        return Some((v, base));
                    }
                }
            }
        }
    }
    None
}

fn read_cache(app: &AppHandle, name: &str) -> Option<Value> {
    let t = std::fs::read_to_string(cache_path(app, name)).ok()?;
    serde_json::from_str(t.trim_start_matches('\u{feff}')).ok()
}
fn write_cache(app: &AppHandle, name: &str, v: &Value) {
    let p = cache_path(app, name);
    if let Some(d) = p.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let _ = std::fs::write(p, serde_json::to_vec(v).unwrap_or_default());
}

/// Читает version.json и news.json с сайта. Без сети отдаёт последние сохранённые копии (online = false).
#[tauri::command]
async fn refresh_remote(app: AppHandle, st: State<'_, AppState>) -> Result<RemoteDto, String> {
    let (m, n) = tokio::join!(fetch_json(&st.client, "version.json"), fetch_json(&st.client, "news.json"));
    let online = m.is_some();
    if !online {
        log(&app, "нет связи с сайтом: version.json недоступен, используются сохранённые данные");
    }
    let source = m.as_ref().map(|x| x.1.clone()).unwrap_or_default();
    let manifest = match m {
        Some((v, _)) => {
            write_cache(&app, "version.json", &v);
            Some(v)
        }
        None => read_cache(&app, "version.json"),
    };
    let news = match n {
        Some((v, _)) => {
            write_cache(&app, "news.json", &v);
            Some(v)
        }
        None => read_cache(&app, "news.json"),
    };
    Ok(RemoteDto { online, source, manifest, news })
}

#[derive(Serialize, Clone)]
struct Progress {
    game: String,
    phase: &'static str,
    received: u64,
    total: u64,
    speed: f64,
}
fn emit(app: &AppHandle, game: &str, phase: &'static str, received: u64, total: u64, speed: f64) {
    let _ = app.emit("install-progress", Progress { game: game.to_string(), phase, received, total, speed });
}

/// Занимает игру на время долгой операции (установка, проверка, перенос). Возвращает флаг отмены.
fn lock_game(st: &AppState, game: &str) -> Result<Arc<AtomicBool>, String> {
    let mut a = st.active.lock().unwrap();
    if a.contains_key(game) {
        return Err("busy".into());
    }
    let c = Arc::new(AtomicBool::new(false));
    a.insert(game.to_string(), c.clone());
    Ok(c)
}

async fn do_install(app: &AppHandle, st: &AppState, game: &str, cancel: &Arc<AtomicBool>) -> Result<(), InstallError> {
    // Свежий манифест обязателен: хэш и ссылка берутся только оттуда.
    let (manifest, _) = fetch_json(&st.client, "version.json").await.ok_or_else(|| InstallError::Network("version.json".into()))?;
    let node = manifest.get("games").and_then(|g| g.get(game)).ok_or(InstallError::NoDownload)?;
    let version = node.get("version").and_then(|v| v.as_str()).unwrap_or("0").to_string();
    let exe = node.get("executable").and_then(|e| e.get(OS)).and_then(|v| v.as_str()).ok_or(InstallError::NoDownload)?.to_string();
    let dl = node.get("downloads").and_then(|d| d.get(OS)).ok_or(InstallError::NoDownload)?;
    let url = dl.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let sha = dl.get("sha256").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let size = dl.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
    if url.is_empty() {
        return Err(InstallError::NoDownload);
    }
    if sha.is_empty() {
        return Err(InstallError::NoHash);
    }

    let root = root_for(app, st, game);
    tokio::fs::create_dir_all(&root).await?;
    // место: архив и распакованная игра одновременно, берём с запасом
    if size > 0 {
        let free = fs2::available_space(&root).unwrap_or(u64::MAX);
        if free < size.saturating_mul(3) {
            return Err(InstallError::NoSpace(size.saturating_mul(3) / 1_048_576, free / 1_048_576));
        }
    }
    let part = installer::temp_name(&root.join(".downloads"), game, &version, OS);
    let staging = root.join(format!("{game}.new"));
    let target = root.join(game);

    // 1) скачать и проверить хэш (при несовпадении одна повторная загрузка с нуля)
    let mut verified = false;
    for round in 0..2 {
        installer::download(&st.client, &url, &part, size, cancel, |r, t, s| emit(app, game, "download", r, t, s)).await?;
        emit(app, game, "verify", 0, 0, 0.0);
        let sum = installer::sha256_file(&part, cancel, |d, t| emit(app, game, "verify", d, t, 0.0)).await?;
        if sum.eq_ignore_ascii_case(&sha) {
            verified = true;
            break;
        }
        log(app, &format!("{game}: хэш не совпал (получен {sum}, ожидался {sha}), попытка {}", round + 1));
        let _ = tokio::fs::remove_file(&part).await;
        if round == 1 {
            return Err(InstallError::HashMismatch);
        }
    }
    if !verified {
        return Err(InstallError::HashMismatch);
    }

    // 2) распаковать во временную папку
    let _ = tokio::fs::remove_dir_all(&staging).await;
    emit(app, game, "extract", 0, 0, 0.0);
    {
        let (part2, staging2, cancel2, app2, game2) = (part.clone(), staging.clone(), cancel.clone(), app.clone(), game.to_string());
        tauri::async_runtime::spawn_blocking(move || installer::extract_zip(&part2, &staging2, &cancel2, |d, t| emit(&app2, &game2, "extract", d, t, 0.0)))
            .await
            .map_err(|e| InstallError::Extract(e.to_string()))??;
    }
    let exe_path = staging.join(&exe);
    if !exe_path.is_file() {
        let _ = tokio::fs::remove_dir_all(&staging).await;
        return Err(InstallError::Extract(format!("{exe} not found")));
    }
    installer::make_executable(&exe_path)?;

    // 3) заменить старую версию новой
    if target.exists() {
        tokio::fs::remove_dir_all(&target).await?;
    }
    tokio::fs::rename(&staging, &target).await?;
    let _ = tokio::fs::remove_file(&part).await;

    // 4) список файлов с хэшами для последующей проверки целостности
    {
        let (target2, cancel2, app2, game2) = (target.clone(), cancel.clone(), app.clone(), game.to_string());
        let tree: Tree = tauri::async_runtime::spawn_blocking(move || installer::hash_tree(&target2, &cancel2, |d, t| emit(&app2, &game2, "verify", d, t, 0.0)))
            .await
            .map_err(|e| InstallError::Io(e.to_string()))??;
        let mp = manifest_path(app, game);
        if let Some(d) = mp.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(&mp, serde_json::to_vec(&tree).unwrap_or_default())?;
    }

    st.settings.lock().unwrap().installed.insert(game.to_string(), Installed { version: version.clone(), dir: target.to_string_lossy().to_string(), exe });
    persist(app, st).map_err(InstallError::Io)?;
    log(app, &format!("{game}: установлена версия {version} в {}", target.display()));
    Ok(())
}

#[tauri::command]
async fn install_game(app: AppHandle, st: State<'_, AppState>, game: String) -> Result<(), String> {
    let cancel = lock_game(&st, &game)?;
    let res = do_install(&app, &st, &game, &cancel).await;
    st.active.lock().unwrap().remove(&game);
    match res {
        Ok(()) => {
            emit(&app, &game, "done", 0, 0, 0.0);
            Ok(())
        }
        Err(InstallError::Cancelled) => {
            emit(&app, &game, "cancelled", 0, 0, 0.0);
            Err(InstallError::Cancelled.to_ui())
        }
        Err(e) => {
            log(&app, &format!("{game}: ошибка установки: {}", e.to_ui()));
            Err(e.to_ui())
        }
    }
}

#[tauri::command]
fn cancel_install(st: State<'_, AppState>, game: String) {
    if let Some(c) = st.active.lock().unwrap().get(&game) {
        c.store(true, Ordering::Relaxed);
    }
}

fn installed(st: &AppState, game: &str) -> Result<Installed, String> {
    st.settings.lock().unwrap().installed.get(game).cloned().ok_or_else(|| "not_installed".to_string())
}

#[tauri::command]
fn launch_game(app: AppHandle, st: State<'_, AppState>, game: String) -> Result<(), String> {
    let inst = installed(&st, &game)?;
    let dir = PathBuf::from(&inst.dir);
    let exe = dir.join(&inst.exe);
    if !exe.is_file() {
        return Err("not_installed".into());
    }
    installer::make_executable(&exe).map_err(|e| format!("io|{e}"))?;
    std::process::Command::new(&exe).current_dir(&dir).spawn().map_err(|e| {
        log(&app, &format!("{game}: не удалось запустить {}: {e}", exe.display()));
        format!("launch|{e}")
    })?;
    Ok(())
}

#[tauri::command]
fn uninstall_game(app: AppHandle, st: State<'_, AppState>, game: String) -> Result<(), String> {
    let _guard = lock_game(&st, &game)?;
    let res = (|| -> Result<(), String> {
        let inst = installed(&st, &game)?;
        let dir = PathBuf::from(&inst.dir);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| format!("io|{e}"))?;
        }
        let _ = std::fs::remove_file(manifest_path(&app, &game));
        st.settings.lock().unwrap().installed.remove(&game);
        persist(&app, &st)
    })();
    st.active.lock().unwrap().remove(&game);
    if let Err(e) = &res {
        log(&app, &format!("{game}: ошибка удаления: {e}"));
    }
    res
}

#[derive(Serialize)]
struct VerifyDto {
    /// ok, damaged или no_manifest (список файлов не сохранялся, нужна переустановка)
    state: &'static str,
    bad: Vec<String>,
    checked: usize,
}

/// Сверяет файлы игры с хэшами, записанными при установке. Для починки интерфейс запускает установку заново.
#[tauri::command]
async fn verify_game(app: AppHandle, st: State<'_, AppState>, game: String) -> Result<VerifyDto, String> {
    let inst = installed(&st, &game)?;
    let cancel = lock_game(&st, &game)?;
    let res: Result<VerifyDto, String> = async {
        let mp = manifest_path(&app, &game);
        let Ok(text) = std::fs::read_to_string(&mp) else {
            return Ok(VerifyDto { state: "no_manifest", bad: vec![], checked: 0 });
        };
        let tree: Tree = serde_json::from_str(&text).map_err(|e| format!("io|{e}"))?;
        let count = tree.len();
        let (dir, cancel2, app2, game2) = (PathBuf::from(&inst.dir), cancel.clone(), app.clone(), game.clone());
        let bad = tauri::async_runtime::spawn_blocking(move || installer::compare_tree(&dir, &tree, &cancel2, |d, t| emit(&app2, &game2, "verify", d, t, 0.0)))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_ui())?;
        if !bad.is_empty() {
            log(&app, &format!("{game}: сверка нашла повреждённые файлы: {}", bad.iter().take(10).cloned().collect::<Vec<_>>().join(", ")));
        }
        Ok(VerifyDto { state: if bad.is_empty() { "ok" } else { "damaged" }, bad: bad.into_iter().take(20).collect(), checked: count })
    }
    .await;
    st.active.lock().unwrap().remove(&game);
    emit(&app, &game, "done", 0, 0, 0.0);
    res
}

/// Переносит установленную игру в папку, выбранную в настройках для неё сейчас.
#[tauri::command]
async fn move_game(app: AppHandle, st: State<'_, AppState>, game: String) -> Result<(), String> {
    let inst = installed(&st, &game)?;
    let _cancel = lock_game(&st, &game)?;
    let res: Result<(), String> = async {
        let dest_root = root_for(&app, &st, &game);
        let dest = dest_root.join(&game);
        let src = PathBuf::from(&inst.dir);
        if same_path(&src, &dest) {
            return Ok(());
        }
        if dest.exists() {
            return Err("io|destination exists".into());
        }
        std::fs::create_dir_all(&dest_root).map_err(|e| format!("io|{e}"))?;
        emit(&app, &game, "move", 0, 0, 0.0);
        let (s2, d2) = (src.clone(), dest.clone());
        tauri::async_runtime::spawn_blocking(move || -> std::io::Result<()> {
            if std::fs::rename(&s2, &d2).is_ok() {
                return Ok(());
            }
            // другой диск: копируем и только после успеха удаляем старую папку
            if let Err(e) = installer::copy_dir_all(&s2, &d2) {
                let _ = std::fs::remove_dir_all(&d2);
                return Err(e);
            }
            std::fs::remove_dir_all(&s2)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("io|{e}"))?;
        if let Some(i) = st.settings.lock().unwrap().installed.get_mut(&game) {
            i.dir = dest.to_string_lossy().to_string();
        }
        persist(&app, &st)?;
        log(&app, &format!("{game}: перенесена в {}", dest.display()));
        Ok(())
    }
    .await;
    st.active.lock().unwrap().remove(&game);
    emit(&app, &game, "done", 0, 0, 0.0);
    if let Err(e) = &res {
        log(&app, &format!("{game}: ошибка переноса: {e}"));
    }
    res
}

#[tauri::command]
fn open_folder(app: AppHandle, st: State<'_, AppState>, game: Option<String>) -> Result<(), String> {
    let path = match &game {
        Some(g) => st.settings.lock().unwrap().installed.get(g).map(|i| PathBuf::from(&i.dir)).unwrap_or_else(|| root_for(&app, &st, g)),
        None => root_for(&app, &st, GAMES[0]),
    };
    std::fs::create_dir_all(&path).map_err(|e| format!("io|{e}"))?;
    app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>).map_err(|e| e.to_string())
}

/// Открывает папку с журналом ошибок.
#[tauri::command]
fn open_log(app: AppHandle) -> Result<(), String> {
    let dir = log_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| format!("io|{e}"))?;
    let file = dir.join("launcher.log");
    if !file.exists() {
        log(&app, "журнал создан");
    }
    app.opener().open_path(dir.to_string_lossy().to_string(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !OPEN_ALLOWED.iter().any(|p| url.starts_with(p)) {
        return Err("url not allowed".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK часто показывает пустое окно из-за DMABUF-рендера (особенно NVIDIA и Wayland).
    // Отключаем его для надёжности. Вернуть: SHOZIT_KEEP_DMABUF=1.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() && std::env::var_os("SHOZIT_KEEP_DMABUF").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("ShozitLauncher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .expect("http client");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let settings = config::load(&settings_path(app.handle()));
            app.manage(AppState { settings: Mutex::new(settings), active: Mutex::new(HashMap::new()), client: client.clone() });
            log(app.handle(), &format!("запуск лаунчера {}", app.package_info().version));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_state,
            update_settings,
            check_dir,
            set_dir,
            refresh_remote,
            install_game,
            cancel_install,
            launch_game,
            uninstall_game,
            verify_game,
            move_game,
            open_folder,
            open_log,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("ошибка запуска лаунчера");
}
