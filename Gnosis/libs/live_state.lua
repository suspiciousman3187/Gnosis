
local M = {}
local LIVE = nil  -- single-session: only one encounter feeds the overlay at a time

local function noop_zero() return 0 end
local function noop_jobs() return {} end
local function count_keys(t)
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n
end

function M.open(ctx)
    ctx = ctx or {}
    LIVE = {
        start_os         = ctx.start_os or os.time(),
        source           = ctx.source,
        zone_name        = ctx.zone_name,
        -- Dynamic getters - the caller's encounter table updates after we open,
        -- so we resolve these at emit time rather than snapshotting at open.
        get_deaths       = ctx.get_deaths or noop_zero,
        get_party_jobs   = ctx.get_party_jobs or noop_jobs,
        -- Per-instance live tables (the actual point of this module):
        enemy_ids        = {},
        dmg_by_id_player = {},
        dmg_time_by_id   = {},
        id_to_mob_name   = {},
        last_boss_hpp_id = {},
        killed_list      = {},
        next_kill_seq    = 1,
        killed_recently  = {},
        live_damage      = {},
        live_stats       = {},
        my_target_id     = nil,
    }
    return LIVE
end

function M.close()
    LIVE = nil
end

function M.is_open()
    return LIVE ~= nil
end

function M.get()
    return LIVE
end

function M.mark_engaged(eid)
    if not LIVE or not eid or eid == 0 then return end
    LIVE.enemy_ids[eid] = true
end

function M.is_engaged(eid)
    return LIVE ~= nil and eid ~= nil and LIVE.enemy_ids[eid] == true
end

