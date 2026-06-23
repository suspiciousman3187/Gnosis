use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};

mod glog;
mod db;

const STYX_BOX_PORT: u16 = 24199;
static CONN_SEQ: AtomicU64 = AtomicU64::new(1);

static IPC_BOUND: AtomicBool = AtomicBool::new(false);
static SILENT_MODE_ON_MINIMIZE: AtomicBool = AtomicBool::new(false);
static SILENT_MODE_HIDE_OVERLAY: AtomicBool = AtomicBool::new(false);
static USER_QUITTING: AtomicBool = AtomicBool::new(false);
static STARTUP_CHECK_DONE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn set_silent_mode_on_minimize(enabled: bool) { SILENT_MODE_ON_MINIMIZE.store(enabled, Ordering::Relaxed); }

#[tauri::command]
fn get_silent_mode_on_minimize() -> bool { SILENT_MODE_ON_MINIMIZE.load(Ordering::Relaxed) }

#[tauri::command]
fn set_silent_mode_hide_overlay(enabled: bool) { SILENT_MODE_HIDE_OVERLAY.store(enabled, Ordering::Relaxed); }

#[tauri::command]
fn get_silent_mode_hide_overlay() -> bool { SILENT_MODE_HIDE_OVERLAY.load(Ordering::Relaxed) }

#[tauri::command]
fn enter_silent_mode(app: tauri::AppHandle) {
    use tauri::Manager;
    if SILENT_MODE_HIDE_OVERLAY.load(Ordering::Relaxed) {
        if let Some(w) = app.get_webview_window("overlay") { let _ = w.hide(); }
    }
    if let Some(w) = app.get_webview_window("main") { let _ = w.destroy(); }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    use tauri::Manager;
    USER_QUITTING.store(true, Ordering::Relaxed);
    if let Some(w) = app.get_webview_window("overlay") { let _ = w.close(); }
    if let Some(w) = app.get_webview_window("main") { let _ = w.close(); } else { app.exit(0); }
}

#[tauri::command]
fn was_startup_check_done() -> bool { STARTUP_CHECK_DONE.load(Ordering::Relaxed) }

#[tauri::command]
fn mark_startup_check_done() { STARTUP_CHECK_DONE.store(true, Ordering::Relaxed); }

