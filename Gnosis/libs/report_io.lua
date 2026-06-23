
local _coop = false
local _enc_check = 0
local _slice_start = 0
local _ENC_CHECK_EVERY = 50
local _SLICE_BUDGET_SEC = 0.008

function _is_json_array(t)
    local mt = getmetatable(t)
    if mt and mt.__jsontype == 'array' then return true end
    if next(t) == nil then return false end
    return type(next(t)) == 'number'
end

function _stream_encode(f, v, depth)
    depth = depth or 0
    if _coop then
        _enc_check = _enc_check + 1
        if _enc_check >= _ENC_CHECK_EVERY then
            _enc_check = 0
            if os.clock() - _slice_start > _SLICE_BUDGET_SEC then
                coroutine.yield()
                _slice_start = os.clock()
            end
        end
    end
    if depth > 20 then f:write('null'); return end
    if v == json.null then f:write('null'); return end
    if type(v) ~= 'table' then f:write(json.encode(v)); return end
    if _is_json_array(v) then
        f:write('[')
        local n = #v
        for i = 1, n do
            if i > 1 then f:write(',') end
            _stream_encode(f, v[i], depth + 1)
        end
        f:write(']')
    else
        f:write('{')
        local first = true
        for k, val in pairs(v) do
            if not first then f:write(',') end
            first = false
            f:write(json.encode(tostring(k)))
            f:write(':')
            _stream_encode(f, val, depth + 1)
        end
        f:write('}')
    end
end

-- cooperative=true => yield periodically while encoding (caller MUST be running
-- inside a Windower coroutine, e.g. generate_report or a coroutine.schedule fn).
function _write_table_streamed(target_path, tbl, cooperative)
    local _tag = target_path:match('([^/\\]+)$') or target_path
    local _t_open = os.clock()
    local tmp = target_path .. '.tmp'
    local f = io.open(tmp, 'w')
    if not f then
        gn_chat_warn('Could not open .tmp for writing.')
        return false
    end
    pcall(function() f:setvbuf('full', 256 * 1024) end)
    local _ms_open = math.floor((os.clock() - _t_open) * 1000)
    local _t_enc = os.clock()
    local ok, err
    if cooperative == true then
        _coop, _enc_check, _slice_start = true, 0, os.clock()
        local co = coroutine.create(function() _stream_encode(f, tbl) end)
        local _slices, _max_slice_ms, _total_slice_ms = 0, 0, 0
        while true do
            local _slice_t0 = os.clock()
            local rok, rerr = coroutine.resume(co)
            local _slice_ms = (os.clock() - _slice_t0) * 1000
            _slices = _slices + 1
            _total_slice_ms = _total_slice_ms + _slice_ms
            if _slice_ms > _max_slice_ms then _max_slice_ms = _slice_ms end
            if not rok then ok, err = false, rerr; break end
            if coroutine.status(co) == 'dead' then ok = true; break end
            coroutine.sleep(0)
        end
        _coop = false
    else
        ok, err = pcall(_stream_encode, f, tbl)
    end
    local _ms_enc = math.floor((os.clock() - _t_enc) * 1000)
    if ff_perf_record_save then ff_perf_record_save(_ms_enc) end
    local _t_close = os.clock()
    f:close()
    local _ms_close = math.floor((os.clock() - _t_close) * 1000)
    if not ok then
        gn_chat_warn(('Stream-encode failed: %s'):format(tostring(err)))
        pcall(function() os.remove(tmp) end)
        return false
    end
    local _t_ren = os.clock()
    local rename_ok = false
    for _ = 1, 6 do
        pcall(function() os.remove(target_path) end)
        rename_ok = os.rename(tmp, target_path) and true or false
        if rename_ok then break end
    end
    local _ms_ren = math.floor((os.clock() - _t_ren) * 1000)
    if not rename_ok then
        return false
    end
    return true
end

function downsample_log(log, max)
    local n = (type(log) == 'table') and #log or 0
    if n <= max then return 0 end
    local step = math.ceil(n / max)
    local w = 0
    for i = 1, n, step do w = w + 1; log[w] = log[i] end
    if log[w] ~= log[n] then w = w + 1; log[w] = log[n] end
    for i = w + 1, n do log[i] = nil end
    return n - w
end

function save_report_file(report_table)
    local tag = ff_char_filetag and ff_char_filetag() or 'unknown'
    local filename = string.format('sortie_%s__%s.json', get_timestamp(), tag)
    local path = windower.addon_path .. 'data/' .. filename

    if not _write_table_streamed(path, report_table, true) then
        gn_chat_warn('Failed to write sortie report file.')
        return
    end
    gn_chat(('Report saved to: data/%s'):format(filename))
end
