_g_crashlog = _g_crashlog or { on = false, f = nil, depth = 0 }
local g = _g_crashlog
local CRASHLOG_PATH = windower.addon_path .. 'data/crashlog.txt'

function ff_crashlog_is_on() return g.on end

function ff_crashlog_on()
    if g.on then return end
    local f = io.open(CRASHLOG_PATH, 'w')
    if not f then return end
    pcall(function() f:setvbuf('no') end)
    f:write(string.format('=== crashlog opened %s ===\n', os.date('%Y-%m-%d %H:%M:%S')))
    f:flush()
    g.f = f
    g.on = true
    g.depth = 0
end

function ff_crashlog_off()
    if g.f then
        pcall(function() g.f:write(string.format('=== crashlog closed %s ===\n', os.date('%Y-%m-%d %H:%M:%S'))); g.f:close() end)
        g.f = nil
    end
    g.on = false
    g.depth = 0
end

function ff_crashlog_in(name, detail)
    if not g.on or not g.f then return end
    local pad = string.rep('  ', g.depth)
    g.depth = g.depth + 1
    pcall(function()
        g.f:write(string.format('%.3f %sIN  %s%s\n', os.clock(), pad, name, detail and (' ' .. detail) or ''))
        g.f:flush()
    end)
end

function ff_crashlog_out(name, detail)
    if not g.on or not g.f then return end
    g.depth = math.max(0, g.depth - 1)
    local pad = string.rep('  ', g.depth)
    pcall(function()
        g.f:write(string.format('%.3f %sOUT %s%s\n', os.clock(), pad, name, detail and (' ' .. detail) or ''))
        g.f:flush()
    end)
end

function ff_crashlog_note(tag, detail)
    if not g.on or not g.f then return end
    local pad = string.rep('  ', g.depth)
    pcall(function()
        g.f:write(string.format('%.3f %s.   %s%s\n', os.clock(), pad, tag, detail and (' ' .. detail) or ''))
        g.f:flush()
    end)
end
