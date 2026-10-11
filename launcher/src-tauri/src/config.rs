//! Настройки лаунчера: язык, папка установки, список установленных игр.
//! Хранятся в settings.json в папке конфигурации приложения. Запись атомарная (через временный файл).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Installed {
    pub version: String,
    /// Папка игры (внутри неё лежит исполняемый файл).
    pub dir: String,
    /// Имя исполняемого файла относительно dir.
    pub exe: String,
}

fn yes() -> bool {
    true
}
fn keep_open() -> String {
    "keep".into()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
    pub lang: Option<String>,
    /// Общая папка установки (если пусто, берётся папка по умолчанию).
    pub install_dir: Option<String>,
    /// true: у каждой игры своя папка из game_dirs.
    #[serde(default)]
    pub per_game_dirs: bool,
    #[serde(default)]
    pub game_dirs: BTreeMap<String, String>,
    #[serde(default = "yes")]
    pub auto_update_games: bool,
    #[serde(default = "yes")]
    pub auto_update_launcher: bool,
    /// Что делать с лаунчером после запуска игры: keep, minimize или close.
    #[serde(default = "keep_open")]
    pub after_launch: String,
    /// None: пока не выбрано, интерфейс берёт значение из prefers-reduced-motion.
    #[serde(default)]
    pub reduce_animations: Option<bool>,
    #[serde(default)]
    pub installed: BTreeMap<String, Installed>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            lang: None,
            install_dir: None,
            per_game_dirs: false,
            game_dirs: BTreeMap::new(),
            auto_update_games: true,
            auto_update_launcher: true,
            after_launch: keep_open(),
            reduce_animations: None,
            installed: BTreeMap::new(),
        }
    }
}

pub fn load(path: &Path) -> Settings {
    match std::fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<Settings>(text.trim_start_matches('\u{feff}')) {
            Ok(s) => s,
            Err(_) => {
                // Повреждённый файл: сохраняем копию и начинаем с чистых настроек.
                let _ = std::fs::rename(path, path.with_extension("json.bad"));
                Settings::default()
            }
        },
        Err(_) => Settings::default(),
    }
}

pub fn save(path: &Path, s: &Settings) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(s).unwrap_or_default())?;
    std::fs::rename(&tmp, path)
}

#[allow(dead_code)] // нужна только тестам: сравнение версий делает интерфейс
/// Сравнение версий вида 1.2.3 (нечисловые хвосты отбрасываются). true, если a новее b.
pub fn is_newer(a: &str, b: &str) -> bool {
    fn parse(v: &str) -> Vec<u64> {
        v.trim_start_matches('v')
            .split(|c: char| !c.is_ascii_digit())
            .filter(|p| !p.is_empty())
            .map(|p| p.parse().unwrap_or(0))
            .collect()
    }
    let (x, y) = (parse(a), parse(b));
    for i in 0..x.len().max(y.len()) {
        let (p, q) = (x.get(i).copied().unwrap_or(0), y.get(i).copied().unwrap_or(0));
        if p != q {
            return p > q;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compare() {
        assert!(is_newer("0.2.0", "0.1.9"));
        assert!(is_newer("v1.0", "0.9.9"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1", "0.1.0"));
        assert!(is_newer("0.10.0", "0.9.0"));
    }

    #[test]
    fn corrupt_settings_are_replaced() {
        let dir = std::env::temp_dir().join(format!("shozit-cfg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("settings.json");
        std::fs::write(&p, "{ not json").unwrap();
        let s = load(&p);
        assert!(s.installed.is_empty());
        assert!(dir.join("settings.json.bad").exists());
        let mut s2 = Settings::default();
        s2.lang = Some("en".into());
        save(&p, &s2).unwrap();
        assert_eq!(load(&p).lang.as_deref(), Some("en"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
