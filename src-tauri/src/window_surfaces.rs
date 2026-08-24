use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSurface {
    id: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::{WindowSurface, WorkArea};
    use std::{
        ffi::c_void,
        mem::{size_of, zeroed},
    };
    use windows_sys::core::BOOL;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, POINT, RECT},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
            Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        },
        System::Threading::GetCurrentProcessId,
        UI::WindowsAndMessaging::{
            EnumWindows, GetClassNameW, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId,
            IsIconic, IsWindowVisible, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
            WS_EX_TRANSPARENT,
        },
    };

    struct EnumContext {
        process_id: u32,
        surfaces: Vec<WindowSurface>,
    }

    struct FullscreenContext {
        process_id: u32,
        monitor: RECT,
        found: bool,
    }

    fn rectangle_size(rect: RECT) -> Option<(u32, u32)> {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        (width > 0 && height > 0).then_some((width as u32, height as u32))
    }

    unsafe fn class_name(hwnd: HWND) -> String {
        let mut buffer = [0u16; 256];
        let length = GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        if length <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buffer[..length as usize])
    }

    unsafe fn window_rectangle(hwnd: HWND) -> Option<RECT> {
        let mut rect: RECT = zeroed();
        let result = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            &mut rect as *mut RECT as *mut c_void,
            size_of::<RECT>() as u32,
        );
        if result >= 0 && rectangle_size(rect).is_some() {
            return Some(rect);
        }
        (GetWindowRect(hwnd, &mut rect) != 0 && rectangle_size(rect).is_some()).then_some(rect)
    }

    unsafe fn window_is_eligible(hwnd: HWND, own_process_id: u32) -> bool {
        if IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
            return false;
        }

        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        if process_id == 0 || process_id == own_process_id {
            return false;
        }

        let extended_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if extended_style & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT) != 0 {
            return false;
        }

        let class = class_name(hwnd);
        if matches!(
            class.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        ) {
            return false;
        }

        let mut cloaked = 0u32;
        let cloak_result = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED as u32,
            &mut cloaked as *mut u32 as *mut c_void,
            size_of::<u32>() as u32,
        );
        cloak_result < 0 || cloaked == 0
    }

    fn rectangle_covers_monitor(rect: RECT, monitor: RECT) -> bool {
        // DWM frame bounds can differ from the physical monitor by a handful of
        // pixels depending on DPI and borderless-window implementation.
        const TOLERANCE: i32 = 8;
        rect.left <= monitor.left + TOLERANCE
            && rect.top <= monitor.top + TOLERANCE
            && rect.right >= monitor.right - TOLERANCE
            && rect.bottom >= monitor.bottom - TOLERANCE
    }

    unsafe extern "system" fn enumerate_window(hwnd: HWND, parameter: LPARAM) -> BOOL {
        let context = &mut *(parameter as *mut EnumContext);
        if !window_is_eligible(hwnd, context.process_id) {
            return 1;
        }

        let Some(rect) = window_rectangle(hwnd) else {
            return 1;
        };
        let Some((width, height)) = rectangle_size(rect) else {
            return 1;
        };
        if width < 220 || height < 120 {
            return 1;
        }
        context.surfaces.push(WindowSurface {
            id: format!("{:X}", hwnd as usize),
            x: rect.left,
            y: rect.top,
            width,
            height,
        });
        1
    }

    unsafe extern "system" fn detect_fullscreen_window(hwnd: HWND, parameter: LPARAM) -> BOOL {
        let context = &mut *(parameter as *mut FullscreenContext);
        if context.found || !window_is_eligible(hwnd, context.process_id) {
            return 1;
        }
        if let Some(rect) = window_rectangle(hwnd) {
            if rectangle_covers_monitor(rect, context.monitor) {
                context.found = true;
            }
        }
        1
    }

    fn monitor_info_at(x: i32, y: i32) -> Result<MONITORINFO, String> {
        unsafe {
            let monitor = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
            if monitor.is_null() {
                return Err("无法识别当前显示器。".into());
            }
            let mut info: MONITORINFO = zeroed();
            info.cbSize = size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(monitor, &mut info) == 0 {
                return Err("无法读取显示器信息。".into());
            }
            Ok(info)
        }
    }

    pub fn work_area_at(x: i32, y: i32) -> Result<WorkArea, String> {
        let info = monitor_info_at(x, y)?;
        let rect = info.rcWork;
        let Some((width, height)) = rectangle_size(rect) else {
            return Err("显示器工作区无效。".into());
        };
        Ok(WorkArea {
            x: rect.left,
            y: rect.top,
            width,
            height,
        })
    }

    pub fn has_fullscreen_at(x: i32, y: i32) -> bool {
        let Ok(info) = monitor_info_at(x, y) else {
            return false;
        };
        unsafe {
            let mut context = FullscreenContext {
                process_id: GetCurrentProcessId(),
                monitor: info.rcMonitor,
                found: false,
            };
            let _ = EnumWindows(
                Some(detect_fullscreen_window),
                &mut context as *mut FullscreenContext as LPARAM,
            );
            context.found
        }
    }

    pub fn surfaces() -> Result<Vec<WindowSurface>, String> {
        unsafe {
            let mut context = EnumContext {
                process_id: GetCurrentProcessId(),
                surfaces: Vec::new(),
            };
            if EnumWindows(
                Some(enumerate_window),
                &mut context as *mut EnumContext as LPARAM,
            ) == 0
            {
                return Err("无法枚举桌面窗口。".into());
            }
            context
                .surfaces
                .sort_by_key(|surface| (surface.y, surface.x));
            Ok(context.surfaces)
        }
    }
}

pub fn start_fullscreen_watcher(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    {
        use crate::settings::AppState;
        use std::{thread, time::Duration};

        let app = app.clone();
        thread::spawn(move || {
            let mut auto_hidden = false;
            loop {
                let Some(window) = app.get_webview_window("pet") else {
                    break;
                };

                let user_wants_visible = app
                    .state::<AppState>()
                    .settings
                    .lock()
                    .map(|settings| settings.pet_visible)
                    .unwrap_or(false);

                if !user_wants_visible {
                    auto_hidden = false;
                    thread::sleep(Duration::from_millis(450));
                    continue;
                }

                let fullscreen = match (window.outer_position(), window.outer_size()) {
                    (Ok(position), Ok(size)) => windows_impl::has_fullscreen_at(
                        position.x + size.width as i32 / 2,
                        position.y + size.height as i32 / 2,
                    ),
                    _ => false,
                };

                if fullscreen && !auto_hidden {
                    let _ = window.hide();
                    auto_hidden = true;
                } else if !fullscreen && auto_hidden {
                    let should_restore = app
                        .state::<AppState>()
                        .settings
                        .lock()
                        .map(|settings| settings.pet_visible)
                        .unwrap_or(false);
                    if should_restore {
                        let _ = window.show();
                    }
                    auto_hidden = false;
                }

                thread::sleep(Duration::from_millis(450));
            }
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
    }
}

#[tauri::command]
pub fn get_work_area_at(x: i32, y: i32) -> Result<WorkArea, String> {
    #[cfg(target_os = "windows")]
    {
        return windows_impl::work_area_at(x, y);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (x, y);
        Err("窗口停靠目前仅支持 Windows。".into())
    }
}

#[tauri::command]
pub fn list_dock_surfaces() -> Result<Vec<WindowSurface>, String> {
    #[cfg(target_os = "windows")]
    {
        return windows_impl::surfaces();
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}