#[tauri::command]
fn ipc_bound() -> bool { IPC_BOUND.load(Ordering::Relaxed) }

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_process_memory_bytes() -> Result<u64, String> {
    use std::mem::size_of;
    #[repr(C)]
    #[derive(Default)]
    struct PROCESS_MEMORY_COUNTERS {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
    }
    type HANDLE = *mut std::ffi::c_void;
    extern "system" {
        fn GetCurrentProcess() -> HANDLE;
        fn K32GetProcessMemoryInfo(handle: HANDLE, counters: *mut PROCESS_MEMORY_COUNTERS, cb: u32) -> i32;
    }
    unsafe {
        let mut counters = PROCESS_MEMORY_COUNTERS::default();
        counters.cb = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        let ok = K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb);
        if ok == 0 { return Err("GetProcessMemoryInfo failed".to_string()); }
        Ok(counters.working_set_size as u64)
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_process_memory_bytes() -> Result<u64, String> {
    Err("Process memory query not implemented for this platform".to_string())
}

#[derive(serde::Serialize, Clone)]
struct WebViewProcessInfo {
    pid: u32,
    name: String,
    working_set_bytes: u64,
    process_type: String,
    sub_type: String,
}

#[cfg(target_os = "windows")]
unsafe fn read_process_command_line(h: *mut std::ffi::c_void) -> Option<String> {
    use std::mem::size_of;
    type HANDLE = *mut std::ffi::c_void;

    #[repr(C)]
    struct PROCESS_BASIC_INFORMATION {
        exit_status: i32,
        peb_base_address: *mut std::ffi::c_void,
        affinity_mask: usize,
        base_priority: i32,
        unique_process_id: usize,
        inherited_from_unique_process_id: usize,
    }

    extern "system" {
        fn NtQueryInformationProcess(
            process: HANDLE,
            class: u32,
            information: *mut std::ffi::c_void,
            length: u32,
            return_length: *mut u32,
        ) -> i32;
        fn ReadProcessMemory(
            process: HANDLE,
            base: *const std::ffi::c_void,
            buffer: *mut std::ffi::c_void,
            size: usize,
            read: *mut usize,
        ) -> i32;
    }

    let mut pbi = PROCESS_BASIC_INFORMATION {
        exit_status: 0,
        peb_base_address: std::ptr::null_mut(),
        affinity_mask: 0,
        base_priority: 0,
        unique_process_id: 0,
        inherited_from_unique_process_id: 0,
    };
    let mut out_len: u32 = 0;
    let status = NtQueryInformationProcess(
        h, 0,
        &mut pbi as *mut _ as *mut std::ffi::c_void,
        size_of::<PROCESS_BASIC_INFORMATION>() as u32,
        &mut out_len,
    );
    if status != 0 || pbi.peb_base_address.is_null() { return None; }

    let mut peb = [0u8; 0x100];
    let mut read = 0usize;
    if ReadProcessMemory(h, pbi.peb_base_address, peb.as_mut_ptr() as *mut _, peb.len(), &mut read) == 0 { return None; }
    if read < 0x28 { return None; }

    let proc_params_addr = usize::from_ne_bytes(peb[0x20..0x28].try_into().ok()?) as *const u8;
    if proc_params_addr.is_null() { return None; }

    let mut proc_params = [0u8; 0x200];
    if ReadProcessMemory(h, proc_params_addr as *const _, proc_params.as_mut_ptr() as *mut _, proc_params.len(), &mut read) == 0 { return None; }
    if read < 0x80 { return None; }

    let cmd_len = u16::from_ne_bytes(proc_params[0x70..0x72].try_into().ok()?) as usize;
    let cmd_buf_ptr = usize::from_ne_bytes(proc_params[0x78..0x80].try_into().ok()?) as *const u16;
    if cmd_len == 0 || cmd_buf_ptr.is_null() || cmd_len > 32768 { return None; }

    let count = cmd_len / 2;
    let mut cmd_data = vec![0u16; count];
    if ReadProcessMemory(
        h,
        cmd_buf_ptr as *const _,
        cmd_data.as_mut_ptr() as *mut _,
        cmd_len,
        &mut read,
    ) == 0 { return None; }

    Some(String::from_utf16_lossy(&cmd_data))
}

#[cfg(target_os = "windows")]
fn classify_chromium_process(cmdline: Option<&str>) -> (String, String) {
    let Some(c) = cmdline else { return ("unknown".into(), String::new()); };
    let ptype = c.split_whitespace()
        .find_map(|t| t.strip_prefix("--type="))
        .map(|s| s.trim_end_matches('"').to_string())
        .unwrap_or_else(|| "browser".to_string());
    let sub = c.split_whitespace()
        .find_map(|t| t.strip_prefix("--utility-sub-type="))
        .map(|s| s.trim_end_matches('"').to_string())
        .unwrap_or_default();
    (ptype, sub)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_webview_processes() -> Result<Vec<WebViewProcessInfo>, String> {
    use std::mem::size_of;
    type DWORD = u32;
    type HANDLE = *mut std::ffi::c_void;
    const INVALID_HANDLE_VALUE: HANDLE = -1isize as HANDLE;
    const TH32CS_SNAPPROCESS: DWORD = 0x00000002;
    const PROCESS_QUERY_LIMITED_INFORMATION: DWORD = 0x1000;
    const PROCESS_VM_READ: DWORD = 0x0010;

    #[repr(C)]
    struct PROCESSENTRY32W {
        dw_size: DWORD,
        cnt_usage: DWORD,
        th32_process_id: DWORD,
        th32_default_heap_id: usize,
        th32_module_id: DWORD,
        cnt_threads: DWORD,
        th32_parent_process_id: DWORD,
        pc_pri_class_base: i32,
        dw_flags: DWORD,
        sz_exe_file: [u16; 260],
    }

    #[repr(C)]
    #[derive(Default)]
    struct PMC {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
    }

    extern "system" {
        fn CreateToolhelp32Snapshot(flags: DWORD, pid: DWORD) -> HANDLE;
        fn Process32FirstW(snap: HANDLE, lppe: *mut PROCESSENTRY32W) -> i32;
        fn Process32NextW(snap: HANDLE, lppe: *mut PROCESSENTRY32W) -> i32;
        fn CloseHandle(h: HANDLE) -> i32;
        fn GetCurrentProcessId() -> DWORD;
        fn OpenProcess(access: DWORD, inherit: i32, pid: DWORD) -> HANDLE;
        fn K32GetProcessMemoryInfo(handle: HANDLE, counters: *mut PMC, cb: u32) -> i32;
    }

    unsafe {
        let my_pid = GetCurrentProcessId();
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE { return Err("CreateToolhelp32Snapshot failed".to_string()); }
        let mut all: Vec<(DWORD, DWORD, String)> = Vec::new();
        let mut pe = std::mem::zeroed::<PROCESSENTRY32W>();
        pe.dw_size = size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut pe);
        while ok != 0 {
            let name_end = pe.sz_exe_file.iter().position(|&c| c == 0).unwrap_or(pe.sz_exe_file.len());
            let name = String::from_utf16_lossy(&pe.sz_exe_file[..name_end]);
            all.push((pe.th32_process_id, pe.th32_parent_process_id, name));
            ok = Process32NextW(snap, &mut pe);
        }
        CloseHandle(snap);

        let mut descendants: std::collections::HashSet<DWORD> = std::collections::HashSet::new();
        descendants.insert(my_pid);
        let mut changed = true;
        while changed {
            changed = false;
            for (pid, ppid, _) in &all {
                if descendants.contains(ppid) && !descendants.contains(pid) {
                    descendants.insert(*pid);
                    changed = true;
                }
            }
        }

        let mut out: Vec<WebViewProcessInfo> = Vec::new();
        for (pid, _, name) in &all {
            if !descendants.contains(pid) { continue; }
            if *pid == my_pid { continue; }
            if !name.eq_ignore_ascii_case("msedgewebview2.exe") { continue; }
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, *pid);
            if h.is_null() { continue; }
            let mut counters = PMC::default();
            counters.cb = size_of::<PMC>() as u32;
            let got = K32GetProcessMemoryInfo(h, &mut counters, counters.cb);
            let cmdline = read_process_command_line(h);
            let (ptype, sub) = classify_chromium_process(cmdline.as_deref());
            CloseHandle(h);
            if got != 0 {
                out.push(WebViewProcessInfo {
                    pid: *pid,
                    name: name.clone(),
                    working_set_bytes: counters.working_set_size as u64,
                    process_type: ptype,
                    sub_type: sub,
                });
            }
        }
        out.sort_by(|a, b| b.working_set_bytes.cmp(&a.working_set_bytes));
        Ok(out)
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_webview_processes() -> Result<Vec<WebViewProcessInfo>, String> {
    Err("Per-process query only implemented for Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
fn classify_chromium_process(_: Option<&str>) -> (String, String) { ("unknown".into(), String::new()) }

#[derive(Clone, serde::Serialize)]
struct VmRegionTop {
    base: String,
    size_bytes: u64,
    type_name: String,
    protect_name: String,
}

#[derive(Clone, serde::Serialize)]
struct VmStats {
    pid: u32,
    total_committed_bytes: u64,
    private_committed_bytes: u64,
    private_committed_rw_bytes: u64,
    private_committed_rx_bytes: u64,
    private_committed_rwx_bytes: u64,
    private_committed_other_bytes: u64,
    private_reserved_bytes: u64,
    image_bytes: u64,
    mapped_bytes: u64,
    region_count: u32,
    largest_private: Vec<VmRegionTop>,
    walk_ms: u64,
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn walk_process_vm(pid: u32) -> Result<VmStats, String> {
    use std::mem::size_of;
    use std::time::Instant;
    type DWORD = u32;
    type HANDLE = *mut std::ffi::c_void;
    const PROCESS_QUERY_LIMITED_INFORMATION: DWORD = 0x1000;

    const MEM_COMMIT: DWORD = 0x1000;
    const MEM_RESERVE: DWORD = 0x2000;
    const MEM_PRIVATE: DWORD = 0x20000;
    const MEM_MAPPED: DWORD = 0x40000;
    const MEM_IMAGE: DWORD = 0x1000000;

    const PAGE_NOACCESS: DWORD = 0x01;
    const PAGE_READONLY: DWORD = 0x02;
    const PAGE_READWRITE: DWORD = 0x04;
    const PAGE_WRITECOPY: DWORD = 0x08;
    const PAGE_EXECUTE: DWORD = 0x10;
    const PAGE_EXECUTE_READ: DWORD = 0x20;
    const PAGE_EXECUTE_READWRITE: DWORD = 0x40;
    const PAGE_EXECUTE_WRITECOPY: DWORD = 0x80;
    const PAGE_GUARD: DWORD = 0x100;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct MEMORY_BASIC_INFORMATION {
        base_address: usize,
        allocation_base: usize,
        allocation_protect: DWORD,
        partition_id: u16,
        _pad1: u16,
        region_size: usize,
        state: DWORD,
        protect: DWORD,
        mem_type: DWORD,
        _pad2: DWORD,
    }

    extern "system" {
        fn OpenProcess(access: DWORD, inherit: i32, pid: DWORD) -> HANDLE;
        fn CloseHandle(h: HANDLE) -> i32;
        fn VirtualQueryEx(h: HANDLE, addr: *const u8, info: *mut MEMORY_BASIC_INFORMATION, len: usize) -> usize;
    }

    fn protect_name(p: DWORD) -> &'static str {
        let base = p & !PAGE_GUARD;
        match base {
            PAGE_NOACCESS => "noaccess",
            PAGE_READONLY => "r",
            PAGE_READWRITE => "rw",
            PAGE_WRITECOPY => "rwc",
            PAGE_EXECUTE => "x",
            PAGE_EXECUTE_READ => "rx",
            PAGE_EXECUTE_READWRITE => "rwx",
            PAGE_EXECUTE_WRITECOPY => "rwxc",
            _ => "other",
        }
    }
    fn type_name(t: DWORD) -> &'static str {
        match t {
            MEM_PRIVATE => "private",
            MEM_MAPPED => "mapped",
            MEM_IMAGE => "image",
            _ => "free",
        }
    }
    fn classify_protect(p: DWORD) -> u8 {
        let base = p & !PAGE_GUARD;
        match base {
            PAGE_READWRITE | PAGE_WRITECOPY => 1,
            PAGE_EXECUTE_READ | PAGE_EXECUTE => 2,
            PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY => 3,
            _ => 4,
        }
    }

    unsafe {
        let started = Instant::now();
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() { return Err(format!("OpenProcess({pid}) failed")); }

        let mut stats = VmStats {
            pid,
            total_committed_bytes: 0,
            private_committed_bytes: 0,
            private_committed_rw_bytes: 0,
            private_committed_rx_bytes: 0,
            private_committed_rwx_bytes: 0,
            private_committed_other_bytes: 0,
            private_reserved_bytes: 0,
            image_bytes: 0,
            mapped_bytes: 0,
            region_count: 0,
            largest_private: Vec::new(),
            walk_ms: 0,
        };

        let mut top: Vec<(usize, usize, DWORD, DWORD)> = Vec::with_capacity(16);
        let mut addr: usize = 0;
        const USER_LIMIT: usize = 0x0000_7FFF_FFFE_0000;
        let info_size = size_of::<MEMORY_BASIC_INFORMATION>();

        loop {
            let mut info: MEMORY_BASIC_INFORMATION = std::mem::zeroed();
            let got = VirtualQueryEx(h, addr as *const u8, &mut info, info_size);
            if got == 0 { break; }
            stats.region_count += 1;

            let next = info.base_address.saturating_add(info.region_size);
            let size = info.region_size as u64;

            if info.state == MEM_COMMIT {
                stats.total_committed_bytes += size;
                match info.mem_type {
                    MEM_IMAGE => stats.image_bytes += size,
                    MEM_MAPPED => stats.mapped_bytes += size,
                    MEM_PRIVATE => {
                        stats.private_committed_bytes += size;
                        match classify_protect(info.protect) {
                            1 => stats.private_committed_rw_bytes += size,
                            2 => stats.private_committed_rx_bytes += size,
                            3 => stats.private_committed_rwx_bytes += size,
                            _ => stats.private_committed_other_bytes += size,
                        }
                        if size >= 1024 * 1024 {
                            top.push((info.base_address, info.region_size, info.mem_type, info.protect));
                        }
                    },
                    _ => {}
                }
            } else if info.state == MEM_RESERVE && info.mem_type == MEM_PRIVATE {
                stats.private_reserved_bytes += size;
            }

            if next <= addr || next >= USER_LIMIT { break; }
            addr = next;
        }
        CloseHandle(h);

        top.sort_by(|a, b| b.1.cmp(&a.1));
        stats.largest_private = top.into_iter().take(25).map(|(b, s, t, p)| VmRegionTop {
            base: format!("0x{:016x}", b),
            size_bytes: s as u64,
            type_name: type_name(t).to_string(),
            protect_name: protect_name(p).to_string(),
        }).collect();
        stats.walk_ms = started.elapsed().as_millis() as u64;

        Ok(stats)
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn walk_process_vm(_pid: u32) -> Result<VmStats, String> {
    Err("VirtualQueryEx walk only implemented for Windows".to_string())
}

#[derive(serde::Serialize)]
struct AddonInstallResult {
    installed_version: String,
    files_written: usize,
    files_skipped: usize,
    skipped_examples: Vec<String>,
    addon_dir: String,
}

fn read_addon_version(addon_dir: &Path) -> Option<String> {
    let main = addon_dir.join("Gnosis.lua");
    let content = fs::read_to_string(&main).ok()?;
    for line in content.lines().take(40) {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("_addon.version") {
            let after_eq = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '=');
            let v = after_eq.trim_matches(|c: char| c.is_whitespace() || c == '\'' || c == '"' || c == ',' || c == ';');
            if !v.is_empty() { return Some(v.to_string()); }
        }
    }
    None
}

#[tauri::command]
fn read_installed_addon_version(addon_dir: String) -> Result<Option<String>, String> {
    let p = Path::new(&addon_dir);
    if !p.is_dir() { return Err(format!("not a directory: {}", addon_dir)); }
    Ok(read_addon_version(p))
}

#[tauri::command]
fn derive_addon_dir(data_dir: String) -> Result<Option<String>, String> {
    let p = Path::new(&data_dir);
    let parent = p.parent().ok_or_else(|| format!("no parent for {}", data_dir))?;
    if parent.join("Gnosis.lua").is_file() {
        Ok(Some(parent.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    let out = h.finalize();
    let mut s = String::with_capacity(64);
    for b in out.iter() { s.push_str(&format!("{:02x}", b)); }
    s
}

fn should_skip_addon_path(rel: &str) -> bool {
    let normalized = rel.replace('\\', "/");
    if normalized.starts_with("data/") || normalized == "data" { return true; }
    if normalized.starts_with("../") || normalized.contains("/../") { return true; }
    let lower = normalized.to_lowercase();
    if lower.contains("config") && lower.ends_with(".json") { return true; }
    false
}

#[tauri::command]
fn install_addon_update(addon_dir: String, url: String, expected_sha256: Option<String>) -> Result<AddonInstallResult, String> {
    use std::io::Read;
    let target = Path::new(&addon_dir);
    if !target.is_dir() { return Err(format!("addon dir does not exist: {}", addon_dir)); }
    let existing_main = target.join("Gnosis.lua");
    if !existing_main.is_file() {
        return Err(format!("Gnosis.lua not found in {} — pick the addon folder, not the data folder", addon_dir));
    }

    let resp = ureq::get(&url).call().map_err(|e| format!("download failed: {e}"))?;
    let mut bytes: Vec<u8> = Vec::new();
    resp.into_reader().take(200 * 1024 * 1024).read_to_end(&mut bytes).map_err(|e| format!("read failed: {e}"))?;
    if bytes.is_empty() { return Err("downloaded zero bytes".to_string()); }

    if let Some(want) = expected_sha256.as_deref() {
        if !want.is_empty() {
            let got = sha256_hex(&bytes);
            if !got.eq_ignore_ascii_case(want) {
                return Err(format!("sha256 mismatch — got {got}, expected {want}"));
            }
        }
    }

    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("not a valid zip: {e}"))?;

    let mut has_gnosis_lua = false;
    for i in 0..archive.len() {
        let f = archive.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
        let name = f.name();
        if name == "Gnosis.lua" || name.ends_with("/Gnosis.lua") { has_gnosis_lua = true; }
    }
    if !has_gnosis_lua {
        return Err("zip does not contain Gnosis.lua at the root — refusing to install".to_string());
    }

    let mut files_written = 0usize;
    let mut files_skipped = 0usize;
    let mut skipped_examples: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
        let raw_name = entry.name().to_string();
        if entry.is_dir() { continue; }
        let rel = raw_name.trim_start_matches("./").to_string();
        if should_skip_addon_path(&rel) {
            files_skipped += 1;
            if skipped_examples.len() < 5 { skipped_examples.push(rel.clone()); }
            continue;
        }
        let out_path = target.join(&rel);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
        }
        let mut buf: Vec<u8> = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut buf).map_err(|e| format!("read {}: {}", rel, e))?;
        let tmp_path = out_path.with_extension("tmp_update");
        fs::write(&tmp_path, &buf).map_err(|e| format!("write tmp {}: {}", tmp_path.display(), e))?;
        if out_path.exists() { let _ = fs::remove_file(&out_path); }
        fs::rename(&tmp_path, &out_path).map_err(|e| format!("rename {} -> {}: {}", tmp_path.display(), out_path.display(), e))?;
        files_written += 1;
    }

    let installed_version = read_addon_version(target).unwrap_or_else(|| "unknown".to_string());
    Ok(AddonInstallResult {
        installed_version,
        files_written,
        files_skipped,
        skipped_examples,
        addon_dir: addon_dir.clone(),
    })
}

#[derive(Clone, serde::Serialize)]
struct BoxMsg {
    conn: u64,
    line: String,
}

static IPC_WRITERS: OnceLock<Mutex<HashMap<u64, Mutex<TcpStream>>>> = OnceLock::new();
fn ipc_writers() -> &'static Mutex<HashMap<u64, Mutex<TcpStream>>> {
    IPC_WRITERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn start_box_server(app: AppHandle) {
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", STYX_BOX_PORT)) {
            Ok(l) => l,
            Err(e) => {
                log::warn!("[styx] box server could not bind 127.0.0.1:{STYX_BOX_PORT}: {e}");
                IPC_BOUND.store(false, Ordering::Relaxed);
                return;
            }
        };
        IPC_BOUND.store(true, Ordering::Relaxed);
        log::info!("[styx] box server listening on 127.0.0.1:{STYX_BOX_PORT}");
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || {
                let conn = CONN_SEQ.fetch_add(1, Ordering::Relaxed);
                let writer_clone = stream.try_clone().ok();
                if let Some(w) = writer_clone {
                    if let Ok(mut map) = ipc_writers().lock() {
                        map.insert(conn, Mutex::new(w));
                    }
                }
                let reader = BufReader::new(stream);
                for line in reader.lines() {
                    match line {
                        Ok(line) if !line.trim().is_empty() => {
                            let _ = app.emit("styx://box-msg", BoxMsg { conn, line });
                        }
                        Ok(_) => {}
                        Err(_) => break,
                    }
                }
                if let Ok(mut map) = ipc_writers().lock() { map.remove(&conn); }
                let _ = app.emit("styx://box-gone", conn);
            });
        }
    });
}

