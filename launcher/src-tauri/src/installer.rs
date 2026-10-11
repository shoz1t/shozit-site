//! Скачивание, проверка и распаковка архива игры.
//!
//! Надёжность:
//! * загрузка идёт в файл `.part` и докачивается заголовком Range после обрыва сети;
//! * если сервер Range не поддерживает, загрузка начинается заново;
//! * после загрузки считается SHA-256, при несовпадении файл удаляется (повреждённая загрузка);
//! * распаковка защищена от записи за пределы папки (zip-slip) и идёт во временную папку,
//!   старая версия заменяется только после успешной распаковки.

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Debug)]
pub enum InstallError {
    NoDownload,
    NoHash,
    Network(String),
    HashMismatch,
    Cancelled,
    Io(String),
    Extract(String),
    /// (нужно МБ, свободно МБ)
    NoSpace(u64, u64),
}

impl InstallError {
    /// Короткий код для интерфейса (по нему выбирается перевод) и подробности через «|».
    pub fn to_ui(&self) -> String {
        match self {
            InstallError::NoDownload => "no_download".into(),
            InstallError::NoHash => "no_hash".into(),
            InstallError::Network(d) => format!("network|{d}"),
            InstallError::HashMismatch => "hash_mismatch".into(),
            InstallError::Cancelled => "cancelled".into(),
            InstallError::Io(d) => format!("io|{d}"),
            InstallError::Extract(d) => format!("extract|{d}"),
            InstallError::NoSpace(need, free) => format!("no_space|{need} / {free}"),
        }
    }
}

impl From<std::io::Error> for InstallError {
    fn from(e: std::io::Error) -> Self {
        InstallError::Io(e.to_string())
    }
}

/// Скорость считается по окну около секунды.
struct Speed {
    since: Instant,
    bytes: u64,
    value: f64,
}
impl Speed {
    fn new() -> Self {
        Speed { since: Instant::now(), bytes: 0, value: 0.0 }
    }
    fn add(&mut self, n: u64) -> f64 {
        self.bytes += n;
        let el = self.since.elapsed().as_secs_f64();
        if el >= 1.0 {
            self.value = self.bytes as f64 / el;
            self.since = Instant::now();
            self.bytes = 0;
        }
        self.value
    }
}

fn backoff(attempt: u32) -> Duration {
    Duration::from_millis((800u64 << attempt.min(4)).min(8000))
}

