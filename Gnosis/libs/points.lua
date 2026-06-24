local registry = { xp = {}, cp = {}, ep = {}, lp = {} }
local totals   = { xp = 0,  cp = 0,  ep = 0,  lp = 0  }

local function add(metric, amount)
    if not amount or amount <= 0 then return end
    local t = os.clock()
    local reg = registry[metric]
    reg[t] = (reg[t] or 0) + amount
    totals[metric] = totals[metric] + amount
end

local function rate(metric)
    local t = os.clock()
    local sum, oldest = 0, 29
    local reg = registry[metric]
    for ts, val in pairs(reg) do
        if t - ts > 600 then
            reg[ts] = nil
        else
            sum = sum + val
            if t - ts > oldest then oldest = t - ts end
        end
    end
    if oldest == 29 then return 0 end
    return math.floor((sum / oldest) * 3600)
end

windower.register_event('incoming chunk', ff_perf_event('incoming_chunk', function(id, org, modi, is_injected, is_blocked)

    if is_injected or is_blocked then return end
    if id ~= 0x029 and id ~= 0x02D then return end
    local ok, p = pcall(packets.parse, 'incoming', org)
    if not ok or not p then return end
    local msg = p['Message']
    local val = p['Param 1']
    if not msg or not val then return end
    if msg == 8 or msg == 105 then add('xp', val)
    elseif msg == 718 or msg == 735 then add('cp', val)
    elseif msg == 809 or msg == 810 then add('ep', val)
    elseif msg == 371 or msg == 372 then add('lp', val) end
end, function(id) return string.format('points 0x%X', id) end))

function ff_points_rates()
    return {
        xp = rate('xp'),
        cp = rate('cp'),
        ep = rate('ep'),
        lp = rate('lp'),
    }
end

function ff_points_totals()
    return { xp = totals.xp, cp = totals.cp, ep = totals.ep, lp = totals.lp }
end

function ff_points_reset()
    registry.xp, registry.cp, registry.ep, registry.lp = {}, {}, {}, {}
    totals.xp, totals.cp, totals.ep, totals.lp = 0, 0, 0, 0
end
