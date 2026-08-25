const CREDENTIAL_TARGET: &str = "FurinaPet/AI/OpenAI-Compatible/API-Key";

#[cfg(target_os = "windows")]
fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
pub fn load_api_key() -> Result<Option<String>, String> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC},
    };

    let target = to_wide(CREDENTIAL_TARGET);
    let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
    let result = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
    if result == 0 {
        let code = unsafe { GetLastError() };
        if code == ERROR_NOT_FOUND {
            return Ok(None);
        }
        return Err(format!("Windows Credential Manager read failed ({code})"));
    }
    if credential.is_null() {
        return Ok(None);
    }

    let value = unsafe {
        let item = &*credential;
        let bytes = if item.CredentialBlob.is_null() || item.CredentialBlobSize == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(item.CredentialBlob, item.CredentialBlobSize as usize).to_vec()
        };
        CredFree(credential as *mut std::ffi::c_void);
        bytes
    };

    if value.is_empty() {
        return Ok(None);
    }
    String::from_utf8(value)
        .map(Some)
        .map_err(|_| "stored AI API key has invalid encoding".into())
}

#[cfg(target_os = "windows")]
pub fn save_api_key(value: &str) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, FILETIME},
        Security::Credentials::{
            CredWriteW, CREDENTIALW, CRED_MAX_CREDENTIAL_BLOB_SIZE, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };

    let value = value.trim();
    if value.is_empty() {
        return delete_api_key();
    }
    let mut blob = value.as_bytes().to_vec();
    if blob.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
        return Err("AI API key is too long".into());
    }

    let mut target = to_wide(CREDENTIAL_TARGET);
    let mut username = to_wide("FurinaPet");
    let credential = CREDENTIALW {
        Flags: 0,
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        Comment: std::ptr::null_mut(),
        LastWritten: FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 },
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: std::ptr::null_mut(),
        TargetAlias: std::ptr::null_mut(),
        UserName: username.as_mut_ptr(),
    };

    let result = unsafe { CredWriteW(&credential, 0) };
    blob.fill(0);
    if result == 0 {
        let code = unsafe { GetLastError() };
        return Err(format!("Windows Credential Manager write failed ({code})"));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn delete_api_key() -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC},
    };

    let target = to_wide(CREDENTIAL_TARGET);
    let result = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
    if result == 0 {
        let code = unsafe { GetLastError() };
        if code != ERROR_NOT_FOUND {
            return Err(format!("Windows Credential Manager delete failed ({code})"));
        }
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn load_api_key() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(target_os = "windows"))]
pub fn save_api_key(_: &str) -> Result<(), String> {
    Err("secure AI credential storage is only implemented on Windows".into())
}

#[cfg(not(target_os = "windows"))]
pub fn delete_api_key() -> Result<(), String> {
    Ok(())
}

pub fn has_api_key() -> bool {
    load_api_key().ok().flatten().is_some()
}
