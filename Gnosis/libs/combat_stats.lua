
local DEFENSE_MSG = {
    [1]='hit', [67]='crit_taken', [106]='intimidate',
    [15]='evade', [282]='evade', [373]='absorb',
    [535]='retaliate', [536]='retaliate',
}
local OFFENSE_MSG = {
    [1]='melee', [67]='crit', [15]='miss', [63]='miss',
    [352]='ranged', [576]='ranged', [577]='ranged', [353]='r_crit', [354]='r_miss',
    [185]='ws', [187]='ws', [197]='ws', [188]='ws_miss',
    [2]='spell', [227]='spell',
    [252]='mb', [265]='mb', [274]='mb', [379]='mb', [747]='mb', [748]='mb',
    [82]='enfeeb', [236]='enfeeb', [754]='enfeeb', [755]='enfeeb',
    [85]='enfeeb_miss', [284]='enfeeb_miss', [653]='enfeeb_miss', [654]='enfeeb_miss', [655]='enfeeb_miss', [656]='enfeeb_miss',
    [110]='ja', [317]='ja', [522]='ja', [802]='ja',
    [158]='ja_miss', [324]='ja_miss',
    [157]='Barrage', [77]='Sange', [264]='aoe',
}
local SKILLCHAIN_MSG = {}
for _, m in ipairs({288,289,290,291,292,293,294,295,296,297,298,299,300,301,302,385,386,387,388,389,390,391,392,393,394,395,396,397,398,732,767,768,769,770}) do SKILLCHAIN_MSG[m]=true end
local ADD_EFFECT_MSG = { [161]=true, [163]=true, [229]=true }
local ADD_EFFECT_VALID = { [1]=true, [2]=true, [3]=true, [4]=true, [11]=true, [13]=true }

local STAT_TYPE = {}
for _, s in ipairs({'hit','crit_taken','block','evade','parry','intimidate','absorb','shadow','anticipate','nonparry','nonblock','retrate','nonret'}) do STAT_TYPE[s]='defense' end
for _, s in ipairs({'melee','miss','crit'}) do STAT_TYPE[s]='melee' end
for _, s in ipairs({'ranged','r_miss','r_crit'}) do STAT_TYPE[s]='ranged' end
for _, s in ipairs({'ws','ja','spell','mb','enfeeb','ws_miss','ja_miss','enfeeb_miss'}) do STAT_TYPE[s]='category' end
for _, s in ipairs({'spike','sc','add'}) do STAT_TYPE[s]='other' end
for _, s in ipairs({'1','2','3','4','5','6','7','8'}) do STAT_TYPE[s]='multi' end
local DAMAGE_STAT = {}
for _, s in ipairs({'melee','crit','ranged','r_crit','ws','ja','spell','mb','spike','sc','add'}) do DAMAGE_STAT[s]=true end

local RECORD_TYPE = { me=true, party=true, trust=true, alliance=true, pet=true, fellow=true }

ff_cs_touched = {}

local function cs_register(cs, mob, pc, stat, val, spell_name)
    if not (cs and mob and pc and stat) then return end
    local st = STAT_TYPE[stat]
    if not st then return end
    ff_cs_touched[mob] = os.time()
    cs[mob] = cs[mob] or {}
    local p = cs[mob][pc]
    if not p then p = {}; cs[mob][pc] = p end
    p[st] = p[st] or {}
    local leaf
    if st == 'category' then
        p[st][stat] = p[st][stat] or {}
        local sn = spell_name or 'unknown'
        leaf = p[st][stat][sn]
        if not leaf then leaf = { tally = 0 }; p[st][stat][sn] = leaf end
    else
        leaf = p[st][stat]
        if not leaf then leaf = { tally = 0 }; p[st][stat] = leaf end
    end
    leaf.tally = (leaf.tally or 0) + 1
    if val then
        leaf.damage = (leaf.damage or 0) + val
        if val > (leaf.max or 0) then leaf.max = val end
        if DAMAGE_STAT[stat] then p.total_damage = (p.total_damage or 0) + val end
    end
end

local function spell_label(spell_type, spell_id)
    local nm
    if type(spell_id) == 'number' then
        if spell_type == 'ws' and res.weapon_skills and res.weapon_skills[spell_id] then nm = ff_loc_name(res.weapon_skills[spell_id], nil)
        elseif spell_type == 'ja' and res.job_abilities and res.job_abilities[spell_id] then nm = ff_loc_name(res.job_abilities[spell_id], nil)
        elseif spell_type == 'spell' and res.spells and res.spells[spell_id] then nm = ff_loc_name(res.spells[spell_id], nil) end
    elseif type(spell_id) == 'string' then
        nm = spell_id
    end
    nm = nm or 'unknown'
    return (nm:gsub(' ', '_'):gsub("'", ''):gsub(':', ''))
