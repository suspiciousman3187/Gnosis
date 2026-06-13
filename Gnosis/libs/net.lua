-- net.lua - Generic non-blocking HTTP helper, shared across modules.

local socket = require('socket')

function async_http_get(host, port, path, timeout_s)
    local deadline = os.clock() + (timeout_s or 8)
    local sock = socket.tcp()
    sock:settimeout(0)
    sock:connect(host, port)
    while true do
        local _, w = socket.select(nil, { sock }, 0)
        if w and w[1] then break end
        if os.clock() > deadline then sock:close() return nil end
        coroutine.sleep(0.05)
    end

    local req = ('GET %s HTTP/1.0\r\nHost: %s\r\nAccept: application/json\r\nConnection: close\r\n\r\n'):format(path, host)
    local sent = 0
    while sent < #req do
        local n, err, partial = sock:send(req, sent + 1)
        if n then sent = n
        elseif err == 'timeout' then
            sent = partial or sent
            if os.clock() > deadline then sock:close() return nil end
            coroutine.sleep(0.02)
        else sock:close() return nil end
    end

    local chunks = {}
    while true do
        local data, err, partial = sock:receive('*a')
        if data then chunks[#chunks + 1] = data break
        elseif err == 'timeout' then
            if partial and #partial > 0 then chunks[#chunks + 1] = partial end
            if os.clock() > deadline then break end
            coroutine.sleep(0.02)
        elseif err == 'closed' then
            if partial and #partial > 0 then chunks[#chunks + 1] = partial end
            break
        else break end
    end
    sock:close()

    local resp = table.concat(chunks)
    if not resp:match('^HTTP/%d%.%d 200') then return nil end
    return (resp:match('\r\n\r\n(.*)$'))
end
