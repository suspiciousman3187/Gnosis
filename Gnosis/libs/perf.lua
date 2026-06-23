_g_perf = _g_perf or {
    on = false,
    started_at = 0,
    totals = {},
    last5s = {},
    history = {},
    mem_kb = {},
    last_save_ms = 0,
    save_count = 0,
    last_tick_clock = 0,
    error_count = 0,
    enc_start_at = 0,
    enc_start_totals = nil,
    enc_start_heap = 0,
}
local p = _g_perf
local PERF_DIR = windower.addon_path .. 'data/Performance Logs'

local function bucket(t, name)
    local b = t[name]
    if not b then b = { count = 0, ms = 0, max = 0 }; t[name] = b end
    return b
end

local function reset_buckets()
    p.totals, p.last5s, p.history, p.mem_kb = {}, {}, {}, {}
    p.last_save_ms, p.save_count, p.error_count = 0, 0, 0
end

function ff_perf_event(name, fn)
    return function(...)
        if not p.on then return fn(...) end
        local t0 = os.clock()
        local r1, r2, r3, r4, r5 = fn(...)
        local dt = (os.clock() - t0) * 1000
        local bt = bucket(p.totals, name)
        bt.count = bt.count + 1; bt.ms = bt.ms + dt
        if dt > bt.max then bt.max = dt end
        local b5 = bucket(p.last5s, name)
        b5.count = b5.count + 1; b5.ms = b5.ms + dt
        if dt > b5.max then b5.max = dt end
        return r1, r2, r3, r4, r5
    end
end

function ff_perf_time(name, fn, ...)
    if not p.on then return fn(...) end
    local t0 = os.clock()
    local r1, r2, r3, r4, r5 = fn(...)
    local dt = (os.clock() - t0) * 1000
    local bt = bucket(p.totals, name)
    bt.count = bt.count + 1; bt.ms = bt.ms + dt
    if dt > bt.max then bt.max = dt end
    local b5 = bucket(p.last5s, name)
    b5.count = b5.count + 1; b5.ms = b5.ms + dt
    if dt > b5.max then b5.max = dt end
    return r1, r2, r3, r4, r5
end

function ff_perf_record_save(ms)
    if not p.on then return end
    p.last_save_ms = ms
    p.save_count = p.save_count + 1
end

function ff_perf_tick(c)
    if not p.on then return end
    if c - p.last_tick_clock < 5 then return end
    p.last_tick_clock = c
    local snap = {}
    for k, v in pairs(p.last5s) do snap[k] = { count = v.count, ms = v.ms, max = v.max } end
    table.insert(p.history, snap)
    if #p.history > 60 then table.remove(p.history, 1) end
    local mem = collectgarbage('count')
    table.insert(p.mem_kb, mem)
    if #p.mem_kb > 60 then table.remove(p.mem_kb, 1) end
    p.last5s = {}
end

function ff_perf_on()
    reset_buckets()
    p.on = true
    p.started_at = os.time()
    p.last_tick_clock = os.clock()
end

function ff_perf_off() p.on = false end
function ff_perf_reset() reset_buckets() end
function ff_perf_is_on() return p.on end

local function fmt_row(name, b)
    local avg_us = (b.count > 0) and (b.ms * 1000 / b.count) or 0
    return string.format('  %-16s %8d calls  %10.1f ms total  %8.1f us/call  max %6.1f ms\n', name, b.count, b.ms, avg_us, b.max)
end