end

local function classify(id)
    local mob = windower.ffxi.get_mob_by_id(id)
    if not mob then return nil end
    if ff_entity_class_observe then ff_entity_class_observe(id, mob) end
    local cls = ff_entity_class_get_cached and ff_entity_class_get_cached(id) or nil
    local typ, owner_name
    local pt = windower.ffxi.get_party()
    if pt then
        for k, v in pairs(pt) do
            if type(v) == 'table' and v.mob and v.mob.id == mob.id then
                if k == 'p0' then typ = 'me'
                elseif k:sub(1, 1) == 'p' then
                    typ = (cls == FF_CLASS_TRUST) and 'trust' or (cls == FF_CLASS_PC) and 'party' or (mob.is_npc and 'trust' or 'party')
                else typ = 'alliance' end
                break
            end
        end
    end
    if not typ then
        if cls == FF_CLASS_MOB then
            typ = 'mob'
        elseif cls == FF_CLASS_PET then
            typ = 'pet'
            if pt then
                for _, v in pairs(pt) do
                    if type(v) == 'table' and v.mob and v.mob.pet_index and v.mob.pet_index == mob.index then
                        owner_name = (resolve_member_name and resolve_member_name(v.mob.id, v.name)) or v.name; break
                    end
                end
            end
        elseif cls == FF_CLASS_PC then
            typ = 'other'
        elseif cls == FF_CLASS_TRUST or cls == FF_CLASS_NPC then
            typ = 'other'
        elseif mob.is_npc then
            if (mob.id % 4096) > 2047 and pt then
                for _, v in pairs(pt) do
                    if type(v) == 'table' and v.mob then
                        if v.mob.pet_index and v.mob.pet_index == mob.index then
                            typ = 'pet'; owner_name = (resolve_member_name and resolve_member_name(v.mob.id, v.name)) or v.name; break
                        elseif v.mob.fellow_index and v.mob.fellow_index == mob.index then
                            typ = 'fellow'; owner_name = (resolve_member_name and resolve_member_name(v.mob.id, v.name)) or v.name; break
                        end
                    end
                end
            end
            if not typ then
                typ = (mob.spawn_type == 16) and 'mob' or 'other'
            end
        else
            typ = 'other'
        end
    end
    local name
    if typ == 'mob' or typ == 'other' then
        name = mob.name
    else
        name = (resolve_member_name and resolve_member_name(id, mob.name)) or mob.name
    end
    return { name = name, type = typ, owner_name = owner_name, status = mob.status }
end

local function mob_key(name) return name and (name:gsub(' ', '_'):gsub("'", '')) or name end