#[tauri::command]
fn ipc_broadcast(line: String) -> usize {
    let mut sent = 0usize;
    let mut dead: Vec<u64> = Vec::new();
    if let Ok(map) = ipc_writers().lock() {
        for (conn, w) in map.iter() {
            if let Ok(mut s) = w.lock() {
                let payload = format!("{line}\n");
                if s.write_all(payload.as_bytes()).is_ok() {
                    sent += 1;
                } else {
                    dead.push(*conn);
                }
            }
        }
    }
    if !dead.is_empty() {
        if let Ok(mut map) = ipc_writers().lock() {
            for c in dead { map.remove(&c); }
        }
    }
    sent
}

#[tauri::command]
fn list_json_files(dir: String) -> Result<Vec<String>, String> {
    // Two-level scan: root data/ for legacy files + tracker control channels,
    // plus one level of subfolders for the per-zone organization (data/<zone>/).
    // _partials/ is the addon's working folder for in-flight encounters; skip it
    // entirely since its contents are never reports.
    let mut out = Vec::new();
    let rd = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in rd.flatten() {
        let p = entry.path();
        let name = match p.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        let file_type = match entry.file_type() { Ok(t) => t, Err(_) => continue };
        if file_type.is_dir() {
            if name == "_partials" || name == "_merged" || name == "_split" { continue; }
            // One level of recursion into a zone subfolder.
            if let Ok(rd2) = fs::read_dir(&p) {
                for sub in rd2.flatten() {
                    let sp = sub.path();
                    if let Some(sname) = sp.file_name().and_then(|n| n.to_str()) {
                        if sname.ends_with(".json") || sname.ends_with(".json.gz") {
                            if let Some(s) = sp.to_str() { out.push(s.to_string()); }
                        }
                    }
                }
            }
            continue;
        }
        if name.ends_with(".json") || name.ends_with(".json.gz") {
            if let Some(s) = p.to_str() { out.push(s.to_string()); }
        }
    }
    Ok(out)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        let mut dec = flate2::read::GzDecoder::new(&bytes[..]);
        let mut text = String::new();
        dec.read_to_string(&mut text).map_err(|e| e.to_string())?;
        return Ok(text);
    }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        let mut dec = flate2::read::GzDecoder::new(&bytes[..]);
        let mut out = Vec::with_capacity(bytes.len() * 4);
        dec.read_to_end(&mut out).map_err(|e| e.to_string())?;
        return Ok(tauri::ipc::Response::new(out));
    }
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn compress_idle_files(dir: String, age_secs: u64) -> Result<u32, String> {
    let mut compressed = 0u32;
    let now = SystemTime::now();
    // Helper that runs the compression pass on a single directory (no recursion
    // inside it — only the caller decides which dirs to visit).
    fn compress_in(target_dir: &Path, age_secs: u64, now: SystemTime, compressed: &mut u32) {
        let rd = match fs::read_dir(target_dir) { Ok(rd) => rd, Err(_) => return };
        for entry in rd.flatten() {
            let p = entry.path();
            let name = match p.file_name().and_then(|n| n.to_str()) {
                Some(n) => n,
                None => continue,
            };
            if !name.ends_with(".json") { continue; }
            if name.contains("snapshot") || name.contains("config") { continue; }
            if name.starts_with("tracker_") { continue; }
            let meta = match entry.metadata() { Ok(m) => m, Err(_) => continue };
            let mtime = match meta.modified() { Ok(t) => t, Err(_) => continue };
            let age = now.duration_since(mtime).unwrap_or(Duration::ZERO);
            if age.as_secs() < age_secs { continue; }
            let bytes = match fs::read(&p) { Ok(b) => b, Err(_) => continue };
            if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b { continue; }
            let gz_path: PathBuf = {
                let mut s = p.clone().into_os_string();
                s.push(".gz");
                PathBuf::from(s)
            };
            let tmp_path: PathBuf = {
                let mut s = gz_path.clone().into_os_string();
                s.push(".tmp");
                PathBuf::from(s)
            };
            let f = match fs::File::create(&tmp_path) { Ok(f) => f, Err(_) => continue };
            let mut enc = flate2::write::GzEncoder::new(f, flate2::Compression::default());
            if enc.write_all(&bytes).is_err() { let _ = fs::remove_file(&tmp_path); continue; }
            if enc.finish().is_err() { let _ = fs::remove_file(&tmp_path); continue; }
            if fs::rename(&tmp_path, &gz_path).is_err() {
                let _ = fs::remove_file(&tmp_path);
                continue;
            }
            let _ = fs::remove_file(&p);
            *compressed += 1;
        }
    }

    let root = Path::new(&dir);
    // Pass 1: root data/ (legacy files + any stragglers).
    compress_in(root, age_secs, now, &mut compressed);
    // Pass 2: each zone subfolder. Skip _partials (working files only).
    let rd = fs::read_dir(root).map_err(|e| e.to_string())?;
    for entry in rd.flatten() {
        let p = entry.path();
        let file_type = match entry.file_type() { Ok(t) => t, Err(_) => continue };
        if !file_type.is_dir() { continue; }
        let name = match p.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if name == "_partials" || name == "_merged" || name == "_split" { continue; }
        compress_in(&p, age_secs, now, &mut compressed);
    }
    Ok(compressed)
}

