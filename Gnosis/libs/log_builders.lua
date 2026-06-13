
function ff_parse_buff_list_packet(data)
    local out = {}
    if not data or #data < 0xC8 then return out end
    local now = math.floor(os.time())
    -- Vana buff timer epoch: bufftime fn in fields.lua uses 1009810800
    -- (2001-12-31 UTC) + raw/60 seconds.
    local VANA_EPOCH = 1009810800
    for i = 1, 32 do
        -- data:unpack uses 1-based offsets. Buffs[i] at 0x08, Time[i] at 0x48.
        local id = data:unpack('H', 0x08 + 1 + (i - 1) * 2)
        if id and id ~= 0 and id ~= 255 then
            local raw = data:unpack('I', 0x48 + 1 + (i - 1) * 4) or 0
            local remaining = 0
            if raw > 0 then
                local expire = VANA_EPOCH + math.floor(raw / 60)
                remaining = math.max(0, expire - now)
            end
            out[id] = remaining
        end
    end
    return out
end

function ff_log_buff_event(buff_log, dedupe_state, run_start_time, opts)
    if not run_start_time or not opts or not opts.buff_id or opts.buff_id == 0 then return false end
    local key = string.format('%s_%d_%s', tostring(opts.target_id or 0), opts.buff_id, tostring(opts.kind))
    local now = os.time()
    if (dedupe_state[key] or 0) + 1 >= now then return false end
    dedupe_state[key] = now
    local buff = res.buffs and res.buffs[opts.buff_id]
    local buff_name = ff_loc_name(buff, 'Buff #' .. tostring(opts.buff_id))
    local entry = {
        elapsed   = math.floor(os.difftime(now, run_start_time)),
        kind      = opts.kind,
        target    = opts.target_name,
        targetId  = opts.target_id,
        buffId    = opts.buff_id,
        buffName  = buff_name,
        source    = opts.source,
        appliedBy = opts.applied_by,
        appliedBySpell = opts.applied_by_spell,
    }
    if opts.duration ~= nil and opts.duration > 0 then
        entry.duration = opts.duration
    end
    table.insert(buff_log, entry)
    return true
end

function ff_resolve_action_name_type(act, actor_name, party_jobs)
    local aname = 'Unknown'
    local atype =
        (act.category == 1  and 'auto')   or
        (act.category == 2  and 'ranged') or
        (act.category == 3  and 'ws')     or
        (act.category == 4  and 'spell')  or
        (act.category == 8  and 'spell')  or
        (act.category == 6  and 'ja')     or
        (act.category == 13 and 'ja')     or
        (act.category == 14 and 'ja')     or
        (act.category == 15 and 'ja')     or
        'ws'

    if act.category == 1 then
        aname = 'Auto Attack'
    elseif act.category == 2 then
        aname = 'Ranged Attack'
    elseif act.category == 3 then
        local first_target = act.targets and act.targets[1]
        local first_action = first_target and first_target.actions and first_target.actions[1]
        local msg = first_action and first_action.message
        local is_ws_msg = msg == 185 or msg == 187 or msg == 197 or msg == 188
        if is_ws_msg then
            local ws = res.weapon_skills[act.param]
            aname = ff_loc_name(ws, 'WS')
        else
            local ja = res.job_abilities[act.param]
            aname = ff_loc_name(ja, 'JA')
            atype = 'ja'
        end
    elseif act.category == 4 or act.category == 8 then
        local sp = res.spells[act.param]
        aname = ff_loc_name(sp, 'Spell')
        if sp then
            local sk = sp.skill and res.skills and res.skills[sp.skill]
            local sk_en = ff_loc_name_en(sk, '')
            local en_name = ff_loc_name_en(sp, '')
            if sk_en == 'Enfeebling Magic' or en_name:match('^Dia') or en_name:match('^Bio') then
                atype = 'enfeeb'
            end
        end
    elseif act.category == 6 then
        local ja = res.job_abilities[act.param]
        aname = ff_loc_name(ja, 'JA')
    elseif act.category == 11 then
        local ma = res.monster_abilities and res.monster_abilities[act.param]
        aname = ff_loc_name(ma, 'TP Move')
    elseif act.category == 13 then
        local ma = res.monster_abilities and res.monster_abilities[act.param]
        local ja = res.job_abilities and res.job_abilities[act.param]
        aname = (ma and ff_loc_name(ma, nil)) or ff_loc_name(ja, 'Pet Ability')
    elseif act.category == 14 or act.category == 15 then
        local ja = res.job_abilities and res.job_abilities[act.param]
        aname = ff_loc_name(ja, 'Ability')
    end

    return aname, atype
end

