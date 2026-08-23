use serde::Serialize;

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
        },
    };

    struct EnumContext {
        process_id: u32,
        surfaces: Vec<WindowSurface>,
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

    unsafe extern "system" fn enumerate_window(hwnd: HWND, parameter: LPARAM) -> BOOL {
        let context = &mut *(parameter as *mut EnumContext);
        if IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
            return 1;
        }

        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        if process_id == 0 || process_id == context.process_id {
            return 1;
        }

        let extended_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if extended_style & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) != 0 {
            return 1;
        }

        let class = class_name(hwnd);
        if matches!(
            class.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        ) {
            return 1;
        }

        let mut cloaked = 0u32;
        let cloak_result = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED as u32,
            &mut cloaked as *mut u32 as *mut c_void,
            size_of::<u32>() as u32,
        );
        if cloak_result >= 0 && cloaked != 0 {
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

    pub fn work_area_at(x: i32, y: i32) -> Result<WorkArea, String> {
        unsafe {
            let monitor = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
            if monitor.is_null() {
                return Err("无法识别当前显示器。".into());
            }
            let mut info: MONITORINFO = zeroed();
            info.cbSize = size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(monitor, &mut info) == 0 {
                return Err("无法读取显示器工作区。".into());
            }
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