-- Accumulate one Windower action packet into the per-encounter combat-stats
-- table `cs`. Mirrors parse/action_parse.lua's offense/defense bucketing.
function ff_combat_accumulate(cs, act)
    if not (cs and act and act.actor_id and act.targets) then return end
    local actor = classify(act.actor_id)
    if not actor then return end
    local aoe_type = 'ws'

    for _, targ in pairs(act.targets) do
        if type(targ) == 'table' and targ.id and targ.actions then
            local target = classify(targ.id)
            if target then
                local mh, oh, o_mob, o_pc = 0, 0, nil, nil
                for _, m in pairs(targ.actions) do
                    local msg = m.message
                    if msg and msg ~= 0 then
                        -- Defense: a mob acted on a recorded PC (pets/fellows excluded here).
                        if actor.type == 'mob' and RECORD_TYPE[target.type] and target.type ~= 'pet' and target.type ~= 'fellow' then
                            local mk = mob_key(actor.name)
                            local pk = target.name
                            local action = DEFENSE_MSG[msg]
                            local engaged = (target.status == 1)
                            if m.reaction == 12 and act.category == 1 then
                                cs_register(cs, mk, pk, 'block', m.param)
                                if engaged then cs_register(cs, mk, pk, 'nonparry') end
                            elseif m.reaction == 11 and act.category == 1 then
                                cs_register(cs, mk, pk, 'parry')
                            elseif action == 'hit' or action == 'crit_taken' then
                                cs_register(cs, mk, pk, action, m.param)
                                if engaged then cs_register(cs, mk, pk, 'nonparry') end
                                if act.category == 1 then cs_register(cs, mk, pk, 'nonblock', m.param) end
                            elseif action == 'intimidate' or action == 'evade' then
                                cs_register(cs, mk, pk, action)
                            end
                            if action == 'absorb' then cs_register(cs, mk, pk, 'absorb', m.param) end
                            if m.spike_effect_message and m.spike_effect_message ~= 0 then
                                if m.spike_effect_param then cs_register(cs, mk, pk, 'spike', m.spike_effect_param) end
                                if DEFENSE_MSG[m.spike_effect_message] == 'retaliate' then cs_register(cs, mk, pk, 'retrate') end
                            end

                        -- Offense: a recorded PC/pet/fellow acted on a mob.
                        elseif target.type == 'mob' and RECORD_TYPE[actor.type] then
                            local mk = mob_key(target.name)
                            local pk = (actor.type == 'pet' or actor.type == 'fellow') and actor.owner_name or actor.name
                            if pk then
                                o_mob, o_pc = mk, pk
                                local action = OFFENSE_MSG[msg]
                                if action == 'melee' or action == 'crit' or action == 'miss' then
                                    cs_register(cs, mk, pk, action, m.param)
                                    if m.animation == 0 then mh = mh + 1 elseif m.animation == 1 then oh = oh + 1 end
                                elseif action == 'ranged' or action == 'r_crit' or action == 'r_miss' then
                                    cs_register(cs, mk, pk, action, m.param)
                                elseif action == 'ws' or action == 'ws_miss' then
                                    cs_register(cs, mk, pk, action, m.param, spell_label('ws', act.param)); aoe_type = 'ws'
                                elseif action == 'spell' or action == 'mb' then
                                    cs_register(cs, mk, pk, action, m.param, spell_label('spell', act.param)); aoe_type = 'spell'
                                elseif action == 'enfeeb' or action == 'enfeeb_miss' then
                                    cs_register(cs, mk, pk, action, nil, spell_label('spell', act.param))
                                elseif action == 'ja' or action == 'ja_miss' then
                                    cs_register(cs, mk, pk, action, m.param, spell_label('ja', act.param)); aoe_type = 'ja'
                                elseif action == 'Barrage' or action == 'Sange' then
                                    cs_register(cs, mk, pk, 'ja', m.param, (action:gsub(' ', '_')))
                                elseif action == 'aoe' then
                                    cs_register(cs, mk, pk, aoe_type, m.param, spell_label(aoe_type, act.param))
                                end
                                if m.add_effect_message and m.add_effect_message ~= 0 and ADD_EFFECT_VALID[act.category] then
                                    if SKILLCHAIN_MSG[m.add_effect_message] then
                                        cs_register(cs, mk, 'SC-' .. pk, 'sc', m.add_effect_param)
                                    elseif ADD_EFFECT_MSG[m.add_effect_message] and (m.add_effect_param or 0) > 0 then
                                        cs_register(cs, mk, pk, 'add', m.add_effect_param)
                                    end
                                end
                            end
                        end
                    end
                end
                if o_mob and o_pc then
                    if mh > 0 then cs_register(cs, o_mob, o_pc, tostring(mh)) end
                    if oh > 0 then cs_register(cs, o_mob, o_pc, tostring(oh)) end
                end
            end
        end
    end
end

function ff_dmg_by_id_accumulate(dmg_by_id, dmg_time_by_id, act)
    if not (dmg_by_id and act and act.actor_id and act.targets) then return end
    local actor = classify(act.actor_id)
    if not actor or actor.type == 'mob' then return end
    local pk = (actor.type == 'pet' or actor.type == 'fellow') and actor.owner_name or actor.name
    if not pk then return end

    local now = nil  -- lazy: only call os.time() once we know we'll record something

    for _, targ in pairs(act.targets) do
        if type(targ) == 'table' and targ.id and targ.actions then
            local target = classify(targ.id)
            if target and target.type == 'mob' then
                local t = dmg_by_id[targ.id]
                local first_hit = false
                for _, m in pairs(targ.actions) do
                    if m.message and m.message ~= 0 then
                        local dmg = m.param or 0
                        local action = OFFENSE_MSG[m.message]
                        local is_damage = (action == 'melee' or action == 'crit'
                            or action == 'ranged' or action == 'r_crit'
                            or action == 'ws' or action == 'spell' or action == 'mb'
                            or action == 'ja' or action == 'aoe' or action == 'Barrage' or action == 'Sange')
                        if is_damage and dmg > 0 then
                            if not t then t = {}; dmg_by_id[targ.id] = t; first_hit = true end
                            t[pk] = (t[pk] or 0) + dmg
                        end
                        if m.add_effect_message and SKILLCHAIN_MSG[m.add_effect_message] and (m.add_effect_param or 0) > 0 then
                            if not t then t = {}; dmg_by_id[targ.id] = t; first_hit = true end
                            local sck = 'SC-' .. pk
                            t[sck] = (t[sck] or 0) + m.add_effect_param
                        end
                    end
                end
                if first_hit and dmg_time_by_id and not dmg_time_by_id[targ.id] then
                    now = now or os.time()
                    dmg_time_by_id[targ.id] = { since = now }
                end
            end
        end
    end
end