function ff_build_target_entry(tgt, tgt_mob, act, capture_swings)
    local result, dmg, hits = 'hit', 0, 0
    local first = tgt.actions and tgt.actions[1]
    local msg, reaction
    local add_msg, add_param, spk_msg, spk_param
    local proc_kind, react_kind
    local crit_flag = false
    local bit_flags = 0
    local swings = capture_swings and {} or nil
    if first then
        msg = first.message
        reaction = first.reaction
        if act.category == 1 then
            result = (msg == 15) and 'miss' or 'hit'
        elseif act.category == 2 then
            result = (msg == 354) and 'miss' or 'hit'
        elseif act.category == 3 then
            result = (msg == 188) and 'miss' or 'hit'
        elseif act.category == 6 then
            result = (msg == 158 or msg == 324) and 'miss' or 'hit'
        elseif act.category == 4 or act.category == 8 then
            if msg == 85 or msg == 284 or msg == 655 or msg == 656 or msg == 75 or msg == 653 or msg == 654 then result = 'resist'
            elseif msg == 252 or msg == 265 or msg == 274 or msg == 379 or msg == 747 or msg == 748 then result = 'burst' end
        end
        local has_crit = false
        for _, a in ipairs(tgt.actions or {}) do
            dmg  = dmg + (a.param or 0)
            hits = hits + 1
            if swings then
                swings[#swings + 1] = { m = a.message, d = a.param or 0, r = a.reaction, am = a.add_effect_message, ap = a.add_effect_param }
            end
            if a.reaction and (a.reaction % 64) >= 32 then has_crit = true end
            if a.unknown and a.unknown ~= 0 then
                bit_flags = bit.bor(bit_flags, bit.band(a.unknown, 0x1F))
            end
            if a.add_effect_message and a.add_effect_message ~= 0 then
                if not add_msg then
                    add_msg, add_param = a.add_effect_message, a.add_effect_param
                    if a.add_effect_animation and a.add_effect_animation ~= 0 then
                        proc_kind = a.add_effect_animation
                    end
                end
            end
            if not spk_msg and a.spike_effect_message and a.spike_effect_message ~= 0 then
                spk_msg, spk_param = a.spike_effect_message, a.spike_effect_param
                if a.spike_effect_animation and a.spike_effect_animation ~= 0 then
                    react_kind = a.spike_effect_animation
                end
            end
        end
        crit_flag = has_crit
    end
    local tentry = {
        id       = tgt.id,
        mob      = tgt_mob.name,
        damage   = dmg,
        result   = result,
        hits     = hits,
        message  = msg,
        reaction = reaction,
    }
    if swings     then tentry.swings      = swings end
    if add_msg    then tentry.addEffect   = { message = add_msg, param = add_param } end
    if spk_msg    then tentry.spikeEffect = { message = spk_msg, param = spk_param } end
    if proc_kind  then tentry.procKind    = proc_kind end
    if react_kind then tentry.reactKind   = react_kind end
    if crit_flag  then tentry.crit        = true end
    if bit_flags ~= 0 then tentry.bitFlags = bit_flags end
    return tentry, add_msg, add_param
end

local function build_party_pet_map(party_jobs)
    local pets = {}
    local pt = windower.ffxi.get_party()
    if not pt then return pets end
    for _, v in pairs(pt) do
        if type(v) == 'table' and v.mob and v.mob.pet_index and v.mob.pet_index ~= 0 then
            local pet = windower.ffxi.get_mob_by_index(v.mob.pet_index)
            if pet and pet.id and pet.id ~= 0 then
                local owner = (resolve_member_name and resolve_member_name(v.mob.id, v.name)) or v.name
                if owner then pets[pet.id] = owner end
            end
        end
    end
    return pets
end

function ff_resolve_role(mob, party_jobs, pet_owner_name, is_boss)
    if is_boss then return 'boss' end
    if pet_owner_name then return 'pet' end
    if type(mob) ~= 'table' then return 'unknown' end
    if mob.id and ff_entity_class_observe then ff_entity_class_observe(mob.id, mob) end
    local cls = (mob.id and ff_entity_class_get_cached) and ff_entity_class_get_cached(mob.id) or nil
    if cls == FF_CLASS_MOB   then return 'mob'    end
    if cls == FF_CLASS_TRUST then return 'trust'  end
    if cls == FF_CLASS_PET   then return 'pet'    end
    if cls == FF_CLASS_PC then
        if party_jobs and mob.name and party_jobs[mob.name] then return 'pc' end
        return 'outsider'
    end
    if mob.is_npc == true then
        if mob.spawn_type == FF_SPAWN_TYPE_MOB then return 'mob' end
        return 'trust'
    end
    if party_jobs and mob.name and party_jobs[mob.name] then return 'pc' end
    return 'outsider'
end

local FF_PENDING_ACTIONS = {}
local FF_PENDING_TTL_SEC = 30
local FF_START_CATEGORIES = { [7] = true, [8] = true, [9] = true, [12] = true }
local FF_FINISH_TO_START_CAT = { [3] = 7, [4] = 8, [5] = 9, [2] = 12 }

local function ff_pending_actions_prune(now)
    for k, v in pairs(FF_PENDING_ACTIONS) do
        if (now - v.t0) > FF_PENDING_TTL_SEC then
            FF_PENDING_ACTIONS[k] = nil
        end
    end
end

function ff_pending_action_start(act)
    if not act or not act.actor_id or not FF_START_CATEGORIES[act.category] then return end
    if act.param and act.param > 10000 then return end
    local now = os.clock()
    ff_pending_actions_prune(now)
    FF_PENDING_ACTIONS[act.actor_id] = { t0 = now, category = act.category, param = act.param }
end

function ff_pending_action_finish(act)
    if not act or not act.actor_id then return nil end
    local expected_start = FF_FINISH_TO_START_CAT[act.category]
    if not expected_start then return nil end
    local p = FF_PENDING_ACTIONS[act.actor_id]
    if not p or p.category ~= expected_start then return nil end
    FF_PENDING_ACTIONS[act.actor_id] = nil
    return math.floor((os.clock() - p.t0) * 1000)
end

function ff_pending_action_clear(actor_id)
    if actor_id then FF_PENDING_ACTIONS[actor_id] = nil end
end

function ff_log_action_event(action_log, skillchain_log, run_start_time, act, opts)
    if not run_start_time or not act or not act.actor_id then return false end
    local actor_mob = windower.ffxi.get_mob_by_id(act.actor_id)
    if not actor_mob then return false end
    opts = opts or {}
    local party_jobs       = opts.party_jobs or {}
    local is_actor_boss_fn = opts.is_actor_boss or function() return false end
    local include_target_fn = opts.include_target
    local capture_swings   = opts.capture_swings
    local relabel_outsider = opts.relabel_outsider

    if opts.on_actor_reconcile and opts.party_id_to_name and opts.party_id_to_name[act.actor_id] then
        opts.on_actor_reconcile(act.actor_id, actor_mob.name)
    end

    local pname = actor_mob.name
    local actor_is_boss = is_actor_boss_fn(pname) and true or false
    local aname, atype = ff_resolve_action_name_type(act, pname, party_jobs)

    local party_pets = build_party_pet_map(party_jobs)
    local actor_pet_of = party_pets[act.actor_id]
    local pet_ids_out = opts.pet_ids
    local pet_names_out = opts.pet_names
    if pet_ids_out then
        for pid, owner in pairs(party_pets) do
            pet_ids_out[pid] = owner
            if pet_names_out then
                local pmob = windower.ffxi.get_mob_by_id(pid)
                if pmob and pmob.name and pmob.name ~= '' then pet_names_out[pid] = pmob.name end
            end
        end
    end

    local elapsed = math.floor(os.difftime(os.time(), run_start_time))
    local targets_arr = {}
    local has_party_target = false

    local has_party_target_pre = false
    for _, tgt in ipairs(act.targets or {}) do
        if tgt and tgt.id then
            if party_pets[tgt.id] then
                has_party_target_pre = true; break
            end
            local m = windower.ffxi.get_mob_by_id(tgt.id)
            if m and party_jobs[m.name] then has_party_target_pre = true; break end
        end
    end

    for _, tgt in ipairs(act.targets or {}) do
        if tgt and tgt.id then
            local tgt_mob = windower.ffxi.get_mob_by_id(tgt.id)
            if tgt_mob then
                local target_pet_of = party_pets[tgt.id]
                local tgt_is_party = party_jobs[tgt_mob.name] ~= nil
                local tgt_is_mob_entity = (tgt_mob.spawn_type == FF_SPAWN_TYPE_MOB)
                local tgt_is_friendly = tgt_is_party or (target_pet_of ~= nil) or (not tgt_is_mob_entity)
                local include
                if include_target_fn then
                    include = include_target_fn(actor_is_boss, tgt_mob, tgt_is_friendly)
                elseif actor_is_boss then
                    include = tgt_is_friendly
                elseif has_party_target_pre then
                    include = tgt_is_friendly
                else
                    include = true
                end
                local outsider_label = nil
                if not include and relabel_outsider and not tgt_is_friendly then
                    outsider_label = relabel_outsider(tgt.id, tgt_mob)
                    if outsider_label then include = true end
                end
                if include then
                    local tentry, add_msg, add_param = ff_build_target_entry(tgt, tgt_mob, act, capture_swings)
                    if outsider_label then tentry.mob = outsider_label end
                    if target_pet_of then tentry.petOf = target_pet_of end
                    tentry.tgtRole = ff_resolve_role(tgt_mob, party_jobs, target_pet_of, is_actor_boss_fn(tgt_mob.name))
                    if tgt_is_friendly then has_party_target = true end
                    table.insert(targets_arr, tentry)

                    -- Skillchain close: the WS/spell's add_effect carries the SC
                    -- message + bonus damage. Attributed to this actor.
                    -- Cure-burst quirk: a Cure on a friendly during an open SC
                    -- window emits an add_effect with a skillchain id keyed on
                    -- the friendly target. That entry is bogus (the real damage
                    -- went to the enemy being chained), so drop it.
                    local sc = add_msg and SKILLCHAIN_NAMES and SKILLCHAIN_NAMES[add_msg]
                    if sc and skillchain_log and not tgt_is_friendly then
                        table.insert(skillchain_log, {
                            elapsed = elapsed,
                            closer  = pname,
                            ws      = aname,
                            mob     = outsider_label or tgt_mob.name,
                            sc      = sc,
                            damage  = add_param or 0,
                        })
                    end
                end
            end
        end
    end

    if #targets_arr > 0 then
        local actor_is_party = party_jobs[pname] ~= nil
        local actor_role = ff_resolve_role(actor_mob, party_jobs, actor_pet_of, actor_is_boss)
        local from
        if actor_is_boss then
            from = 'boss'
        elseif (not actor_is_party) and (not actor_pet_of) and has_party_target then
            from = 'enemy'
        elseif has_party_target then
            from = 'buff'
        else
            from = 'player'
        end
        local cast_time_ms = ff_pending_action_finish(act)
        local entry = {
            elapsed    = elapsed,
            playerId   = act.actor_id,
            player     = pname,
            type       = atype,
            name       = aname,
            category   = act.category,
            param      = act.param,
            from       = from,
            actorRole  = actor_role,
            actorPetOf = actor_pet_of,
            targets    = targets_arr,
        }
        if cast_time_ms and cast_time_ms > 0 then entry.castTimeMs = cast_time_ms end
        table.insert(action_log, entry)
        if ff_live_state_mark_engaged then
            if from == 'player' then
                for _, t in ipairs(targets_arr) do
                    if t.id and not t.petOf then ff_live_state_mark_engaged(t.id) end
                end
            elseif from == 'enemy' then
                ff_live_state_mark_engaged(act.actor_id)
            end
        end
        return true
    end
    return false
end

function ff_log_item_use_event(item_use_log, run_start_time, act, opts)
    if not run_start_time or act.category ~= 5 then return false end
    opts = opts or {}
    local actor_mob = windower.ffxi.get_mob_by_id(act.actor_id)
    local pname = actor_mob and actor_mob.name or 'Unknown'
    if not (opts.party_jobs and opts.party_jobs[pname]) then return false end
    local item = res.items and res.items[act.param]
    local iname = ff_loc_name(item, 'Item #' .. tostring(act.param))
    table.insert(item_use_log, {
        elapsed = math.floor(os.difftime(os.time(), run_start_time)),
        player  = pname,
        item    = iname,
        itemId  = act.param,
        area    = opts.area or 'Unknown',
    })
    -- Queue this item's icon for extraction (shared service; works for every
    -- content module, not just the generic tracker).
    if ff_queue_icon then ff_queue_icon(act.param) end
    return true