local function build_dump()
    local lines = {}
    local now = os.time()
    local elapsed = now - p.started_at
    table.insert(lines, string.format('=== Gnosis perf snapshot %s ===\n', os.date('%Y-%m-%d %H:%M:%S', now)))
    table.insert(lines, string.format('collecting for %ds  errors=%d  saves=%d (last %.1f ms)\n', elapsed, p.error_count, p.save_count, p.last_save_ms))
    local mem = collectgarbage('count')
    table.insert(lines, string.format('lua heap: %.1f MB\n\n', mem / 1024))

    table.insert(lines, 'per-event totals:\n')
    local names = {}
    for k in pairs(p.totals) do table.insert(names, k) end
    table.sort(names, function(a, b) return (p.totals[a].ms or 0) > (p.totals[b].ms or 0) end)
    for _, k in ipairs(names) do table.insert(lines, fmt_row(k, p.totals[k])) end

    table.insert(lines, '\nper-event 5s history (newest last):\n')
    table.insert(lines, '  idx ')
    for _, k in ipairs(names) do table.insert(lines, string.format(' %-16s', k)) end
    table.insert(lines, '  heap_MB\n')
    for i, snap in ipairs(p.history) do
        table.insert(lines, string.format('  %3d ', i))
        for _, k in ipairs(names) do
            local b = snap[k]
            if b then table.insert(lines, string.format(' %6.1fms/%5d   ', b.ms, b.count))
            else table.insert(lines, string.format(' %-16s', '-')) end
        end
        local m = p.mem_kb[i] or 0
        table.insert(lines, string.format(' %6.1f\n', m / 1024))
    end
    return table.concat(lines)
end

local function ensure_perf_dir()
    if gn_ensure_dir then gn_ensure_dir(PERF_DIR) end
end

function ff_perf_dump_file()
    ensure_perf_dir()
    local ts = os.date('%Y%m%d_%H%M%S')
    local rel = 'data/Performance Logs/manual_' .. ts .. '.txt'
    local f = io.open(PERF_DIR .. '/manual_' .. ts .. '.txt', 'w')
    if not f then return nil end
    f:write(build_dump())
    f:close()
    return rel
end

local function snapshot_totals()
    local snap = {}
    for k, v in pairs(p.totals) do snap[k] = { count = v.count, ms = v.ms, max = v.max } end
    return snap
end

function ff_perf_encounter_open()
    if not p.on then return end
    p.enc_start_at = os.time()
    p.enc_start_totals = snapshot_totals()
    p.enc_start_heap = collectgarbage('count')
end

function ff_perf_encounter_close_dump(basename)
    if not p.on or not p.enc_start_totals or type(basename) ~= 'string' or basename == '' then return nil end
    ensure_perf_dir()
    local now = os.time()
    local elapsed = now - p.enc_start_at
    local end_heap = collectgarbage('count')
    local lines = {}
    table.insert(lines, string.format('=== Gnosis perf for encounter %s ===\n', basename))
    table.insert(lines, string.format('duration %ds  saves=%d (last %.1f ms)\n', elapsed, p.save_count, p.last_save_ms))
    table.insert(lines, string.format('lua heap: start %.1f MB  end %.1f MB  delta %+.1f MB\n\n',
        p.enc_start_heap / 1024, end_heap / 1024, (end_heap - p.enc_start_heap) / 1024))
    table.insert(lines, 'per-event during this encounter:\n')
    local names = {}
    for k in pairs(p.totals) do table.insert(names, k) end
    table.sort(names, function(a, b)
        local sa = p.enc_start_totals[a] or { ms = 0 }
        local sb = p.enc_start_totals[b] or { ms = 0 }
        return (p.totals[a].ms - sa.ms) > (p.totals[b].ms - sb.ms)
    end)
    for _, k in ipairs(names) do
        local cur = p.totals[k]
        local st = p.enc_start_totals[k] or { count = 0, ms = 0, max = 0 }
        local dcount = cur.count - st.count
        local dms = cur.ms - st.ms
        local avg_us = (dcount > 0) and (dms * 1000 / dcount) or 0
        table.insert(lines, string.format('  %-16s %8d calls  %10.1f ms total  %8.1f us/call  max %6.1f ms (lifetime)\n',
            k, dcount, dms, avg_us, cur.max))
    end
    p.enc_start_totals = nil
    local safe = basename:gsub('[^%w_%-%.]', '_')
    local rel = 'data/Performance Logs/' .. safe .. '__perf.txt'
    local f = io.open(PERF_DIR .. '/' .. safe .. '__perf.txt', 'w')
    if not f then return nil end
    f:write(table.concat(lines))
    f:close()
    return rel
end