function M.accumulate_action(act, party_test_fn)
    if not LIVE or not act or not act.targets then return end
    if ff_dmg_by_id_accumulate then
        ff_dmg_by_id_accumulate(LIVE.dmg_by_id_player, LIVE.dmg_time_by_id, act)
    end
    party_test_fn = party_test_fn or function() return false end
    local actor_mob = windower.ffxi.get_mob_by_id(act.actor_id)
    local actor_name = actor_mob and actor_mob.name
    local actor_party = party_test_fn(actor_name)
    for _, tgt in ipairs(act.targets) do
        if tgt and tgt.id then
            local tgt_mob = windower.ffxi.get_mob_by_id(tgt.id)
            if tgt_mob and tgt_mob.name then
                local tgt_party = party_test_fn(tgt_mob.name)
                local tgt_enemy = ff_entity_is_mob(tgt_mob) and not tgt_party
                if actor_party and tgt_enemy then
                    LIVE.enemy_ids[tgt.id] = true
                    if actor_name then
                        local dmg = 0
                        local ls = LIVE.live_stats[actor_name]
                        for _, sa in ipairs(tgt.actions or {}) do
                            dmg = dmg + (sa.param or 0)
                            -- Melee accuracy/crit tally (msg 1 hit, 67 crit, 15/63 miss).
                            local m = sa.message
                            if m == 67 or m == 1 or m == 15 or m == 63 then
                                if not ls then ls = { landed = 0, crit = 0, miss = 0 }; LIVE.live_stats[actor_name] = ls end
                                if m == 67 then ls.landed = ls.landed + 1; ls.crit = ls.crit + 1
                                elseif m == 1 then ls.landed = ls.landed + 1
                                else ls.miss = ls.miss + 1 end
                            end
                        end
                        if dmg > 0 then LIVE.live_damage[actor_name] = (LIVE.live_damage[actor_name] or 0) + dmg end
                    end
                end
                -- Boss acted on a party member - flag the boss too so 0x000E
                -- samples it (covers fights where we don't engage first).
                if actor_mob and ff_entity_is_mob(actor_mob) and not actor_party and tgt_party then
                    LIVE.enemy_ids[act.actor_id] = true
                end
            end
        end
    end
end

local KILLED_LIST_CAP = 50
local KILLED_RECENTLY_TTL_SEC = 30

local function _purge_killed_recently(now)
    for eid, kr in pairs(LIVE.killed_recently) do
        if (now - kr.time) >= KILLED_RECENTLY_TTL_SEC then
            LIVE.killed_recently[eid] = nil
        end
    end
end

local function _trim_killed_list()
    local n = #LIVE.killed_list
    if n <= KILLED_LIST_CAP then return end
    local drop = n - KILLED_LIST_CAP
    for i = 1, KILLED_LIST_CAP do LIVE.killed_list[i] = LIVE.killed_list[i + drop] end
    for i = KILLED_LIST_CAP + 1, n do LIVE.killed_list[i] = nil end
end

function M.hp_update(eid, mob_name, hpp)
    if not LIVE or not eid or eid == 0 then return nil end
    if not LIVE.enemy_ids[eid] then return nil end
    if hpp == nil then return nil end
    if LIVE.last_boss_hpp_id[eid] ~= hpp then
        LIVE.last_boss_hpp_id[eid] = hpp
        LIVE.id_to_mob_name[eid] = mob_name
    end
    if hpp == 0 then
        local now = os.time()
        local kr = LIVE.killed_recently[eid]
        if kr then
            local age = now - kr.time
            if age < KILLED_RECENTLY_TTL_SEC then
                LIVE.dmg_by_id_player[eid] = nil
                LIVE.dmg_time_by_id[eid] = nil
                LIVE.last_boss_hpp_id[eid] = nil
                LIVE.id_to_mob_name[eid] = nil
                LIVE.enemy_ids[eid] = nil
                return nil
            else
                LIVE.killed_recently[eid] = nil
            end
        end
        local tt = LIVE.dmg_time_by_id[eid]
        local kill_entry = nil
        if tt then
            kill_entry = {
                id       = eid,
                kill_seq = LIVE.next_kill_seq,
                name     = mob_name,
                dmg      = LIVE.dmg_by_id_player[eid] or {},
                since    = tt.since,
                ended    = now,
            }
            LIVE.killed_list[#LIVE.killed_list + 1] = kill_entry
            LIVE.next_kill_seq = LIVE.next_kill_seq + 1
            LIVE.killed_recently[eid] = { time = now }
            _trim_killed_list()
        end
        LIVE.dmg_by_id_player[eid] = nil
        LIVE.dmg_time_by_id[eid] = nil
        LIVE.last_boss_hpp_id[eid] = nil
        LIVE.id_to_mob_name[eid] = nil
        LIVE.enemy_ids[eid] = nil
        _purge_killed_recently(now)
        return kill_entry
    end
    return nil
end

function M.set_my_target(id)
    if not LIVE then return end
    LIVE.my_target_id = id
end

function M.emit()
    if not LIVE then
        return { recording = false }
    end
    for eid, cached_hpp in pairs(LIVE.last_boss_hpp_id) do
        if cached_hpp ~= nil and cached_hpp ~= 0 then
            local mob = windower.ffxi.get_mob_by_id(eid)
            if not mob then
                LIVE.last_boss_hpp_id[eid] = nil
                LIVE.dmg_time_by_id[eid] = nil
                LIVE.id_to_mob_name[eid] = nil
            elseif mob.hpp == 0 then
                local kill_entry = M.hp_update(eid, mob.name, 0)
                if kill_entry and ff_ipc_send_kill then ff_ipc_send_kill(kill_entry) end
            end
        end
    end
    local elapsed = math.floor(os.difftime(os.time(), LIVE.start_os))
    local dur = math.max(1, elapsed)
    local party_jobs = LIVE.get_party_jobs() or {}

    local self_name = nil
    do
        local p = windower.ffxi.get_player()
        if p and p.id then
            local m = windower.ffxi.get_mob_by_id(p.id)
            self_name = (m and m.name) or nil
        end
    end
    local rates = ff_points_rates and ff_points_rates() or nil

    local party_damage = 0
    for _, dmg in pairs(LIVE.live_damage) do party_damage = party_damage + dmg end

    local list = {}
    for name, dmg in pairs(LIVE.live_damage) do
        local pj = party_jobs[name]
        local entry = {
            name   = name,
            job    = (pj and pj.main) or json.null,
            damage = dmg,
            dps    = math.floor(dmg / dur),
            pct    = party_damage > 0 and tonumber(('%.1f'):format(dmg / party_damage * 100)) or 0,
        }
        local ls = LIVE.live_stats[name]
        if ls and (ls.landed + ls.miss) > 0 then
            entry.acc = tonumber(('%.0f'):format(ls.landed / (ls.landed + ls.miss) * 100))
            if ls.landed > 0 then entry.crit = tonumber(('%.0f'):format(ls.crit / ls.landed * 100)) end
        end
        if rates and name == self_name then
            if rates.xp > 0 then entry.exphr = rates.xp end
            if rates.cp > 0 then entry.cphr = rates.cp end
            if rates.ep > 0 then entry.ephr = rates.ep end
            if rates.lp > 0 then entry.lphr = rates.lp end
        end
        list[#list + 1] = entry
    end
    table.sort(list, function(a, b) return a.damage > b.damage end)
    local players = {}
    for i = 1, math.min(8, #list) do players[i] = list[i] end
    if rates and self_name and not LIVE.live_damage[self_name] then
        local has_any = rates.xp > 0 or rates.cp > 0 or rates.ep > 0 or rates.lp > 0
        if has_any and #players < 8 then
            local pj = party_jobs[self_name]
            local entry = {
                name   = self_name,
                job    = (pj and pj.main) or json.null,
                damage = 0,
                dps    = 0,
                pct    = 0,
            }
            if rates.xp > 0 then entry.exphr = rates.xp end
            if rates.cp > 0 then entry.cphr = rates.cp end
            if rates.ep > 0 then entry.ephr = rates.ep end
            if rates.lp > 0 then entry.lphr = rates.lp end
            players[#players + 1] = entry
        end
    end

    -- Per-instance LIVE entries + recent kills history.
    local targets = {}
    for eid, hpp in pairs(LIVE.last_boss_hpp_id) do
        local name = LIVE.id_to_mob_name[eid]
        local tt = LIVE.dmg_time_by_id[eid]
        if name and hpp and hpp > 0 and tt then
            targets[#targets + 1] = {
                id    = eid,
                name  = name,
                hpp   = hpp,
                dmg   = LIVE.dmg_by_id_player[eid] or {},
                since = tt.since or json.null,
                ended = json.null,
            }
        end
    end
    table.sort(targets, function(a, b) return a.hpp > b.hpp end)
    local KILLED_EMIT_CAP = 20
    local kl = LIVE.killed_list
    for i = math.max(1, #kl - KILLED_EMIT_CAP + 1), #kl do
        local k = kl[i]
        targets[#targets + 1] = {
            id       = k.id,
            kill_seq = k.kill_seq,
            name     = k.name,
            hpp      = 0,
            dmg      = k.dmg or {},
            since    = k.since or json.null,
            ended    = k.ended or json.null,
        }
    end

    local my_target_id = LIVE.my_target_id
    if my_target_id == nil then
        local p = windower.ffxi.get_player()
        if p and p.target_index and p.target_index > 0 then
            local m = windower.ffxi.get_mob_by_index(p.target_index)
            if m and m.id and ff_entity_is_mob(m) and m.hpp and m.hpp > 0 then
                my_target_id = m.id
            end
        end
    end

    return {
        recording   = true,
        elapsed     = elapsed,
        zone        = LIVE.zone_name or json.null,
        source      = (LIVE.source and LIVE.source ~= 'generic') and LIVE.source or json.null,
        enemies     = count_keys(LIVE.enemy_ids),
        deaths      = LIVE.get_deaths() or 0,
        partyDamage = party_damage,
        partyDps    = math.floor(party_damage / dur),
        players     = (#players > 0) and players or json.null,
        targets     = (#targets > 0) and targets or json.null,
        myTargetId  = my_target_id or json.null,
    }
end

-- Globals (ff_* convention so callers don't need to track requires).
ff_live_state_open          = M.open
ff_live_state_close         = M.close
ff_live_state_is_open       = M.is_open
ff_live_state_get           = M.get
ff_live_state_mark_engaged  = M.mark_engaged
ff_live_state_is_engaged    = M.is_engaged
ff_live_state_accumulate    = M.accumulate_action
ff_live_state_hp_update     = M.hp_update
ff_live_state_set_my_target = M.set_my_target
ff_live_state_emit          = M.emit

return M