// Write a small text file (the tracker control channel). Used to send tracking
// commands to the addon by writing data/tracker_control.json.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(&path, contents).map_err(|e| e.to_string())
}

// Delete a report file from the library (user-initiated, confirmed in the UI).
#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) urls are allowed".into());
    }
    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new("explorer").arg(&url).spawn();
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = std::process::Command::new("xdg-open").arg(&url).spawn();
    spawned.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    } else {
        let _ = recreate_main_window(&app);
    }
}

fn recreate_main_window(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let url = WebviewUrl::App("index.html".into());
    let builder = WebviewWindowBuilder::new(app, "main", url)
        .title("Gnosis")
        .inner_size(1280.0, 860.0)
        .visible(true)
        .resizable(true)
        .decorations(false);
    let w = builder.build()?;
    let _ = w.show();
    let _ = w.set_focus();
    Ok(())
}

#[tauri::command]
fn destroy_main_window(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.destroy();
    }
}

#[cfg(target_os = "windows")]
fn start_minimize_watcher(app: tauri::AppHandle) {
    use tauri::Manager;
    std::thread::spawn(move || {
        let mut was_minimized = false;
        loop {
            std::thread::sleep(Duration::from_millis(500));
            if !SILENT_MODE_ON_MINIMIZE.load(Ordering::Relaxed) {
                was_minimized = false;
                continue;
            }
            let win = match app.get_webview_window("main") {
                Some(w) => w,
                None => { was_minimized = false; continue; }
            };
            let minimized = match win.is_minimized() {
                Ok(b) => b,
                Err(_) => continue,
            };
            if minimized && !was_minimized {
                was_minimized = true;
                let h = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if SILENT_MODE_HIDE_OVERLAY.load(Ordering::Relaxed) {
                        if let Some(w) = h.get_webview_window("overlay") { let _ = w.hide(); }
                    }
                    if let Some(w) = h.get_webview_window("main") { let _ = w.destroy(); }
                });
            } else if !minimized {
                was_minimized = false;
            }
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn start_minimize_watcher(_app: tauri::AppHandle) {}

#[cfg(target_os = "windows")]
fn setup_tray(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
    use tauri::menu::{MenuBuilder, MenuItemBuilder};

    let show_item = MenuItemBuilder::with_id("tray_show", "Show Gnosis").build(app)?;
    let hide_item = MenuItemBuilder::with_id("tray_hide", "Hide to Tray").build(app)?;
    let quit_item = MenuItemBuilder::with_id("tray_quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show_item, &hide_item, &quit_item]).build()?;

    let _tray = TrayIconBuilder::with_id("main_tray")
        .icon(app.default_window_icon().cloned().ok_or_else(|| tauri::Error::AssetNotFound("default_window_icon".into()))?)
        .tooltip("Gnosis")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "tray_show" => show_main_window(app.clone()),
                "tray_hide" => enter_silent_mode(app.clone()),
                "tray_quit" => quit_app(app.clone()),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle().clone());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn setup_tray(_app: &tauri::AppHandle) -> Result<(), tauri::Error> { Ok(()) }

#[tauri::command]
fn find_addon_data_dir() -> Option<String> {
    let candidates: [&str; 8] = [
        r"C:\Program Files (x86)\Windower Dev\addons\Gnosis\data",
        r"C:\Program Files (x86)\Windower\addons\Gnosis\data",
        r"C:\Program Files\Windower\addons\Gnosis\data",
        r"C:\Windower\addons\Gnosis\data",
        r"C:\Windower Dev\addons\Gnosis\data",
        r"D:\Windower\addons\Gnosis\data",
        r"D:\Program Files (x86)\Windower\addons\Gnosis\data",
        r"D:\Program Files (x86)\Windower Dev\addons\Gnosis\data",
    ];
    for path in candidates.iter() {
        if std::path::Path::new(path).is_dir() {
            return Some((*path).to_string());
        }
    }
    None
}

#[tauri::command]
fn process_glog_file(path: String) -> Result<String, String> {
    glog::process_file(Path::new(&path))
}

#[tauri::command]
fn scan_glog_dir(dir: String) -> Result<Vec<String>, String> {
    let p = Path::new(&dir);
    if !p.is_dir() { return Err(format!("not a directory: {}", dir)); }
    let mut out = Vec::new();
    for entry in fs::read_dir(p).map_err(|e| format!("readdir {}: {}", dir, e))? {
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("glog") { continue; }
        match glog::process_file(&path) {
            Ok(json_path) => out.push(json_path),
            Err(e) => log::warn!("[glog] process {} failed: {}", path.display(), e),
        }
    }
    Ok(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .manage(db::DbState(std::sync::Mutex::new(None)))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      start_box_server(app.handle().clone());
      let _ = setup_tray(app.handle());
      start_minimize_watcher(app.handle().clone());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      list_json_files, read_text_file, read_file_bytes, write_text_file, delete_file, open_url,
      compress_idle_files, find_addon_data_dir, show_main_window, ipc_broadcast,
      ipc_bound, get_process_memory_bytes, get_webview_processes, walk_process_vm, process_glog_file, scan_glog_dir,
      derive_addon_dir, read_installed_addon_version, install_addon_update,
      set_silent_mode_on_minimize, get_silent_mode_on_minimize, destroy_main_window,
      set_silent_mode_hide_overlay, get_silent_mode_hide_overlay, enter_silent_mode, quit_app,
      was_startup_check_done, mark_startup_check_done,
      db::db_open, db::db_get_summaries, db::db_get_loots, db::db_list_known_paths,
      db::db_put_summary, db::db_put_summaries, db::db_put_loot, db::db_put_loots,
      db::db_delete_paths, db::db_meta_get, db::db_meta_set, db::db_count_summaries,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app, event| {
      if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
        if USER_QUITTING.load(Ordering::Relaxed) { return; }
        if code.is_none() && SILENT_MODE_ON_MINIMIZE.load(Ordering::Relaxed) {
          api.prevent_exit();
        }
      }
    });
}
