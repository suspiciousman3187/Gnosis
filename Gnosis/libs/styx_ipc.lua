
local socket = require('socket')
local IPC_HOST, IPC_PORT = '127.0.0.1', 24199

local ipc_sock = nil
local ipc_connected = false
local ipc_last_try = 0
local ipc_seq = 0

local function ipc_disconnect()
    if ipc_sock then pcall(function() ipc_sock:close() end) end
    ipc_sock = nil
    ipc_connected = false
end

local function ipc_try_connect()
    ipc_disconnect()
    local s = socket.tcp()
    s:settimeout(0.2)
    local ok = s:connect(IPC_HOST, IPC_PORT)
    if ok then
        s:settimeout(0)
        ipc_sock = s
        ipc_connected = true
    else
        pcall(function() s:close() end)
    end
end

function ff_ipc_connected() return ipc_connected end

function ff_ipc_send_raw_line(line)
    if not ipc_sock or type(line) ~= 'string' then return false end
    local sent, err = ipc_sock:send(line .. '\n')
    if not sent then
        if err ~= 'timeout' then ipc_disconnect() end
        return false
    end
    return true
end

-- Send one table as a newline-delimited JSON message. Drops + flags reconnect on
-- a hard error; a transient 'timeout' (full send buffer) just skips this frame.
function ff_ipc_send(tbl)
    if not ipc_sock then return false end
    local ok, line = pcall(json.encode, tbl)
    if not ok or type(line) ~= 'string' then return false end
    return ff_ipc_send_raw_line(line)
end

-- Reconnect bookkeeping; call ~1 Hz. Retries every 3s while the app is down.
function ff_ipc_ensure()
    if ipc_connected then return end
    local now = os.clock()
    if now - ipc_last_try >= 3 then
        ipc_last_try = now
        ipc_try_connect()
    end
end

-- Authoritative self snapshot (job is exact via get_player - the whole point).
-- Name resolved through the customizer (never the raw server name).
function ff_ipc_send_self()
    if not ipc_connected then return end
    local p = windower.ffxi.get_player()
    if not p or not p.id then return end
    local name = (self_name and self_name()) or (resolve_member_name and resolve_member_name(p.id, p.name)) or p.name
    local v = p.vitals or {}
    local zid = (windower.ffxi.get_info() or {}).zone
    local zres = zid and res and res.zones and res.zones[zid]
    ff_ipc_send({
        t         = 'self',
        id        = p.id,
        name      = name,
        main      = p.main_job,      main_lvl = p.main_job_level,
        sub       = p.sub_job,       sub_lvl  = p.sub_job_level,
        hpp       = v.hpp, mpp = v.mpp, tp = v.tp,
        zone      = zid,
        zone_name = ff_loc_name(zres, nil),
    })
end

-- Stream a single combat action-log entry (already in the structured shape the
-- report uses). seq is per-box monotonic so the app can order/dedup.
function ff_ipc_send_action(entry)
    if not ipc_connected or not entry then return end
    ipc_seq = ipc_seq + 1
    ff_ipc_send({ t = 'action', seq = ipc_seq, e = entry })
end

local _combat_encoding_busy = false
local LIVE_COMBAT_TOUCH_TTL_SEC = 300

function ff_ipc_send_combat()
    if not ipc_connected then return end
    if _combat_encoding_busy then return end
    local cs = ff_live_combat_stats
    if type(cs) ~= 'table' or next(cs) == nil then return end
    local start_ts = ff_live_combat_start
    local trimmed = cs
    local touched = ff_cs_touched
    if type(touched) == 'table' then
        local now = os.time()
        trimmed = {}
        for mob, players in pairs(cs) do
            local t = touched[mob]
            if t and (now - t) <= LIVE_COMBAT_TOUCH_TTL_SEC then
                trimmed[mob] = players
            end
        end
        if next(trimmed) == nil then return end
    end
    _combat_encoding_busy = true
    coroutine.schedule(function()
        local line, err = _stream_encode_to_string_coop({ t = 'combat', cs = trimmed, start = start_ts })
        _combat_encoding_busy = false
        if line then
            ff_ipc_send_raw_line(line)
        elseif err then end
    end, 0)
end

function ff_ipc_send_live(payload)
    if not ipc_connected or type(payload) ~= 'table' then return end
    ff_ipc_send({ t = 'live', live = payload })
end

function ff_ipc_send_kill(entry)
    if not ipc_connected or type(entry) ~= 'table' then return end
    ff_ipc_send({ t = 'kill', kill = entry })
end

-- Encounter boundary markers so the app knows when a box opens/closes a fight.
function ff_ipc_send_enc(phase, zone_name)
    if not ipc_connected then return end
    local p = windower.ffxi.get_player()
    ff_ipc_send({ t = 'enc', phase = phase, id = p and p.id, zone = zone_name })
end