/// Скачивает url в dest с докачкой. expected_size = 0, если размер неизвестен.
pub async fn download(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_size: u64,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(u64, u64, f64),
) -> Result<(), InstallError> {
    const MAX_ATTEMPTS: u32 = 7;
    let mut attempt = 0u32;
    let mut speed = Speed::new();
    if let Some(dir) = dest.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(InstallError::Cancelled);
        }
        let mut have = tokio::fs::metadata(dest).await.map(|m| m.len()).unwrap_or(0);
        if expected_size > 0 && have > expected_size {
            tokio::fs::remove_file(dest).await.ok();
            have = 0;
        }
        if expected_size > 0 && have == expected_size {
            on_progress(have, expected_size, 0.0);
            return Ok(());
        }
        let mut req = client.get(url);
        if have > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let mut progressed = false;
        let failure: String = match req.send().await {
            Err(e) => e.to_string(),
            Ok(resp) => {
                let status = resp.status();
                if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
                    tokio::fs::remove_file(dest).await.ok();
                    "range not satisfiable".into()
                } else if !status.is_success() {
                    if status.is_client_error() && status.as_u16() != 429 && status.as_u16() != 408 {
                        return Err(InstallError::Network(format!("HTTP {}", status.as_u16())));
                    }
                    format!("HTTP {}", status.as_u16())
                } else {
                    let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT;
                    if !resumed {
                        have = 0; // сервер отдаёт файл целиком: начинаем сначала
                    }
                    let total = if expected_size > 0 { expected_size } else { resp.content_length().map(|l| l + have).unwrap_or(0) };
                    let mut file = if resumed {
                        tokio::fs::OpenOptions::new().append(true).open(dest).await?
                    } else {
                        tokio::fs::File::create(dest).await?
                    };
                    let mut received = have;
                    let mut stream = resp.bytes_stream();
                    let mut last_emit = Instant::now() - Duration::from_secs(1);
                    let mut err: Option<String> = None;
                    while let Some(chunk) = stream.next().await {
                        if cancel.load(Ordering::Relaxed) {
                            file.flush().await.ok();
                            return Err(InstallError::Cancelled);
                        }
                        match chunk {
                            Ok(bytes) => {
                                file.write_all(&bytes).await?;
                                received += bytes.len() as u64;
                                progressed = true;
                                let sp = speed.add(bytes.len() as u64);
                                if last_emit.elapsed() >= Duration::from_millis(100) {
                                    on_progress(received, total, sp);
                                    last_emit = Instant::now();
                                }
                            }
                            Err(e) => {
                                err = Some(e.to_string());
                                break;
                            }
                        }
                    }
                    file.flush().await?;
                    drop(file);
                    match err {
                        Some(e) => e,
                        None => {
                            let size = tokio::fs::metadata(dest).await.map(|m| m.len()).unwrap_or(0);
                            if total == 0 || size == total {
                                on_progress(size, total.max(size), 0.0);
                                return Ok(());
                            }
                            if size > total {
                                tokio::fs::remove_file(dest).await.ok();
                            }
                            format!("incomplete download: {size} of {total}")
                        }
                    }
                }
            }
        };
        // Обрыв или временная ошибка: ждём и пробуем снова (докачка). Прогресс обнуляет счётчик попыток.
        if progressed {
            attempt = 0;
        } else {
            attempt += 1;
        }
        if attempt >= MAX_ATTEMPTS {
            return Err(InstallError::Network(failure));
        }
        let wait = backoff(attempt);
        let mut waited = Duration::ZERO;
        while waited < wait {
            if cancel.load(Ordering::Relaxed) {
                return Err(InstallError::Cancelled);
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
            waited += Duration::from_millis(200);
        }
    }
}

/// SHA-256 файла (строчный hex).
pub async fn sha256_file(path: &Path, cancel: &AtomicBool, mut on_progress: impl FnMut(u64, u64)) -> Result<String, InstallError> {
    let mut f = tokio::fs::File::open(path).await?;
    let total = f.metadata().await?.len();
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut done = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(InstallError::Cancelled);
        }
        let n = f.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        done += n as u64;
        on_progress(done, total);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Распаковывает zip в dest (папка создаётся). Пути с «..» и абсолютные отклоняются.
pub fn extract_zip(zip_path: &Path, dest: &Path, cancel: &AtomicBool, mut on_progress: impl FnMut(u64, u64)) -> Result<(), InstallError> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| InstallError::Extract(e.to_string()))?;
    let mut total = 0u64;
    for i in 0..archive.len() {
        total += archive.by_index(i).map(|f| f.size()).unwrap_or(0);
    }
    std::fs::create_dir_all(dest)?;
    let mut done = 0u64;
    for i in 0..archive.len() {
        if cancel.load(Ordering::Relaxed) {
            return Err(InstallError::Cancelled);
        }
        let mut entry = archive.by_index(i).map_err(|e| InstallError::Extract(e.to_string()))?;
        let rel = entry.enclosed_name().ok_or_else(|| InstallError::Extract(format!("unsafe path: {}", entry.name())))?;
        let out = dest.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut w = std::fs::File::create(&out)?;
        let mut buf = vec![0u8; 256 * 1024];
        loop {
            let n = std::io::Read::read(&mut entry, &mut buf).map_err(|e| InstallError::Extract(e.to_string()))?;
            if n == 0 {
                break;
            }
            std::io::Write::write_all(&mut w, &buf[..n])?;
            done += n as u64;
            on_progress(done, total);
        }
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode));
        }
    }
    Ok(())
}

/// Выдаёт файлу право на запуск (нужно в Linux; в Windows ничего не делает).
pub fn make_executable(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perm = std::fs::metadata(path)?.permissions();
        perm.set_mode(perm.mode() | 0o755);
        std::fs::set_permissions(path, perm)?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

/// Список файлов игры с размером и SHA-256: по нему потом можно проверить, что ничего не повреждено.
pub type Tree = std::collections::BTreeMap<String, (u64, String)>;

fn walk(dir: &Path, base: &Path, out: &mut Vec<(PathBuf, String)>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            walk(&path, base, out)?;
        } else {
            let rel = path.strip_prefix(base).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            out.push((path, rel));
        }
    }
    Ok(())
}

