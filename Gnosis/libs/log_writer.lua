
-- log_writer.lua - Disk-streamed per-log append writer.
--
-- During the run, a background coroutine polls the source tables (enc.* for
-- generic, _G.* for Sortie) every 5 s and APPENDS new entries directly to
-- per-log .partial files on disk. Memory pressure is constant (a few KB of
-- transient JSON per tick, immediately flushed to disk and freed).
--
-- At save time `pool.finalize(scalar_report, final_path)` stops polling, drains
-- a last tick, closes the partial handles, then writes the final .json by
-- streaming the scalar fields cooperatively (`_stream_encode`) and stream-
-- copying each partial's contents into a top-level array. Atomic rename + sweep
-- the partials when done.
--
-- This replaces the failed in-memory streaming_save pattern. The data lives on
-- disk, not in memory string buffers, so it can't OOM and it can't fragment
-- the 32-bit FFXI process address space.

local M = {}

-- prefix_path: absolute path WITHOUT extension. Partials become
-- "<prefix>.<logName>.partial", final becomes "<prefix>.json".
-- source: table to poll (e.g. an `enc` table, or `_G` for Sortie).
-- log_map: { [logFieldName] = sourceFieldName, ... } -- e.g.
--   { actionLog = 'action_log', positionLog = 'position_log', ... }
function M.open(prefix_path, source, log_map)
    local handles = {}
    local indices = {}
    local first   = {}
    local closed  = false
    local active  = true
    local ticks   = 0
    local entries = 0

    for log_name in pairs(log_map) do
        indices[log_name] = 0
        first[log_name]   = true
    end

    local function partial_path(log_name)
        return prefix_path .. '.' .. log_name .. '.partial'
    end

    local function open_handle(log_name)
        local h = io.open(partial_path(log_name), 'w')
        if not h then return nil end
        pcall(function() h:setvbuf('full', 64 * 1024) end)
        return h
    end

    local function tick_once()
        if closed then return 0 end
        if type(source) ~= 'table' then return 0 end
        local encoded_this_tick = 0
        for log_name, src_field in pairs(log_map) do
            local log = source[src_field]
            if type(log) == 'table' then
                local n = #log
                local from = indices[log_name] + 1
                if n >= from then
                    local h = handles[log_name]
                    if not h then
                        h = open_handle(log_name)
                        handles[log_name] = h
                    end
                    if h then
                        for i = from, n do
                            local ok, s = pcall(json.encode, log[i])
                            if ok and s then
                                if first[log_name] then
                                    first[log_name] = false
                                    h:write(s)
                                else
                                    h:write(',')
                                    h:write(s)
                                end
                                encoded_this_tick = encoded_this_tick + 1
                            end
                        end
                        indices[log_name] = n
                    end
                end
            end
        end
        ticks = ticks + 1
        entries = entries + encoded_this_tick
        return encoded_this_tick
    end

    -- Background ticker. Same cadence as the old streaming_save (5 s) so per-
    -- tick cost stays low (~10-30 ms on a busy encounter) and is well under a
    -- frame budget.
    coroutine.schedule(function()
        while active do
            local ok = pcall(tick_once)
            if not ok then break end
            coroutine.sleep(5)
        end
    end, 5)

    local pool = {}

    function pool.tick() return tick_once() end

    function pool.discard()
        active = false
        closed = true
        for log_name, h in pairs(handles) do
            pcall(function() h:close() end)
            pcall(os.remove, partial_path(log_name))
        end
        handles = {}
    end

    -- scalar_report: a flat table with the encounter's NON-log fields. Anything
    -- in log_map keys will be ignored / overwritten by the partial-spliced data.
    -- Returns (true, telemetry) on success; (false, err) on failure.
    function pool.finalize(scalar_report, final_path)
        active = false
        local t_total = os.clock()

        -- One last tick to drain any entries that landed since the last
        -- periodic tick fired.
        local t_drain = os.clock()
        tick_once()
        closed = true
        for _, h in pairs(handles) do
            pcall(function() h:flush(); h:close() end)
        end
        local ms_drain = (os.clock() - t_drain) * 1000

        local t_enc = os.clock()
        local tmp = final_path .. '.' .. tostring(os.time()) .. '.' .. tostring(math.random(0, 999999)) .. '.tmp'
        local f = io.open(tmp, 'w')
        if not f then return false, 'open tmp failed' end
        pcall(function() f:setvbuf('full', 256 * 1024) end)

        -- Opening brace.
        f:write('{')

        local need_sep = false

        -- Scalar fields via the existing cooperative _stream_encode (writes
        -- per-node, yields every N nodes). Skip anything that's a log field -
        -- those come from partials.
        for k, v in pairs(scalar_report) do
            if v ~= nil and log_map[k] == nil then
                if need_sep then f:write(',') end
                need_sep = true
                f:write(json.encode(tostring(k)))
                f:write(':')
                _stream_encode(f, v)
            end
        end
        local ms_enc = (os.clock() - t_enc) * 1000

        -- Splice each non-empty partial as a top-level array field. Stream-copy
        -- in 64 KB chunks so peak memory stays small even for a multi-MB log.
        local t_splice = os.clock()
        local total_bytes = 0
        for log_name in pairs(log_map) do
            local p = partial_path(log_name)
            local rh = io.open(p, 'r')
            if rh then
                local probe = rh:read(64 * 1024)
                if probe and #probe > 0 then
                    if need_sep then f:write(',') end
                    need_sep = true
                    f:write(json.encode(log_name))
                    f:write(':[')
                    f:write(probe)
                    total_bytes = total_bytes + #probe
                    while true do
                        local chunk = rh:read(64 * 1024)
                        if not chunk or #chunk == 0 then break end
                        f:write(chunk)
                        total_bytes = total_bytes + #chunk
                    end
                    f:write(']')
                end
                rh:close()
            end
        end
        local ms_splice = (os.clock() - t_splice) * 1000

        f:write('}')
        f:close()

        -- Atomic rename. Retry a few times for the same reason report_io does
        -- (transient lock from indexer / AV / preview pane).
        local t_io = os.clock()
        local rename_ok = false
        for _ = 1, 6 do
            pcall(function() os.remove(final_path) end)
            if os.rename(tmp, final_path) then rename_ok = true; break end
        end
        local ms_io = (os.clock() - t_io) * 1000

        -- Cleanup the partials only after the rename succeeded - if it failed,
        -- the partials survive so a future retry can still recover the data.
        if rename_ok then
            for log_name in pairs(handles) do
                pcall(os.remove, partial_path(log_name))
            end
            -- Also try the names that were in log_map but never opened (in case
            -- of stale leftovers from a previous incomplete run with the same id).
            for log_name in pairs(log_map) do
                if not handles[log_name] then
                    pcall(os.remove, partial_path(log_name))
                end
            end
            handles = {}
        end

        local ms_total = (os.clock() - t_total) * 1000
        if not rename_ok then return false, 'rename failed' end
        return true, ('drain=%dms enc=%dms splice=%dms io=%dms total=%dms ticks=%d entries=%d bytes=%d')
            :format(ms_drain, ms_enc, ms_splice, ms_io, ms_total, ticks, entries, total_bytes)
    end

    return pool
end

-- Scan a directory for orphaned *.partial files (left behind by an addon crash
-- or reload mid-encounter) and remove them. Call this once at addon load.
local function scan_one(dir)
    local ok, entries = pcall(windower.get_dir, dir)
    if not ok or type(entries) ~= 'table' then return 0, {} end
    local removed = 0
    local subdirs = {}
    for _, name in ipairs(entries) do
        if type(name) == 'string' then
            if name:sub(-8) == '.partial' or name:sub(-4) == '.tmp' then
                local ok2 = pcall(os.remove, dir .. '/' .. name)
                if ok2 then removed = removed + 1 end
            elseif not name:find('%.') and name:sub(1, 1) ~= '.' then
                subdirs[#subdirs + 1] = dir .. '/' .. name
            end
        end
    end
    return removed, subdirs
end

function M.cleanup_orphans(data_dir)
    if not windower or not windower.get_dir then return 0 end
    local removed, subdirs = scan_one(data_dir)
    for _, sub in ipairs(subdirs) do
        local r, _ = scan_one(sub)
        removed = removed + r
    end
    return removed
end

return M