end

local function resolve_interrupted_action(category, action_id)
    if not action_id or action_id == 0 then return nil, nil end
    if category == 8 then
        local sp = res.spells and res.spells[action_id]
        return ff_loc_name(sp, 'Spell #' .. tostring(action_id)), 'spell'
    elseif category == 7 then
        local ws = res.weapon_skills and res.weapon_skills[action_id]
        return ff_loc_name(ws, 'WS #' .. tostring(action_id)), 'ws'
    elseif category == 9 then
        local item = res.items and res.items[action_id]
        return ff_loc_name(item, 'Item #' .. tostring(action_id)), 'item'
    elseif category == 12 then
        return 'Ranged Attack', 'ranged'
    end
    return nil, nil
end

function ff_log_action_interrupt(action_log, run_start_time, act, opts)
    if not run_start_time or not act or not act.actor_id then return false end
    if not FF_START_CATEGORIES[act.category] then return false end
    if not (act.param and act.param > 10000) then return false end
    opts = opts or {}
    local actor_mob = windower.ffxi.get_mob_by_id(act.actor_id)
    local pname = actor_mob and actor_mob.name
    if not pname then return false end
    if opts.party_jobs and not opts.party_jobs[pname] then return false end

    local t1 = act.targets and act.targets[1]
    local a1 = t1 and t1.actions and t1.actions[1]
    local action_id = a1 and a1.param

    local pending = FF_PENDING_ACTIONS[act.actor_id]
    local cast_time_ms
    if pending and pending.category == act.category then
        cast_time_ms = math.floor((os.clock() - pending.t0) * 1000)
        if not action_id or action_id == 0 then action_id = pending.param end
        FF_PENDING_ACTIONS[act.actor_id] = nil
    end

    local detail, atype = resolve_interrupted_action(act.category, action_id)
    detail = detail or 'Interrupted'

    if action_log then
        local entry = {
            elapsed     = math.floor(os.difftime(os.time(), run_start_time)),
            playerId    = act.actor_id,
            player      = pname,
            type        = atype or 'spell',
            name        = detail,
            category    = act.category,
            param       = action_id,
            phase       = 'interrupt',
            interrupted = true,
            from        = (opts.party_jobs and opts.party_jobs[pname]) and 'player' or nil,
            targets     = {},
        }
        if cast_time_ms and cast_time_ms > 0 then entry.castTimeMs = cast_time_ms end
        table.insert(action_log, entry)
    end

    return true