fn hash_file_sync(path: &Path) -> std::io::Result<(u64, String)> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut total = 0u64;
    loop {
        let n = std::io::Read::read(&mut f, &mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        total += n as u64;
    }
    Ok((total, hex::encode(h.finalize())))
}

pub fn hash_tree(dir: &Path, cancel: &AtomicBool, mut on_progress: impl FnMut(u64, u64)) -> Result<Tree, InstallError> {
    let mut files = Vec::new();
    walk(dir, dir, &mut files)?;
    let mut tree = Tree::new();
    for (i, (path, rel)) in files.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(InstallError::Cancelled);
        }
        tree.insert(rel.clone(), hash_file_sync(path)?);
        on_progress(i as u64 + 1, files.len() as u64);
    }
    Ok(tree)
}

/// Сверяет файлы папки с сохранённым списком. Возвращает пути повреждённых и пропавших файлов.
pub fn compare_tree(dir: &Path, expected: &Tree, cancel: &AtomicBool, mut on_progress: impl FnMut(u64, u64)) -> Result<Vec<String>, InstallError> {
    let mut bad = Vec::new();
    let total = expected.len() as u64;
    for (i, (rel, (size, sum))) in expected.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(InstallError::Cancelled);
        }
        let path = dir.join(rel);
        match hash_file_sync(&path) {
            Ok((s, h)) if s == *size && h.eq_ignore_ascii_case(sum) => {}
            _ => bad.push(rel.clone()),
        }
        on_progress(i as u64 + 1, total);
    }
    Ok(bad)
}

/// Рекурсивное копирование (перенос игры на другой диск, где простой rename не работает).
pub fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

