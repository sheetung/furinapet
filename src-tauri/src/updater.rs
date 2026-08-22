use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Write, process::Command};
use tauri::{AppHandle, Emitter, Manager};

const MANIFEST_URL: &str =
    "https://github.com/sheetung/furinapet/releases/latest/download/update.json";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseManifest {
    version: String,
    title: String,
    notes: Vec<String>,
    download_url: String,
    sha256: String,
    size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    state: &'static str,
    current_version: String,
    latest_version: Option<String>,
    title: Option<String>,
    notes: Vec<String>,
    download_url: Option<String>,
    sha256: Option<String>,
    size: Option<u64>,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
    percent: u8,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("furinapet/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|error| error.to_string())
}

fn version_parts(version: &str) -> Option<Vec<u64>> {
    let clean = version.strip_prefix('v').unwrap_or(version);
    if clean.is_empty() || !clean.bytes().all(|byte| byte.is_ascii_digit() || byte == b'.') {
        return None;
    }
    clean.split('.').map(|part| part.parse::<u64>().ok()).collect()
}

fn is_newer(latest: &str, current: &str) -> Result<bool, String> {
    let latest = version_parts(latest).ok_or("更新清单中的版本号无效")?;
    let current = version_parts(current).ok_or("当前版本号无效")?;
    let count = latest.len().max(current.len());
    for index in 0..count {
        let left = latest.get(index).copied().unwrap_or(0);
        let right = current.get(index).copied().unwrap_or(0);
        if left != right {
            return Ok(left > right);
        }
    }
    Ok(false)
}

fn expected_download_url(version: &str) -> String {
    format!(
        "https://github.com/sheetung/furinapet/releases/download/v{version}/furinapet-Windows-v{version}.exe"
    )
}

fn validate_manifest(manifest: &ReleaseManifest) -> Result<(), String> {
    version_parts(&manifest.version).ok_or("更新清单中的版本号无效")?;
    if manifest.download_url != expected_download_url(&manifest.version) {
        return Err("更新清单中的下载地址无效".into());
    }
    if manifest.sha256.len() != 64 || !manifest.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("更新清单中的校验值无效".into());
    }
    if manifest.size == 0 {
        return Err("更新清单中的文件大小无效".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn check_for_updates(current_version: String) -> Result<UpdateResult, String> {
    let response = client()?
        .get(MANIFEST_URL)
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(|error| format!("无法连接更新服务器：{error}"))?
        .error_for_status()
        .map_err(|error| format!("更新服务器返回错误：{error}"))?;
    let manifest = response
        .json::<ReleaseManifest>()
        .await
        .map_err(|error| format!("更新清单格式错误：{error}"))?;
    validate_manifest(&manifest)?;

    let available = is_newer(&manifest.version, &current_version)?;
    Ok(UpdateResult {
        state: if available { "available" } else { "current" },
        current_version,
        latest_version: Some(manifest.version.clone()),
        title: Some(manifest.title),
        notes: manifest.notes,
        download_url: Some(manifest.download_url),
        sha256: Some(manifest.sha256),
        size: Some(manifest.size),
        message: if available {
            format!("发现新版本 {}", manifest.version)
        } else {
            "当前已是最新版本".into()
        },
    })
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    version: String,
    sha256: String,
) -> Result<(), String> {
    version_parts(&version).ok_or("版本号无效")?;
    if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("更新校验值无效".into());
    }

    let url = expected_download_url(&version);
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("下载安装程序失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("下载安装程序失败：{error}"))?;
    let total = response.content_length().unwrap_or(0);
    let update_dir = app
        .path()
        .temp_dir()
        .map_err(|error| error.to_string())?
        .join("furinapet-updates");
    fs::create_dir_all(&update_dir).map_err(|error| error.to_string())?;
    let installer = update_dir.join(format!("furinapet-Windows-v{version}.exe"));
    let partial = update_dir.join(format!("furinapet-Windows-v{version}.exe.part"));
    let _ = fs::remove_file(&partial);

    let mut file = fs::File::create(&partial).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("下载中断：{error}"))?;
        file.write_all(&chunk).map_err(|error| error.to_string())?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        let percent = if total > 0 {
            ((downloaded.saturating_mul(100) / total).min(100)) as u8
        } else {
            0
        };
        let _ = app.emit_to(
            "main",
            "update-download-progress",
            DownloadProgress { downloaded, total, percent },
        );
    }
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);

    let actual = format!("{:x}", hasher.finalize());
    if !actual.eq_ignore_ascii_case(&sha256) {
        let _ = fs::remove_file(&partial);
        return Err("安装程序校验失败，文件已删除".into());
    }
    if downloaded == 0 || (total > 0 && downloaded != total) {
        let _ = fs::remove_file(&partial);
        return Err("安装程序下载不完整".into());
    }
    let _ = fs::remove_file(&installer);
    fs::rename(&partial, &installer).map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        Command::new(&installer)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|error| format!("无法启动安装程序：{error}"))?;
        app.exit(0);
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = installer;
        Err("自动安装目前仅支持 Windows".into())
    }
}
