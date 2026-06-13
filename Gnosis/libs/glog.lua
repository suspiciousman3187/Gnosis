
-- ── Pure-Lua little-endian packers ──────────────────────────────────────────

local function pack_u32(n)
    if n < 0 then n = n + 4294967296 end
    return string.char(
        bit.band(n, 0xFF),
        bit.band(bit.rshift(n, 8), 0xFF),
        bit.band(bit.rshift(n, 16), 0xFF),
        bit.band(bit.rshift(n, 24), 0xFF)
    )
end

local pack_i32 = pack_u32  -- two's complement wraps the same way

local function pack_double(n)
    if n ~= n then return '\1\0\0\0\0\0\248\127' end       -- NaN
    if n == math.huge then return '\0\0\0\0\0\0\240\127' end
    if n == -math.huge then return '\0\0\0\0\0\0\240\255' end
    if n == 0 then
        if 1 / n < 0 then return '\0\0\0\0\0\0\0\128' end
        return '\0\0\0\0\0\0\0\0'
    end
    local sign = 0
    if n < 0 then sign = 1; n = -n end
    local mantissa, exponent = math.frexp(n)
    mantissa = mantissa * 2 - 1
    exponent = exponent - 1 + 1023
    if exponent <= 0 then
        mantissa = (mantissa + 1) * (2 ^ (exponent - 1))
        exponent = 0
    elseif exponent >= 0x7FF then
        return sign == 1 and '\0\0\0\0\0\0\240\255' or '\0\0\0\0\0\0\240\127'
    end
    local frac = mantissa * (2 ^ 52)
    local frac_lo = frac % (2 ^ 32)
    local frac_hi = math.floor(frac / (2 ^ 32))
    local high = sign * 0x80000000 + exponent * 0x100000 + frac_hi
    return string.char(
        frac_lo % 256,
        math.floor(frac_lo / 256) % 256,
        math.floor(frac_lo / 65536) % 256,
        math.floor(frac_lo / 16777216) % 256,
        high % 256,
        math.floor(high / 256) % 256,
        math.floor(high / 65536) % 256,
        math.floor(high / 16777216) % 256
    )
end

-- ── Per-call streaming writer ───────────────────────────────────────────────

local _FLUSH_AT = 16 * 1024
local _ENC_CHECK_EVERY = 500
local _SLICE_BUDGET_SEC = 0.012
local MAX_DEPTH = 20

local function flush(st)
    if st.buflen == 0 then return end
    local big = table.concat(st.buf)
    st.file:write(big)
    st.bytes_written = st.bytes_written + #big
    st.buf = {}
    st.buflen = 0
end

local function emit(st, s)
    st.buf[#st.buf + 1] = s
    st.buflen = st.buflen + #s
    if st.buflen >= _FLUSH_AT then flush(st) end
end

local function maybe_yield(st)
    st.enc_check = st.enc_check + 1
    if st.enc_check >= _ENC_CHECK_EVERY then
        st.enc_check = 0
        if os.clock() - st.slice_start > _SLICE_BUDGET_SEC then
            coroutine.yield()
            st.slice_start = os.clock()
        end
    end
end

-- Mirrors dkjson's array-vs-map decision so the resulting JSON shape matches
-- what the previous encoder produced.
local function is_array(t)
    local mt = getmetatable(t)
    if mt and mt.__jsontype == 'array' then return true end
    if next(t) == nil then return false end
    return type(next(t)) == 'number'
end

local function encode_value(st, v, depth)
    maybe_yield(st)
    if depth > MAX_DEPTH then emit(st, '\0'); return end
    if v == nil or (json and v == json.null) then
        emit(st, '\0')
    elseif v == false then
        emit(st, '\1')
    elseif v == true then
        emit(st, '\2')
    elseif type(v) == 'number' then
        if v == math.floor(v) and v >= -2147483648 and v <= 2147483647 then
            emit(st, '\3' .. pack_i32(v))
        else
            emit(st, '\4' .. pack_double(v))
        end
    elseif type(v) == 'string' then
        -- Body emitted separately so big strings don't pay an extra alloc.
        emit(st, '\5' .. pack_u32(#v))
        emit(st, v)
    elseif type(v) == 'table' then
        if is_array(v) then
            local n = #v
            emit(st, '\6' .. pack_u32(n))
            for i = 1, n do
                encode_value(st, v[i], depth + 1)
            end
        else
            local count = 0
            for _ in pairs(v) do count = count + 1 end
            emit(st, '\7' .. pack_u32(count))
            for k, val in pairs(v) do
                local key = tostring(k)
                emit(st, pack_u32(#key) .. key)
                encode_value(st, val, depth + 1)
            end
        end
    else
        emit(st, '\0')  -- unsupported type → nil
    end
end

function ff_glog_save(path, tbl)
    local tmp_path = path .. '.tmp'
    local f, openerr = io.open(tmp_path, 'wb')
    if not f then return false, openerr or 'open failed' end
    pcall(function() f:setvbuf('full', 64 * 1024) end)

    local st = {
        file          = f,
        buf           = {},
        buflen        = 0,
        bytes_written = 0,
        enc_check     = 0,
        slice_start   = os.clock(),
    }

    emit(st, 'glog')
    emit(st, '\1')  -- version

    local co = coroutine.create(function() encode_value(st, tbl, 0) end)
    local ok, err = true, nil
    while true do
        local rok, rerr = coroutine.resume(co)
        if not rok then ok, err = false, rerr; break end
        if coroutine.status(co) == 'dead' then break end
        coroutine.sleep(0)
    end
    if ok then flush(st) end
    f:close()

    if not ok then
        -- Partial .tmp is unreadable; drop it. Final path was never created
        -- so the scanner never sees anything.
        pcall(os.remove, tmp_path)
        return false, err
    end

    pcall(os.remove, path)
    local rok, rerr = os.rename(tmp_path, path)
    if not rok then
        pcall(os.remove, tmp_path)
        return false, ('rename failed: %s'):format(tostring(rerr or 'unknown'))
    end
    return true, st.bytes_written
end