pub fn temp_name(dir: &Path, game: &str, version: &str, os: &str) -> PathBuf {
    dir.join(format!("{game}-{version}-{os}.zip.part"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;

    /// Крошечный HTTP-сервер для проверки докачки. drop_first: первое соединение рвётся после n байт.
    fn serve(data: Vec<u8>, drop_first: Option<usize>, ignore_range: bool) -> (String, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let hits = Arc::new(AtomicUsize::new(0));
        let h2 = hits.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut s = match stream {
                    Ok(s) => s,
                    Err(_) => break,
                };
                let n = h2.fetch_add(1, Ordering::SeqCst);
                let mut buf = [0u8; 4096];
                let len = s.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..len]).to_string();
                let start = req
                    .lines()
                    .find_map(|l| l.to_ascii_lowercase().strip_prefix("range: bytes=").map(|r| r.trim_end_matches('-').parse::<usize>().unwrap_or(0)))
                    .unwrap_or(0);
                let (status, from) = if start > 0 && !ignore_range { ("206 Partial Content", start) } else { ("200 OK", 0) };
                let body = &data[from..];
                let mut head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n", body.len());
                if from > 0 {
                    head += &format!("Content-Range: bytes {}-{}/{}\r\n", from, data.len() - 1, data.len());
                }
                head += "\r\n";
                let _ = s.write_all(head.as_bytes());
                match drop_first {
                    Some(cut) if n == 0 => {
                        let _ = s.write_all(&body[..cut.min(body.len())]);
                        let _ = s.flush();
                        // соединение закрывается раньше, чем отдан весь Content-Length: обрыв сети
                    }
                    _ => {
                        let _ = s.write_all(body);
                    }
                }
            }
        });
        (format!("http://{addr}/file.zip"), hits)
    }

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("shozit-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn sample(n: usize) -> Vec<u8> {
        (0..n).map(|i| ((i * 31 + 7) % 251) as u8).collect()
    }

    #[tokio::test]
    async fn resumes_after_dropped_connection() {
        let data = sample(900_000);
        let (url, hits) = serve(data.clone(), Some(300_000), false);
        let dir = tmpdir("resume");
        let dest = dir.join("a.zip.part");
        let cancel = AtomicBool::new(false);
        let client = reqwest::Client::new();
        download(&client, &url, &dest, data.len() as u64, &cancel, |_, _, _| {}).await.unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), data);
        assert!(hits.load(Ordering::SeqCst) >= 2, "должна быть докачка отдельным запросом");
        let sum = sha256_file(&dest, &cancel, |_, _| {}).await.unwrap();
        assert_eq!(sum, hex::encode(Sha256::digest(&data)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn restarts_when_server_ignores_range() {
        let data = sample(500_000);
        let (url, _) = serve(data.clone(), Some(100_000), true);
        let dir = tmpdir("norange");
        let dest = dir.join("b.zip.part");
        let cancel = AtomicBool::new(false);
        let client = reqwest::Client::new();
        download(&client, &url, &dest, data.len() as u64, &cancel, |_, _, _| {}).await.unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), data);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn hash_detects_corruption() {
        let dir = tmpdir("hash");
        let p = dir.join("c.bin");
        let mut data = sample(10_000);
        std::fs::write(&p, &data).unwrap();
        let cancel = AtomicBool::new(false);
        let good = sha256_file(&p, &cancel, |_, _| {}).await.unwrap();
        data[5000] ^= 0xff;
        std::fs::write(&p, &data).unwrap();
        let bad = sha256_file(&p, &cancel, |_, _| {}).await.unwrap();
        assert_ne!(good, bad);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn cancel_stops_download() {
        let data = sample(400_000);
        let (url, _) = serve(data, None, false);
        let dir = tmpdir("cancel");
        let cancel = AtomicBool::new(true);
        let r = download(&reqwest::Client::new(), &url, &dir.join("d.part"), 400_000, &cancel, |_, _, _| {}).await;
        assert!(matches!(r, Err(InstallError::Cancelled)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn make_zip(path: &Path, files: &[(&str, &[u8])]) {
        let f = std::fs::File::create(path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, body) in files {
            z.start_file(*name, opt).unwrap();
            z.write_all(body).unwrap();
        }
        z.finish().unwrap();
    }

    #[test]
    fn verifies_game_files() {
        let dir = tmpdir("verify");
        std::fs::create_dir_all(dir.join("data")).unwrap();
        std::fs::write(dir.join("game.exe"), sample(5000)).unwrap();
        std::fs::write(dir.join("data/a.pck"), sample(20000)).unwrap();
        let cancel = AtomicBool::new(false);
        let tree = hash_tree(&dir, &cancel, |_, _| {}).unwrap();
        assert_eq!(tree.len(), 2);
        assert!(compare_tree(&dir, &tree, &cancel, |_, _| {}).unwrap().is_empty());
        let mut broken = sample(20000);
        broken[777] ^= 1;
        std::fs::write(dir.join("data/a.pck"), broken).unwrap();
        std::fs::remove_file(dir.join("game.exe")).unwrap();
        let mut bad = compare_tree(&dir, &tree, &cancel, |_, _| {}).unwrap();
        bad.sort();
        assert_eq!(bad, vec!["data/a.pck".to_string(), "game.exe".to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn copies_folders() {
        let dir = tmpdir("copy");
        std::fs::create_dir_all(dir.join("a/b")).unwrap();
        std::fs::write(dir.join("a/b/c.txt"), b"x").unwrap();
        copy_dir_all(&dir.join("a"), &dir.join("moved")).unwrap();
        assert_eq!(std::fs::read(dir.join("moved/b/c.txt")).unwrap(), b"x");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extracts_and_rejects_zip_slip() {
        let dir = tmpdir("zip");
        let ok = dir.join("ok.zip");
        make_zip(&ok, &[("game.exe", b"MZ"), ("data/readme.txt", b"hi")]);
        let out = dir.join("out");
        extract_zip(&ok, &out, &AtomicBool::new(false), |_, _| {}).unwrap();
        assert_eq!(std::fs::read(out.join("game.exe")).unwrap(), b"MZ");
        assert_eq!(std::fs::read(out.join("data/readme.txt")).unwrap(), b"hi");

        let evil = dir.join("evil.zip");
        make_zip(&evil, &[("../escape.txt", b"x")]);
        let out2 = dir.join("out2");
        let r = extract_zip(&evil, &out2, &AtomicBool::new(false), |_, _| {});
        assert!(matches!(r, Err(InstallError::Extract(_))));
        assert!(!dir.join("escape.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