end

local FF_RAW_BATTLE_DEDUPE_MS = 100
local FF_RAW_BATTLE_PER_MSG_CAP = 500

function ff_raw_battle_state_new()
    return { last = {}, counts = {} }
end

function ff_job_extended_state_new()
    return { last_hash = {}, count = 0 }
end

function ff_effect_state_new()
    return { last = {} }
end

function ff_party_buff_state_new()
    return { last_sets = {} }
end

local function _hex_byte(n)
    local hi = math.floor(n / 16)
    local lo = n - hi * 16
    local h2 = (hi < 10) and string.char(48 + hi) or string.char(87 + hi)
    local l2 = (lo < 10) and string.char(48 + lo) or string.char(87 + lo)
    return h2 .. l2
end

local FF_COR_ROLL_NAMES = {
    [1]="Fighter's Roll",  [2]="Monk's Roll",      [3]="Healer's Roll",     [4]="Wizard's Roll",
    [5]="Warlock's Roll",  [6]="Rogue's Roll",     [7]="Gallant's Roll",    [8]="Chaos Roll",
    [9]="Beast Roll",     [10]="Choral Roll",     [11]="Hunter's Roll",    [12]="Samurai Roll",
    [13]="Ninja Roll",    [14]="Drachen Roll",    [15]="Evoker's Roll",    [16]="Magus's Roll",
    [17]="Corsair's Roll",[18]="Puppet Roll",     [19]="Dancer's Roll",    [20]="Scholar's Roll",
    [21]="Bolter's Roll", [22]="Caster's Roll",   [23]="Courser's Roll",   [24]="Blitzer's Roll",
    [25]="Tactician's Roll", [26]="Allies' Roll", [27]="Miser's Roll",     [28]="Companion's Roll",
    [29]="Avenger's Roll",[30]="Naturalist's Roll", [31]="Runeist's Roll",
}

local FF_PUP_FRAMES = { [0x20]="Harlequin Frame",[0x21]="Valoredge Frame",[0x22]="Sharpshot Frame",[0x23]="Stormwaker Frame" }
local FF_PUP_HEADS  = { [0x1B]="Harlequin Head",[0x1C]="Valoredge Head",[0x1D]="Sharpshot Head",[0x1E]="Stormwaker Head",[0x1F]="Soulsoother Head",[0x20]="Spiritreaver Head" }

