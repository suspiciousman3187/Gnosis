
function parse_damage_from_export(combat_data, mob_name)
    if type(combat_data) ~= 'table' or type(combat_data[mob_name]) ~= 'table' then return nil end
    local mob_data = combat_data[mob_name]

    local group_total = 0
    for _, d in pairs(mob_data) do
        if type(d) == 'table' then
            group_total = group_total + (d.total_damage or 0)
        end
    end
    if group_total == 0 then return nil end

    local entries = arr{}
    for player, d in pairs(mob_data) do
        if type(d) == 'table' then
            local dmg = d.total_damage or 0
            if dmg > 0 then
                local is_sc = player:match('^SC%-') ~= nil
                local entry = {
                    name         = player,
                    damage       = dmg,
                    percent      = tonumber(('%.1f'):format(dmg / group_total * 100)),
                    isSkillchain = is_sc,
                }
                if is_sc then entry.skillchainOwner = player:match('^SC%-(.+)') or '' end
                table.insert(entries, entry)
            end
        end
    end
    table.sort(entries, function(a, b) return a.damage > b.damage end)
    return #entries > 0 and entries or nil
end

function parse_stats_from_export(combat_data, mob_name)
    local empty = {
        accuracy=arr{}, critRate=arr{}, meleeAverage=arr{},
        meleeCritAverage=arr{}, wsAverages=arr{}, wsAccuracy=arr{},
    }
    if type(combat_data) ~= 'table' or type(combat_data[mob_name]) ~= 'table' then return empty end
    local mob_data = combat_data[mob_name]

    local accuracy, critRate, meleeAverage, meleeCritAverage, wsAverages, wsAccuracy =
        arr{}, arr{}, arr{}, arr{}, arr{}, arr{}

    for player, d in pairs(mob_data) do
        if type(d) == 'table' and not player:match('^SC%-') then
            local m      = type(d.melee) == 'table' and d.melee or {}
            local m_hits  = (type(m.melee) == 'table' and m.melee.tally)  or 0
            local m_dmg   = (type(m.melee) == 'table' and m.melee.damage) or 0
            local m_crits = (type(m.crit)  == 'table' and m.crit.tally)   or 0
            local c_dmg   = (type(m.crit)  == 'table' and m.crit.damage)  or 0
            local m_misses= (type(m.miss)  == 'table' and m.miss.tally)   or 0

            local total_swings = m_hits + m_crits + m_misses
            if total_swings > 0 then
                local hit_rate = (m_hits + m_crits) / total_swings * 100
                table.insert(accuracy, {name=player, pct=tonumber(('%.2f'):format(hit_rate)), count=total_swings})
            end

            local landed = m_hits + m_crits
            if landed > 0 then
                table.insert(critRate, {name=player, pct=tonumber(('%.2f'):format(m_crits / landed * 100)), count=landed})
            end
            if m_hits  > 0 then table.insert(meleeAverage,     {name=player, avg=math.floor(m_dmg / m_hits),  count=m_hits})  end
            if m_crits > 0 then table.insert(meleeCritAverage, {name=player, avg=math.floor(c_dmg / m_crits), count=m_crits}) end

            local cat      = type(d.category) == 'table' and d.category or {}
            local ws_data  = type(cat.ws)      == 'table' and cat.ws      or {}
            local wm_data  = type(cat.ws_miss) == 'table' and cat.ws_miss or {}
            local ws_hits, ws_dmg, ws_miss = 0, 0, 0
            for _, v in pairs(ws_data) do
                if type(v) == 'table' then ws_hits = ws_hits + (v.tally or 0); ws_dmg = ws_dmg + (v.damage or 0) end
            end
            for _, v in pairs(wm_data) do
                if type(v) == 'table' then ws_miss = ws_miss + (v.tally or 0) end
            end
            local total_ws = ws_hits + ws_miss
            if total_ws > 0 then
                table.insert(wsAccuracy, {name=player, pct=tonumber(('%.2f'):format(ws_hits / total_ws * 100)), count=total_ws})
            end
            if ws_hits > 0 then
                table.insert(wsAverages, {name=player, wsAvg=math.floor(ws_dmg / ws_hits), count=ws_hits})
            end
        end
    end

    table.sort(accuracy,         function(a, b) return a.pct   > b.pct   end)
    table.sort(critRate,         function(a, b) return a.pct   > b.pct   end)
    table.sort(meleeAverage,     function(a, b) return a.avg   > b.avg   end)
    table.sort(meleeCritAverage, function(a, b) return a.avg   > b.avg   end)
    table.sort(wsAverages,       function(a, b) return a.wsAvg > b.wsAvg end)
    table.sort(wsAccuracy,       function(a, b) return a.pct   > b.pct   end)

    return {
        accuracy=accuracy, critRate=critRate,
        meleeAverage=meleeAverage, meleeCritAverage=meleeCritAverage,
        wsAverages=wsAverages, wsAccuracy=wsAccuracy,
    }
end