local function _decode_job_044(job_id, data, base)
    local decoded
    if job_id == 17 then
        local rolls = {}
        for i = 0, 3 do
            local id = data:byte(base + i + 1) or 0
            if id > 0 and FF_COR_ROLL_NAMES[id] then rolls[#rolls + 1] = FF_COR_ROLL_NAMES[id] end
        end
        if #rolls > 0 then decoded = { rolls = rolls } end
    elseif job_id == 16 then
        local names = {}
        for i = 0, 19 do
            local id = data:unpack('H', base + i * 2 + 1) or 0
            if id > 0 then
                local sp = res and res.spells and res.spells[id]
                local nm = sp and (sp.en or sp.name)
                if nm then names[#names + 1] = nm end
            end
        end
        if #names > 0 then decoded = { spellNames = names } end
    elseif job_id == 18 then
        local frame_id = data:byte(base + 1) or 0
        local head_id  = data:byte(base + 2) or 0
        decoded = {
            frameName = FF_PUP_FRAMES[frame_id],
            headName  = FF_PUP_HEADS[head_id],
        }
    elseif job_id == 20 then
        local bits = data:byte(base + 1) or 0
        if bit.band(bits, 0x01) ~= 0 then decoded = { arts = 'Light Arts' }
        elseif bit.band(bits, 0x02) ~= 0 then decoded = { arts = 'Dark Arts' }
        else decoded = { arts = 'None' } end
    end
    return decoded
end

function ff_log_job_extended(log, state, run_start_time, data)
    if not run_start_time or not data or not log or not state then return false end
    if #data < 0x06 + 156 then return false end
    local job_id    = data:byte(0x04 + 1) or 0
    local is_sub    = (data:byte(0x05 + 1) or 0) ~= 0
    local hash_key = job_id .. ':' .. (is_sub and 1 or 0)
    local buf = {}
    for i = 0, 153 do
        buf[i + 1] = _hex_byte(data:byte(0x06 + i + 1) or 0)
    end
    local hex = table.concat(buf)
    if state.last_hash[hash_key] == hex then return false end
    state.last_hash[hash_key] = hex
    state.count = state.count + 1
    local entry = {
        elapsed  = math.floor(os.difftime(os.time(), run_start_time)),
        jobId    = job_id,
        isSubJob = is_sub,
        rawHex   = hex,
    }
    local decoded = _decode_job_044(job_id, data, 0x06)
    if decoded then entry.decoded = decoded end
    table.insert(log, entry)
    return true
end

function ff_log_effect(log, state, run_start_time, data)
    if not run_start_time or not data or not log or not state then return false end
    if #data < 0x10 then return false end
    local eid = data:unpack('I', 0x04 + 1)
    if not eid or eid == 0 then return false end
    local effect_num = data:unpack('h', 0x0A + 1) or 0
    local etype      = data:byte(0x0C + 1) or 0
    local estatus    = data:byte(0x0D + 1) or 0
    local timer      = data:unpack('H', 0x0E + 1) or 0
    local key = eid .. ':' .. effect_num .. ':' .. etype .. ':' .. estatus
    if state.last[eid] == key then return false end
    state.last[eid] = key
    table.insert(log, {
        elapsed    = math.floor(os.difftime(os.time(), run_start_time)),
        entityId   = eid,
        effectNum  = effect_num,
        type       = etype,
        status     = estatus,
        timer      = timer,
    })
    return true
end

local function _decode_party_member_buffs(data, member_idx)
    local base = 0x04 + member_idx * 48
    local uid = data:unpack('I', base + 1)
    if not uid or uid == 0 then return nil, nil end
    local bits_low  = data:unpack('I', base + 8 + 1) or 0
    local bits_high = data:unpack('I', base + 12 + 1) or 0
    local ids = {}
    for slot = 0, 31 do
        local low = data:byte(base + 16 + slot + 1) or 0
        local bit_byte_idx = math.floor(slot / 4)
        local bit_shift = (slot % 4) * 2
        local source = (bit_byte_idx < 4) and bits_low or bits_high
        local src_byte = math.floor(source / (2 ^ (8 * (bit_byte_idx % 4)))) % 256
        local high_bits = math.floor(src_byte / (2 ^ bit_shift)) % 4
        local full = low + high_bits * 256
        if not (low == 0xFF and high_bits == 0) and full ~= 0 then
            ids[full] = true
        end
    end
    return uid, ids
end

function ff_log_party_buffs(buff_log, dedupe_state, party_state, run_start_time, data, party_jobs, id_to_name)
    if not run_start_time or not data or not buff_log or not party_state then return false end
    if #data < 0xF4 then return false end
    local any = false
    for i = 0, 4 do
        local uid, current = _decode_party_member_buffs(data, i)
        if uid and current then
            local mob = windower.ffxi.get_mob_by_id(uid)
            local name = (mob and mob.name) or (id_to_name and id_to_name[uid]) or nil
            if name and (not party_jobs or party_jobs[name]) then
                local prev = party_state.last_sets[uid] or {}
                for buff_id in pairs(current) do
                    if not prev[buff_id] then
                        ff_log_buff_event(buff_log, dedupe_state, run_start_time, {
                            kind = 'gain', target_name = name, target_id = uid,
                            buff_id = buff_id, source = '0x076',
                        })
                        any = true
                    end
                end
                for buff_id in pairs(prev) do
                    if not current[buff_id] then
                        ff_log_buff_event(buff_log, dedupe_state, run_start_time, {
                            kind = 'wear', target_name = name, target_id = uid,
                            buff_id = buff_id, source = '0x076',
                        })
                        any = true
                    end
                end
                party_state.last_sets[uid] = current
            end
        end
    end
    return any
end

function ff_log_battle_message_raw(battle_msg_raw, raw_state, run_start_time, data)
    if not run_start_time or not data or not battle_msg_raw or not raw_state then return false end
    local msg = data:unpack('H', 0x18 + 1)
    if not msg or msg == 0 then return false end
    local actor = data:unpack('I', 0x04 + 1) or 0
    local target = data:unpack('I', 0x08 + 1) or 0
    local d1 = data:unpack('I', 0x0C + 1) or 0
    local d2 = data:unpack('I', 0x10 + 1) or 0
    local now_ms = math.floor(os.clock() * 1000)
    local key = msg .. ':' .. actor .. ':' .. target .. ':' .. d1
    local last = raw_state.last[key]
    if last and (now_ms - last) < FF_RAW_BATTLE_DEDUPE_MS then return false end
    raw_state.last[key] = now_ms
    local count = (raw_state.counts[msg] or 0) + 1
    raw_state.counts[msg] = count
    if count > FF_RAW_BATTLE_PER_MSG_CAP then return false end
    table.insert(battle_msg_raw, {
        elapsed = math.floor(os.difftime(os.time(), run_start_time)),
        msgId   = msg,
        actorId = actor ~= 0 and actor or nil,
        targetId = target ~= 0 and target or nil,
        data    = d1 ~= 0 and d1 or nil,
        data2   = d2 ~= 0 and d2 or nil,
    })
    return true
end

function ff_log_pet_snapshot(pet_log, run_start_time, state_table, owner, pet)
    if not run_start_time or not owner or owner == '' or not pet or not pet.name or pet.name == '' then
        return false
    end
    local key = pet.name .. ':' .. tostring(pet.hpp)
    if state_table[owner] == key then return false end
    state_table[owner] = key
    table.insert(pet_log, {
        elapsed = math.floor(os.difftime(os.time(), run_start_time)),
        owner   = owner,
        pet     = pet.name,
        hpp     = pet.hpp,
    })
    return true
end

function ff_log_boss_hp_sample(boss_hp_log, elapsed, name, hpp, id)
    table.insert(boss_hp_log, { elapsed = elapsed, name = name, hpp = hpp, id = id })
end

function ff_log_party_hp_sample(party_hp_log, elapsed, player, hpp, playerId)
    table.insert(party_hp_log, { elapsed = elapsed, playerId = playerId, player = player, hpp = hpp })
end

function ff_log_party_tp_sample(party_tp_log, elapsed, player, tp, playerId)
    table.insert(party_tp_log, { elapsed = elapsed, playerId = playerId, player = player, tp = tp })
end

function ff_log_party_mp_sample(party_mp_log, elapsed, player, mpp, playerId)
    table.insert(party_mp_log, { elapsed = elapsed, playerId = playerId, player = player, mpp = mpp })
end

-- ── Position samples ────────────────────────────────────────────────────────
-- self position from 0x0015 + party member positions from get_party() polls.

function ff_log_self_position(position_log, elapsed, x, y, z, dir, area)
    table.insert(position_log, {
        elapsed = elapsed, x = x, y = y, z = z, dir = dir or 0,
        area = area or 'Unknown',
    })
end

function ff_log_party_position(party_position_log, elapsed, player, x, y, z, dir)
    table.insert(party_position_log, {
        elapsed = elapsed, player = player, x = x, y = y, z = z, dir = dir or 0,
    })
end

function ff_damage_report_from_action_log(action_log, mob_name, fight_start_elapsed, fight_end_elapsed)
    if not action_log or not mob_name then return nil end
    local totals = {}
    for _, e in ipairs(action_log) do
        -- Only count player/buff actions (not boss actions on players).
        if e.from ~= 'boss' then
            local in_window =
                (not fight_start_elapsed or e.elapsed >= fight_start_elapsed) and
                (not fight_end_elapsed or e.elapsed <= fight_end_elapsed)
            if in_window and e.targets then
                for _, t in ipairs(e.targets) do
                    if t.mob == mob_name and t.damage and t.damage > 0 then
                        totals[e.player] = (totals[e.player] or 0) + t.damage
                    end
                end
            end
        end
    end
    local group_total = 0
    for _, dmg in pairs(totals) do group_total = group_total + dmg end
    if group_total == 0 then return nil end
    local entries = {}
    for player, dmg in pairs(totals) do
        table.insert(entries, {
            name         = player,
            damage       = dmg,
            percent      = tonumber(string.format('%.1f', dmg / group_total * 100)),
            isSkillchain = false,
        })
    end
    table.sort(entries, function(a, b) return a.damage > b.damage end)
    return entries
end

local KILL_DEDUP_WINDOW_SEC = 12
function ff_log_entity_death(kill_log, dead_ids, run_start, entity_id, area, is_party_member, fallback_name)
    if not run_start or not entity_id or entity_id == 0 then return nil end
    local now = os.time()
    local last = dead_ids[entity_id]
    if last and (now - last) < KILL_DEDUP_WINDOW_SEC then return nil end
    local mob = windower.ffxi.get_mob_by_id(entity_id)
    if mob and ff_entity_class_observe then ff_entity_class_observe(entity_id, mob) end
    local death_cls = ff_entity_class_get_cached and ff_entity_class_get_cached(entity_id) or nil
    if death_cls == FF_CLASS_PC or death_cls == FF_CLASS_TRUST then return nil end
    if mob and mob.is_npc == false then return nil end
    local name = (mob and mob.name and mob.name ~= '' and mob.name) or fallback_name
    if name and is_party_member and is_party_member(name) then return nil end
    dead_ids[entity_id] = now
    local entry = {
        id      = entity_id,
        name    = name or 'Unknown',
        area    = area or 'Unknown',
        elapsed = math.floor(os.difftime(os.time(), run_start)),
    }
    table.insert(kill_log, entry)
    return entry
end

FF_DEATH_MSG = { [6]=true, [20]=true, [97]=true, [113]=true, [406]=true, [605]=true, [646]=true, [756]=true }

function ff_log_party_death(death_log, dead_members, run_start, player_name, area, source, extra)
    if not run_start or not player_name or player_name == '' then return nil end
    if dead_members[player_name] then return nil end
    local elapsed = math.floor(os.difftime(os.time(), run_start))
    for i = #death_log, 1, -1 do
        local e = death_log[i]
        if (elapsed - e.elapsed) > 5 then break end
        if e.player == player_name then return nil end
    end
    dead_members[player_name] = true
    local entry = { player = player_name, area = area or 'Unknown', elapsed = elapsed }
    if source then entry.source = source end
    if type(extra) == 'table' then
        for k, v in pairs(extra) do entry[k] = v end
    end
    table.insert(death_log, entry)
    return entry
end

local GEAR_SLOTS = { 'main','sub','range','ammo','head','neck','left_ear','right_ear','body','hands','left_ring','right_ring','back','waist','legs','feet' }
local STATUS_LABEL = { [0] = 'Idle', [1] = 'Engaged', [33] = 'Resting' }
local STATE_VARIANT_CAP = 6
local _g = { active = false }

local _ext_ok, extdata = pcall(require, 'extdata')

local function _decode_augments(it)
    if not _ext_ok or not extdata or not it or type(it.extdata) ~= 'string' or #it.extdata ~= 24 then return nil end
    local ok, dec = pcall(extdata.decode, it)
    if not ok or type(dec) ~= 'table' or type(dec.augments) ~= 'table' then return nil end
    local rank = (type(dec.rank) == 'number' and dec.rank > 0) and dec.rank or nil
    local out = {}
    for _, a in ipairs(dec.augments) do
        if type(a) == 'string' and a ~= '' and a:lower() ~= 'none' then
            if rank and a:match('^Path:') then a = a .. ' (R' .. tostring(rank) .. ')' end
            out[#out + 1] = a
        end
    end
    return (#out > 0) and out or nil
end

local function _snapshot_gear()
    local items = windower.ffxi.get_items()
    local eq = items and items.equipment
    if not eq then return nil end
    local set, any = {}, false
    for _, slot in ipairs(GEAR_SLOTS) do
        local idx = eq[slot]
        if idx and idx ~= 0 then
            local it = windower.ffxi.get_items(eq[slot .. '_bag'] or 0, idx)
            local id = it and it.id
            if id and id ~= 0 then
                local r = res.items and res.items[id]
                local entry = { id = id, name = ff_loc_name(r, 'Item #' .. tostring(id)) }
                entry.augments = _decode_augments(it)
                set[slot] = entry
                if ff_queue_icon then ff_queue_icon(id) end
                any = true
            end
        end
    end
    return any and set or nil
end
local function _gear_sig(set)
    if not set then return '' end
    local parts = {}
    for _, slot in ipairs(GEAR_SLOTS) do
        local g2 = set[slot]
        parts[#parts + 1] = (g2 and g2.id) or 0
    end
    return table.concat(parts, ',')
end
local function _record_state_set(label, set)
    if not _g.active or not set or not _g.state_sets then return end
    local bucket = _g.state_sets[label]
    if not bucket then bucket = {}; _g.state_sets[label] = bucket end
    local sig = _gear_sig(set)
    for _, v in ipairs(bucket) do
        if v.sig == sig then v.count = v.count + 1; return end
    end
    if #bucket >= STATE_VARIANT_CAP then return end
    bucket[#bucket + 1] = { sig = sig, gear = set, count = 1, elapsed = math.floor(os.difftime(os.time(), _g.start_os)) }
end
local function _state_label_now(base)
    if base == 'Idle' then
        local pet = windower.ffxi.get_mob_by_target and windower.ffxi.get_mob_by_target('pet')
        if pet then return 'Idle (Pet)' end
    end
    return base
end
local function _sample_state(base, gen, tries)
    if not _g.active or _g.state_gen ~= gen then return end
    local set = _snapshot_gear()
    if set then
        local sig = _gear_sig(set)
        if _g.pending_sig == sig then _record_state_set(_state_label_now(base), set); return end
        _g.pending_sig = sig
    end
    if tries < 4 then
        coroutine.schedule(function() _sample_state(base, gen, tries + 1) end, 0.35)
    elseif set then
        _record_state_set(_state_label_now(base), set)
    end
end
local function _arm_state(base)
    if not _g.active then return end
    _g.state_gen = (_g.state_gen or 0) + 1
    local gen = _g.state_gen
    _g.pending_sig = nil
    coroutine.schedule(function() _sample_state(base, gen, 0) end, 0.4)
end
local function _arm_current_state()
    local p = windower.ffxi.get_player()
    local base = p and STATUS_LABEL[p.status]
    if base then _arm_state(base) end
end

local _gear_token = 0
function ff_gear_start(start_os)
    _gear_token = _gear_token + 1
    _g.active = true
    _g.token = _gear_token
    _g.start_os = start_os or os.time()
    _g.gear_log = {}
    _g.state_sets = {}
    _g.cast_precast = nil
    _g.state_gen = 0
    _g.pending_sig = nil
    local tok = _gear_token
    coroutine.schedule(function() if _g.active and _g.token == tok then _arm_current_state() end end, 1.0)
    return _gear_token
end
function ff_gear_stop(token)
    if token and token ~= _g.token then return end
    _g.active = false
end
-- Returns (gearLog, stateSets) ready to drop into a report table (nil when empty).
function ff_gear_result()
    local gear_log = (_g.gear_log and #_g.gear_log > 0) and _g.gear_log or nil
    local state_sets = nil
    if _g.state_sets then
        for label, bucket in pairs(_g.state_sets) do
            local list = {}
            for _, v in ipairs(bucket) do list[#list + 1] = { elapsed = v.elapsed, count = v.count, gear = v.gear } end
            if #list > 0 then state_sets = state_sets or {}; state_sets[label] = list end
        end
    end
    return gear_log, state_sets
end

-- Local-player gear/state capture - independent of each module's own action
-- handler; only acts while a recorder is active (ff_gear_start..ff_gear_stop).
windower.register_event('action', function(act)
    if not _g.active or not act then return end
    local me = windower.ffxi.get_player()
    if not me then return end
    local cat = act.category
    local mine = (act.actor_id == me.id)
    -- precast: incoming "begins casting" (cat 8) for us - fast-cast is on; the
    -- midcast swap it triggers isn't server-confirmed yet. Stash by recency.
    if cat == 8 and mine then
        _g.cast_precast = { gear = _snapshot_gear(), clock = os.clock() }
        return
    end
    if not mine then return end
    if cat == 3 or cat == 4 or cat == 6 then
        -- Use the customized name (matches the action log); never the raw me.name.
        local myname = ff_local_char() or me.name
        local jobs = { [myname] = { main = me.main_job, sub = me.sub_job } }
        local aname, atype = ff_resolve_action_name_type(act, myname, jobs)
        local set = _snapshot_gear()
        if set then
            local entry = { elapsed = math.floor(os.difftime(os.time(), _g.start_os)), player = myname, type = atype, name = aname, gear = set }
            local pre = _g.cast_precast
            if cat == 4 and pre and pre.gear and (os.clock() - pre.clock) < 12 and _gear_sig(pre.gear) ~= _gear_sig(set) then
                entry.precast = pre.gear
            end
            table.insert(_g.gear_log, entry)
        end
        if cat == 4 then _g.cast_precast = nil end
    end
end)
windower.register_event('status change', function(new)
    if not _g.active then return end
    local base = STATUS_LABEL[new]
    if base then _arm_state(base) end
end)
windower.register_event('outgoing chunk', function(id, data)
    if not _g.active or id ~= 0x01A then return end
    if (data:unpack('H', 0x0A + 1)) == 16 then _arm_state('Ranged') end  -- Category 16 = RA
end)

FF_SPAWN_TYPE_MOB = 16

function ff_entity_is_mob(id_or_mob)
    if not id_or_mob then return false end
    local m, id
    if type(id_or_mob) == 'number' then
        id = id_or_mob
        m = windower.ffxi.get_mob_by_id(id)
    else
        m = id_or_mob
        id = m and m.id or nil
    end
    if id and m and ff_entity_class_observe then ff_entity_class_observe(id, m) end
    local cls = id and ff_entity_class_get_cached and ff_entity_class_get_cached(id) or nil
    if cls == FF_CLASS_MOB then return true end
    if cls == FF_CLASS_PC or cls == FF_CLASS_TRUST or cls == FF_CLASS_PET or cls == FF_CLASS_NPC then return false end
    if type(m) ~= 'table' then return false end
    return m.is_npc == true and m.spawn_type == FF_SPAWN_TYPE_MOB
end

local _cached_local_char = nil
function ff_local_char()
    local p = windower.ffxi.get_player()
    if p and p.id and p.id > 0 then
        local mob = windower.ffxi.get_mob_by_id(p.id)
        if mob and mob.name and mob.name ~= '' then
            _cached_local_char = mob.name
            return mob.name
        end
    end
    if p and p.name and p.name ~= '' then
        _cached_local_char = p.name
        return p.name
    end
    return _cached_local_char
end

ff_role = ff_role or 'host'
function ff_is_local() return ff_role == 'local' end
-- Filename-safe form of a character name (alphanumeric only).
function ff_char_filetag(name)
    name = name or ff_local_char()
    if not name or name == '' then return 'unknown' end
    return (name:gsub('[^%w]', ''))
end

FF_PROGRESSION_MSG = {
    [8]   = 'xp', [105] = 'xp',
    [718] = 'cp', [735] = 'cp',
    [371] = 'lp', [372] = 'lp',
    [809] = 'ep', [810] = 'ep',
}

function ff_log_progression_event(log, elapsed, kind, value, msg)
    if not log or type(log) ~= 'table' then return false end
    if not value or value <= 0 then return false end
    log[#log + 1] = { elapsed = elapsed, kind = kind, value = value, msg = msg }
    return true
end

-- One key-item-gained event. Fired when a 0x0055 bitmap flips a previously-
-- zero bit to one (i.e. the server just told us this KI was acquired).
function ff_log_key_item_gain(log, elapsed, ki_id, ki_name)
    if not log or type(log) ~= 'table' then return false end
    if not ki_id then return false end
    log[#log + 1] = { elapsed = elapsed, kiId = ki_id, kiName = ki_name or ('KI #' .. ki_id) }
    return true
end

local FF_CURRENCY_UINT16_MASK = {
    ["Reclamation Marks"] = true,   -- 0x113 offset 0xE0
    ["Deeds"]             = true,   -- 0x113 offset 0xF8
}

function ff_currency_snapshot_merge(into, p)
    into = into or {}
    if type(p) ~= 'table' then return into end
    for k, v in pairs(p) do
        if type(v) == 'number' and k ~= 'id' and k ~= 'size' and k ~= 'sync' and not k:find('^padding') and not k:find('^unknown') and not k:find('^_') then
            if FF_CURRENCY_UINT16_MASK[k] then v = bit.band(v, 0xFFFF) end
            into[k] = v
        end
    end
    return into
end

function ff_progression_snapshot(p)
    if not p then return nil end
    return {
        mainJob       = p['Main Job'],
        mainJobLevel  = p['Main Job Level'],
        subJob        = p['Sub Job'],
        subJobLevel   = p['Sub Job Level'],
        xpCurrent     = p['Current EXP'],
        xpToNext      = p['Required EXP'],
        epCurrent     = p['Current Exemplar Points'],
        epToNext      = p['Required Exemplar Points'],
        masterLevel   = p['Master Level'],
        unityPoints   = p['Unity Points'],
    }
end

windower.register_event('action', function(act)
    if act and act.actor_id and FF_START_CATEGORIES[act.category] then
        ff_pending_action_start(act)
    end
end)
