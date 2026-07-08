-- ─────────────────────────────────────────────────────────────────────────────
-- tracker.lua - generic combat encounter tracker (Phase 1)
--
-- Captures the SAME universal combat logs as the content modules (via the
-- shared ff_log_* emitters in libs/log_builders.lua) but with no content gate,
-- bracketing the stream into Encounters per a user-chosen mode. Writes the
-- canonical Encounter shape (web/lib/encounter.ts) to data/encounter_*.json,
-- which the desktop app reads.
--
-- Two orthogonal knobs (see TrackingConfig in encounter.ts):
--   gate     - WHEN to record:  off | zones | always
--   boundary - HOW to slice:    zone | combat-idle | session
-- Exposed as 4 user presets driven by the desktop app (off | zone | fight | session).
--
-- Loaded by Gnosis.lua AFTER json / res / _write_table_streamed and the
-- shared emitters exist. Uses those host globals; defines no `local` copies.
--
-- Capture: action_log (+ skillchains), buffs (0x028/0x063/0x029), items (cat 5),
-- spell interrupts, boss HP (0x000E, scoped to engaged enemy ids), party HP/TP,
-- pet snapshots, self/party positions, mob kills + party deaths. Enemies derived
-- from the action log on close. No periodic serialization - cheap in-memory
-- appends during combat, serialize only on encounter-close.
-- ─────────────────────────────────────────────────────────────────────────────

local MODE_PRESETS = {
    off     = { gate = 'off',    boundary = nil },
    zone    = { gate = 'zones',  boundary = 'zone' },
    fight   = { gate = 'always', boundary = 'combat-idle' },
    session = { gate = 'always', boundary = 'session' },
}

local cfg = {
    mode = 'off',
    gate = 'off',
    boundary = nil,
    idle_timeout = 30,
    lightweight = true,
    disable_movement = true,
    prune_empty_zones = true, -- discard a zone encounter that saw no combat (towns, etc.)
    track_outsiders = false,
    track_currency = false,    -- experimental; opt-in. Adds a 3s wait at encounter close for 0x0113/0x0118 replies.
    debug = false,             -- gates verbose save-trace + [perf] telemetry chat lines (silent in normal use).
}
-- Per-packet send timer for the currency-request emitter; per the packet-safety
-- rule, never blast. The function is only called from encounter open + close
-- (~2 packets per encounter, max), so we just need a tiny floor to catch a
-- bug-induced same-tick blast. 3s was wrong - it poisoned back-to-back
-- encounters: encounter A's close request would lock out encounter B's open
-- request, leaving B with no currency_start (UI showed "tracking not enabled"
-- even though tracking was always-on).
local _last_currency_req = 0
local CURRENCY_REQ_MIN_GAP_SEC = 0.1

-- Key-item bitmap snapshot keyed by packet 0x0055's Type field (0..N). Each
-- entry is the 16 × uint32 GetItemFlag bitmap (= 512 bits of KI availability).
-- Diff against incoming 0x0055 to detect KIs newly flipped 0->1. First seen
-- per Type is treated as baseline (no log entries fired), so addon load
-- doesn't spam the encounter with every pre-existing KI as a "gain".
local ki_state = {}

-- Temporary-item slot snapshot keyed by inventory index (0x001F's Index field
-- when Bag == 3). First-seen per slot is treated as baseline; subsequent
-- positive deltas log into the current encounter's drop_log with type =
-- 'temporary'. _temp_log_armed_at gates the bulk re-push the server sends on
-- addon load + zone change.
local temp_slot_state = {}
local _temp_log_armed_at = os.clock() + 5

-- Module-level currency snapshot. Updated by every 0x0113/0x0118 response we
-- ever see, regardless of whether an encounter is open. Encounter open seeds
-- enc.currency_start from this cache so we always have a baseline, even if
-- the open-phase request was rate-limited, missed, or arrived in a window
-- where enc was nil. Persists across encounters within an addon session.
local currency_cache = {}

-- The open encounter (in-memory), or nil. Logs are appended to live; everything
-- is serialized once, on close.
local enc = nil
local last_poll = 0  -- os.clock() of the last 1 Hz party poll

-- Forward declaration. Defined further down; declared up here so the action /
-- 0x000E / etc. handler closures registered above its definition site capture
-- it as an upvalue rather than falling through to a nil global. (Lua closures
-- resolve names at definition time - without this we get "attempt to call
-- global 'ensure_content_enc' (a nil value)" when those handlers fire.)
local ensure_content_enc

-- Job-id -> abbreviation (mirrors the host's update_job_info). Used by our own
-- ungated 0x0DD handler below, since the host's job capture is Sortie-only.
local JOB_MAP = {
    [1]='WAR',[2]='MNK',[3]='WHM',[4]='BLM',[5]='RDM',[6]='THF',[7]='PLD',[8]='DRK',
    [9]='BST',[10]='BRD',[11]='RNG',[12]='SAM',[13]='NIN',[14]='DRG',[15]='SMN',
    [16]='BLU',[17]='COR',[18]='PUP',[19]='DNC',[20]='SCH',[21]='GEO',[22]='RUN',
}
-- Action -> main job, only for actions no subjob can grant (zero false positives),
-- so a player's actual casting corrects a stale cached job.
local SPELL_TYPE_JOB = {
    BardSong     = 'BRD',
    BlueMagic    = 'BLU',
    Geomancy     = 'GEO',
    SummonerPact = 'SMN',
}
local JA_TYPE_JOB = {
    CorsairRoll = 'COR',
    CorsairShot = 'COR',
}
-- Player-pet entity names that get logged as action targets but are never enemies.
local PET_NAMES = { ['Luopan'] = true }
-- [id] -> {name, main, main_lvl, sub, sub_lvl}; filled from 0x0DD regardless of
-- content and persisted to disk, so a player's job survives reloads/sessions even
-- when the job-bearing 0x0DD only fires before tracking starts (the common case).
local job_cache = {}
local job_cache_dirty = false
local job_cache_last_save = 0
local JOB_CACHE_DEBOUNCE_SEC = 30
local JOB_CACHE_CAP = 500
local JOB_CACHE_TRIM_TO = 400
local JOB_CACHE_PATH = windower.addon_path .. 'data/styx_jobs.json'
local function trim_job_cache_if_full()
    local n = 0
    for _ in pairs(job_cache) do n = n + 1 end
    if n <= JOB_CACHE_CAP then return end
    local entries = {}
    for id, rec in pairs(job_cache) do
        entries[#entries + 1] = { id = id, seen = (rec.seen or 0) }
    end
    table.sort(entries, function(a, b) return a.seen > b.seen end)
    for i = JOB_CACHE_TRIM_TO + 1, #entries do
        job_cache[entries[i].id] = nil
    end
    job_cache_dirty = true
end
local function load_job_cache()
    local f = io.open(JOB_CACHE_PATH, 'r')
    if not f then return end
    local raw = f:read('*a'); f:close()
    local ok, t = pcall(json.decode, raw)
    if ok and type(t) == 'table' then
        for k, v in pairs(t) do
            local nid = tonumber(k)
            if nid and type(v) == 'table' and v.main then job_cache[nid] = v end
        end
    end
    trim_job_cache_if_full()
end
local function save_job_cache(force)
    if not job_cache_dirty then return end
    if not force and (os.clock() - job_cache_last_save) < JOB_CACHE_DEBOUNCE_SEC then return end
    local f = io.open(JOB_CACHE_PATH, 'w')
    if not f then return end
    local ok, s = pcall(json.encode, job_cache)
    if ok and s then f:write(s) end
    f:close()
    job_cache_dirty = false
    job_cache_last_save = os.clock()
end
load_job_cache()

-- Reconcile an entity id's display name (name-customizer / Witness Protection).
-- If this id was seen under a different name, carry its job over to the new name
-- and rewrite the captured logs so everything keys to the current (customized)
-- name. Mirrors the Sortie module's reconcile_party_name, scoped to the open
-- encounter. (Names on disk are the customized ones; the raw name never leaks.)
local function reconcile_enc(id, name)
    if not enc or not (id and id > 0 and name and name ~= '') then return end
    local prev = enc.id_to_name[id]
    if prev and prev ~= name then
        if enc.party_jobs[prev] and not enc.party_jobs[name] then enc.party_jobs[name] = enc.party_jobs[prev] end
        enc.party_jobs[prev] = nil
        for _, e in ipairs(enc.action_log) do
            if e.playerId == id then e.player = name end
            if e.targets then for _, t in ipairs(e.targets) do if t.id == id then t.mob = name end end end
        end
        local function rn(log, ...)
            local fs = { ... }
            for _, e in ipairs(log) do for _, f in ipairs(fs) do if e[f] == prev then e[f] = name end end end
        end
        rn(enc.buff_log, 'target', 'appliedBy')
        rn(enc.party_hp_log, 'player'); rn(enc.party_tp_log, 'player')
        rn(enc.skillchain_log, 'closer', 'mob')
        rn(enc.item_use_log, 'player')
        rn(enc.pet_log, 'owner')
        rn(enc.death_log, 'player')
        -- Live-overlay + dedup maps keyed by name → re-key prev → name.
        local function rekey(t) if t[prev] ~= nil and t[name] == nil then t[name] = t[prev] end; t[prev] = nil end
        rekey(enc.live_damage); rekey(enc.live_stats)
        rekey(enc.last_party_hpp); rekey(enc.last_party_tp); rekey(enc.last_self_buffs)
        rekey(enc.dead_members); rekey(enc.seen_alive); rekey(enc.last_pet_state)
        rekey(enc.party_max_hp)
        rekey(enc.party_max_mp)
    end
    enc.id_to_name[id] = name
end

-- Fill `into` with jobs keyed by each member's CUSTOMIZED name (resolved via
-- entity id, the same name the action log uses - never the raw get_player name).
-- Self jobs come from get_player(); others from party memory, then the 0xDD cache.
local function sync_party_jobs(into)
    local self_p = windower.ffxi.get_player()
    local self_id = self_p and self_p.id
    local pt = windower.ffxi.get_party()
    if pt then
        for _, v in pairs(pt) do
            if type(v) == 'table' and v.name and v.name ~= '' and v.id and v.id > 0 then
                local name = (resolve_member_name and resolve_member_name(v.id, v.name)) or v.name
                reconcile_enc(v.id, name)
                local mob = v.mob or windower.ffxi.get_mob_by_id(v.id)
                if mob then ff_entity_class_observe(v.id, mob) else ff_entity_class_mark_pending(v.id) end
                local cls = ff_entity_class_get_cached(v.id)
                local existing = into[name]
                local is_locked_in = existing and existing.main and existing.main ~= '?' and existing.main ~= 'TRUST'
                if v.id == self_id and self_p.main_job then
                    into[name] = { main = self_p.main_job, main_lvl = self_p.main_job_level or 0, sub = self_p.sub_job or '', sub_lvl = self_p.sub_job_level or 0 }
                elseif cls == FF_CLASS_TRUST then
                    into[name] = { main='TRUST', main_lvl=99, sub='', sub_lvl=0 }
                    job_cache[v.id] = nil
                    ff_entity_class_clear_pending_job(v.id)
                elseif cls == FF_CLASS_PC then
                    if v.main_job and v.main_job ~= 0 then
                        into[name] = { main = JOB_MAP[v.main_job] or tostring(v.main_job), main_lvl = v.main_job_level or 0, sub = JOB_MAP[v.sub_job] or '', sub_lvl = v.sub_job_level or 0 }
                        if not job_cache[v.id] then
                            job_cache[v.id] = { name = v.name, main = into[name].main, main_lvl = into[name].main_lvl, sub = into[name].sub, sub_lvl = into[name].sub_lvl, seen = os.time() }
                            job_cache_dirty = true
                            trim_job_cache_if_full()
                        else
                            job_cache[v.id].seen = os.time()
                        end
                    else
                        local pending = ff_entity_class_take_pending_job(v.id)
                        if pending and pending.main then
                            into[name] = { main = pending.main, main_lvl = pending.main_lvl or 0, sub = pending.sub or '', sub_lvl = pending.sub_lvl or 0 }
                            job_cache[v.id] = { name = v.name, main = pending.main, main_lvl = pending.main_lvl or 0, sub = pending.sub or '', sub_lvl = pending.sub_lvl or 0, seen = os.time() }
                            job_cache_dirty = true
                            trim_job_cache_if_full()
                        else
                            local jc = job_cache[v.id]
                            if jc and jc.main and jc.main ~= '?' then
                                into[name] = { main = jc.main, main_lvl = jc.main_lvl or 0, sub = jc.sub or '', sub_lvl = jc.sub_lvl or 0 }
                            elseif not is_locked_in then
                                into[name] = { main='?', main_lvl=0, sub='', sub_lvl=0 }
                            end
                        end
                    end
                else
                    if not is_locked_in then
                        into[name] = { main='?', main_lvl=0, sub='', sub_lvl=0 }
                    end
                end
            end
        end
    end
    -- Self fallback (in case the player isn't in the party list yet): authoritative
    -- jobs from get_player(), keyed by the customized name.
    if self_p and self_id and self_p.main_job then
        local sname = (resolve_member_name and resolve_member_name(self_id, self_p.name)) or self_p.name
        if not into[sname] then
            reconcile_enc(self_id, sname)
            into[sname] = { main = self_p.main_job, main_lvl = self_p.main_job_level or 0, sub = self_p.sub_job or '', sub_lvl = self_p.sub_job_level or 0 }
        end
    end
end

local function drop_owner_name()
    local p = windower.ffxi.get_player()
    if not p then return nil end
    return (resolve_member_name and resolve_member_name(p.id, p.name)) or p.name
end

-- Append a job-change event for any party member whose main/sub/levels differ
-- from what we last logged. Lets the viewer attribute the correct job to each
-- time window (e.g. per boss attempt after a mid-encounter job swap). '?'/''
-- (unresolved) jobs are skipped so we only record real, known jobs.
local function log_party_job_changes()
    if not enc or not enc.job_change_log or not enc.party_jobs then return end
    local elapsed = math.floor(os.difftime(os.time(), enc.start_os))
    for name, j in pairs(enc.party_jobs) do
        if j and j.main and j.main ~= '?' and j.main ~= '' then
            local prev = enc.last_logged_jobs[name]
            if not prev or prev.main ~= j.main or prev.main_lvl ~= (j.main_lvl or 0)
               or prev.sub ~= (j.sub or '') or prev.sub_lvl ~= (j.sub_lvl or 0) then
                enc.last_logged_jobs[name] = { main = j.main, main_lvl = j.main_lvl or 0, sub = j.sub or '', sub_lvl = j.sub_lvl or 0 }
                table.insert(enc.job_change_log, {
                    elapsed   = elapsed,
                    player    = name,
                    mainJob   = j.main,
                    mainLevel = j.main_lvl or 0,
                    subJob    = j.sub or '',
                    subLevel  = j.sub_lvl or 0,
                })
            end
        end
    end
end

ff_entity_class_subscribe(function(pid, new_class, prev_class)
    if not enc or not enc.party_jobs then return end
    if prev_class == new_class then return end
    sync_party_jobs(enc.party_jobs)
    log_party_job_changes()
end)

local _last_lazy_pet_refresh = 0
local function _do_refresh_party_pet_ids()
    if not enc or not enc.pet_ids then return end
    local pt = windower.ffxi.get_party()
    if not pt then return end
    for _, v in pairs(pt) do
        if type(v) == 'table' and v.id and v.id > 0 then
            local owner_mob = v.mob or windower.ffxi.get_mob_by_id(v.id)
            local pet_index = owner_mob and owner_mob.pet_index
            if pet_index and pet_index ~= 0 then
                local pet = windower.ffxi.get_mob_by_index(pet_index)
                if pet and pet.id and pet.id ~= 0 then
                    local owner = (resolve_member_name and resolve_member_name(v.id, v.name)) or v.name
                    enc.pet_ids[pet.id] = owner
                    if pet.name and pet.name ~= '' then enc.pet_names_seen[pet.id] = pet.name end
                    if ff_entity_class_observe then
                        local class_tbl = { id = pet.id, name = pet.name, is_npc = true, spawn_type = 18 }
                        ff_entity_class_observe(pet.id, class_tbl)
                    end
                end
            end
        end
    end
    local self_p = windower.ffxi.get_player()
    if self_p and self_p.id then
        local self_mob = windower.ffxi.get_mob_by_id(self_p.id)
        local pet_index = self_mob and self_mob.pet_index
        if pet_index and pet_index ~= 0 then
            local pet = windower.ffxi.get_mob_by_index(pet_index)
            if pet and pet.id and pet.id ~= 0 then
                local owner = (resolve_member_name and resolve_member_name(self_p.id, self_p.name)) or self_p.name
                enc.pet_ids[pet.id] = owner
                if pet.name and pet.name ~= '' then enc.pet_names_seen[pet.id] = pet.name end
                if ff_entity_class_observe then
                    local class_tbl = { id = pet.id, name = pet.name, is_npc = true, spawn_type = 18 }
                    ff_entity_class_observe(pet.id, class_tbl)
                end
            end
        end
    end
end

local function refresh_party_pet_ids()
    _last_lazy_pet_refresh = os.clock()
    _do_refresh_party_pet_ids()
end

local LAZY_PET_REFRESH_INTERVAL = 0.2
local function track_is_party_pet(id)
    if not enc or not enc.pet_ids or not id or id == 0 then return false end
    if enc.pet_ids[id] then return true end
    local now = os.clock()
    if now - _last_lazy_pet_refresh < LAZY_PET_REFRESH_INTERVAL then return false end
    _last_lazy_pet_refresh = now
    _do_refresh_party_pet_ids()
    return enc.pet_ids[id] ~= nil
end

local function zone_name_for(id)
    if not id then return nil end
    return ff_loc_zone(id, 'Zone ' .. tostring(id))
end

local function current_zone_id()
    local info = windower.ffxi.get_info()
    return info and info.zone
end

-- Recognize known content from the zone so a tracked fight/session inside it is
-- tagged (source + content.type) instead of plain 'generic'. The non-Sortie
-- recognized zones flag the encounter as live-only - drives the live overlay
-- but is discarded on close so the user doesn't accumulate generic reports
-- for content the addon doesn't model in depth.
local AMBUSCADE_ZONE_IDS = { [183]=true, [287]=true }
local LIMBUS_ZONE_IDS    = { [37]=true, [38]=true }
local ODYSSEY_ZONE_IDS   = { [279]=true, [298]=true }
local function detect_source(zid, zname)
    if zname and zname:lower():find("ra'kaznar") and (zname:find('%[U2%]') or zname:find('%[U3%]')) then
        return 'sortie'
    end
    if zid and AMBUSCADE_ZONE_IDS[zid] then return 'ambuscade' end
    if zid and LIMBUS_ZONE_IDS[zid] then return 'limbus' end
    if (zid and ODYSSEY_ZONE_IDS[zid]) or (zname and zname:find('Walk of Echoes')) then return 'odyssey' end
    return 'generic'
end

local function open_encounter(segmentation)
    local zid = current_zone_id()
    local zname = zone_name_for(zid)
    -- LIVE-ONLY = "feed the overlay, but throw away the encounter on close
    -- because some OTHER module owns the saved report for this zone". Only
    -- Sortie meets that bar today - Gnosis.lua emits the Sortie JSON and
    -- ALSO drives the shared live_state for overlay purposes. The previously-
    -- recognized Odyssey/Limbus/Ambuscade content modules have been shelved
    -- out of the addon entirely, so tracker.lua now owns the save for those
    -- zones too.
    local src = detect_source(zid, zname)
    local live_only = (src == 'sortie')
    local start_os = os.time()
    if not live_only and ff_perf_encounter_open then ff_perf_encounter_open() end
    -- Open the shared per-instance live-overlay state. We alias its tables
    -- into enc.* below so the existing handlers (track_capture_targets, the
    -- 0x000E HP sampler, push_tracker_live) keep referencing them by the
    -- same field names. next_kill_seq stays internal to live_state (it's a
    -- number - can't be shared by reference in Lua); the 0x000E handler now
    -- delegates the death snapshot to ff_live_state_hp_update which owns it.
    local live = ff_live_state_open({
        start_os       = start_os,
        source         = src,
        zone_name      = zname,
        get_deaths     = function() return enc and #enc.death_log or 0 end,
        get_party_jobs = function() return enc and enc.party_jobs or {} end,
    })
    enc = {
        start_os           = start_os,
        zone_id            = zid,
        zone_name          = zname,
        source             = src,
        live_only          = live_only,
        segmentation       = segmentation,
        action_log         = {},
        skillchain_log     = {},
        buff_log           = {},
        item_use_log       = {},
        pet_log            = {},
        battle_msg_raw     = {},
        battle_msg_raw_state = ff_raw_battle_state_new(),
        job_extended_log   = {},
        job_extended_state = ff_job_extended_state_new(),
        effect_log         = {},
        effect_state       = ff_effect_state_new(),
        party_buff_state   = ff_party_buff_state_new(),
        boss_hp_log        = {},
        party_hp_log       = {},
        party_tp_log       = {},
        party_mp_log       = {},
        position_log       = {},
        party_position_log = {},
        kill_log           = {},
        death_log          = {},
        drop_log           = {},
        progression_log    = {},
        progression_start  = nil,
        progression_end    = nil,
        currency_start     = nil,  -- merged from 0x0113 + 0x0118 at encounter open
        currency_end       = nil,  -- merged from 0x0113 + 0x0118 at encounter close
        key_item_log       = {},   -- {elapsed, kiId, kiName} for each KI flipped 0->1 in 0x0055
        party_jobs         = {},   -- name -> {main,sub,...}; enemy = NOT in this map
        job_change_log     = {},   -- {elapsed, player, mainJob, mainLevel, subJob, subLevel} per job change
        last_logged_jobs   = {},   -- name -> last-logged {main,main_lvl,sub,sub_lvl} for change diffing
        id_to_name         = {},   -- entity id -> latest customized name (rename reconcile)
        outsider_labels    = {},   -- entity id -> assigned label (e.g. "Red Mage 1"); track_outsiders only
        outsider_counts    = {},   -- label root (e.g. "Red Mage") -> next index
        pet_ids            = {},   -- entity id -> owner name; any party member's pet (Wyvern, Avatar, jug, automaton)
        pet_names_seen     = {},   -- pet entity id -> last-seen pet name (for anonymization)
        -- Live-state aliases (owned by libs/live_state.lua; we just hold refs
        -- to its tables so legacy enc.X lookups keep working unmodified):
        enemy_ids          = live.enemy_ids,
        dmg_by_id_player   = live.dmg_by_id_player,
        dmg_time_by_id     = live.dmg_time_by_id,
        id_to_mob_name     = live.id_to_mob_name,
        last_boss_hpp_id   = live.last_boss_hpp_id,
        killed_list        = live.killed_list,
        live_damage        = live.live_damage,
        live_stats         = live.live_stats,
        last_party_hpp     = {},
        last_party_tp      = {},
        last_party_mp      = {},
        last_party_buffs   = {},  -- per-member buff-id set; drives party_poll diff (path #4 for the buff log)
        party_max_hp       = {},   -- name -> derived max HP (hp/hpp), for damage-taken severity
        party_max_mp       = {},   -- name -> derived max MP (mp/mpp), for caster context
        points_start       = (ff_points_totals and ff_points_totals()) or nil,
        last_boss_hpp      = {},   -- name-keyed shadow (encounter local, drives boss_hp_log)
        last_self_buffs    = {},
        recent_buff_ev     = {},   -- ff_log_buff_event dedupe window
        dead_ids           = {},   -- entity-death dedupe (kill_log)
        dead_members       = {},   -- party-death edge state
        seen_alive         = {},
        last_pet_state     = {},
        last_pos           = {},   -- name/'@self' -> last logged position (movement dedup)
        pool_drops         = {},   -- treasure pool Index -> drop_log entry (0x0D2↔0x0D3 correlation)
        recent_pool_names  = {},   -- item name -> elapsed of last 0x0D2 insert (suppresses dup "Obtained:" text on the looter's box)
        recent_temp_names  = {},   -- item name -> elapsed of last 0x001F insert (suppresses dup "You obtain the temporary item" text)
        last_combat_clock  = os.clock(),
        had_combat         = false,
        -- Session-mode encounters span zone changes; everything else closes
        -- on zone change. zone_log records every zone the encounter touched
        -- so multi-zone runs surface ALL of them in the desktop history,
        -- not just the opening zone. First entry = open zone @ elapsed 0.
        zone_log           = { { elapsed = 0, zoneId = zid or 0, zoneName = zname or '' } },
    }
    -- Seed the roster (real jobs where known) so is-party-member checks and the
    -- DRG-jump remap work from the first packet.
    sync_party_jobs(enc.party_jobs)
    log_party_job_changes()  -- seed opening job setup at elapsed 0
    refresh_party_pet_ids()
    -- Start shared gear/state capture for this encounter window. Skip for
    -- live-only (content) encounters - the content module owns gear capture.
    if not live_only and ff_gear_start then enc.gear_token = ff_gear_start(enc.start_os) end
    -- Currency tracking: seed currency_start from the module-level cache
    -- (any 0x0113/0x0118 we've ever seen this session) so we always have a
    -- baseline even if the request below is rate-limited, missed, or its
    -- reply arrives in a window where enc was nil. Then fire the request
    -- to get a fresh snapshot - its response will overwrite the seeded
    -- values via ff_currency_snapshot_merge.
    if not live_only then
        if cfg.track_currency then
            if next(currency_cache) then
                enc.currency_start = {}
                for k, v in pairs(currency_cache) do enc.currency_start[k] = v end
                enc.currency_end = {}
                for k, v in pairs(currency_cache) do enc.currency_end[k] = v end
            end
            request_currency_snapshot()
        end
        -- Disk-streamed log writer: a background coroutine polls enc.* every
        -- 5 s and appends new entries to per-log .partial files. Save-time
        -- cost drops to ~100-500 ms since the bulk arrays are already on disk.
        if log_writer and GN_LOG_MAP then
            local _tag = ff_char_filetag and ff_char_filetag() or 'unknown'
            if gn_ensure_dir then gn_ensure_dir(GN_PARTIALS_DIR) end
            local _prefix = (GN_PARTIALS_DIR or (windower.addon_path .. 'data/_partials'))
                .. '/encounter_' .. enc.start_os .. '__' .. _tag
            enc.log_writer = log_writer.open(_prefix, enc, GN_LOG_MAP)
        end
    end
end

function request_currency_snapshot()
    local now = os.clock()
    if now - _last_currency_req < CURRENCY_REQ_MIN_GAP_SEC then return end
    _last_currency_req = now
    pcall(function() packets.inject(packets.new('outgoing', 0x010F, {})) end)
    pcall(function() packets.inject(packets.new('outgoing', 0x0115, {})) end)
end

-- Per-enemy rollup derived from the action log: any non-party target a party
-- member hit. firstSeen/damageTaken from the log; killedAt left nil (the view
-- infers kill time from the last damaging action for now).
-- Build one EncounterEnemy entry per spawn-lifetime (one per kill). FFXI
-- reuses entity ids when mobs respawn, so a 3-hour farm on a 20-slot mob
-- spawn area can produce 200+ kills across only ~20 distinct ids. The old
-- single-key collapse (name + '#' + id) merged all of those into ~20 rows;
-- this version uses kill_log to slice each entity id's life into segments
-- separated by its deaths and emits one row per segment.
--
-- Each row carries `spawnSeq` (1-indexed per (name, id)) so the web can
-- show "Treant #1, #2, #3, ..." or just group them again if the user wants
-- the compact view back.
local function derive_enemies()
    -- 1. Sorted death timestamps per entity id (from kill_log).
    local deaths_by_id = {}
    for _, k in ipairs(enc.kill_log or {}) do
        if k.id then
            local arr = deaths_by_id[k.id]
            if not arr then arr = {}; deaths_by_id[k.id] = arr end
            arr[#arr + 1] = k.elapsed
        end
    end
    for _, arr in pairs(deaths_by_id) do table.sort(arr) end
    -- For a given (id, elapsed), which spawn-lifetime is active? Spawn 1 is
    -- "from encounter start until the first death of this id"; spawn 2 is
    -- "between the first and second death"; etc. An action AT exactly the
    -- death moment belongs to the dying spawn (we use < strictly).
    local SPAWN_TOLERANCE_SEC = 5
    local function spawn_seq_for(id, elapsed)
        local deaths = deaths_by_id[id]
        if not deaths then return 1 end
        local seq = 1
        for _, d in ipairs(deaths) do
            if elapsed > d + SPAWN_TOLERANCE_SEC then seq = seq + 1 else break end
        end
        return seq
    end
    -- 2. Walk action_log assigning each (target, elapsed) to the right
    -- spawn-lifetime entry.
    local function target_is_enemy(t)
        local nm = t.mob
        if not nm or enc.party_jobs[nm] ~= nil or PET_NAMES[nm] then return false end
        if t.id and enc.pet_ids and enc.pet_ids[t.id] then return false end
        if t.petOf or t.tgtRole == 'pet' or t.tgtRole == 'pc' or t.tgtRole == 'trust' then return false end
        if not t.id then return true end
        local m = windower.ffxi.get_mob_by_id(t.id)
        if m then ff_entity_class_observe(t.id, m) end
        local cls = ff_entity_class_get_cached(t.id)
        if cls == FF_CLASS_MOB then return true end
        if cls == FF_CLASS_PC or cls == FF_CLASS_TRUST or cls == FF_CLASS_PET or cls == FF_CLASS_NPC then return false end
        if not m then return true end
        return m.is_npc == true and m.spawn_type == FF_SPAWN_TYPE_MOB
    end
    local by = {}
    for _, e in ipairs(enc.action_log) do
        if e.from ~= 'boss' then
            for _, t in ipairs(e.targets or {}) do
                local nm = t.mob
                if target_is_enemy(t) then
                    local seq = t.id and spawn_seq_for(t.id, e.elapsed) or 1
                    local key = (t.id and (nm .. '#' .. tostring(t.id) .. '#' .. tostring(seq))) or nm
                    local row = by[key]
                    if not row then
                        row = { name = nm, id = t.id, spawnSeq = seq, firstSeen = e.elapsed, killedAt = nil, damageTaken = 0 }
                        by[key] = row
                    end
                    if e.elapsed < row.firstSeen then row.firstSeen = e.elapsed end
                    row.damageTaken = row.damageTaken + (t.damage or 0)
                end
            end
        end
    end
    -- 3. Stamp killedAt by matching each death back to its spawn entry.
    -- Build an index by (id, seq) for O(1) lookup; otherwise this is the
    -- same name-fallback shape the prior implementation had for legacy
    -- (id-less) data.
    local by_id_seq = {}
    for _, row in pairs(by) do
        if row.id then by_id_seq[row.id .. '#' .. row.spawnSeq] = row end
    end
    for id, deaths in pairs(deaths_by_id) do
        for i, deathElapsed in ipairs(deaths) do
            local row = by_id_seq[id .. '#' .. i]
            if row then row.killedAt = deathElapsed end
        end
    end
    -- Name-only kills (legacy logs without entity ids) - preserve original
    -- behavior: stamp killedAt on any name-keyed row that doesn't have one.
    for _, k in ipairs(enc.kill_log or {}) do
        if not k.id then
            for _, row in pairs(by) do
                if row.name == k.name and not row.killedAt then
                    row.killedAt = k.elapsed
                end
            end
        end
    end
    -- 4. Sorted output (by firstSeen, so spawn order is preserved).
    local out = {}
    for _, r in pairs(by) do out[#out + 1] = r end
    table.sort(out, function(a, b) return a.firstSeen < b.firstSeen end)
    return out
end

local function build_party_list()
    local name_to_id = {}
    for id, nm in pairs(enc.id_to_name) do name_to_id[nm] = id end
    if ff_entity_class_pump then ff_entity_class_pump() end
    local out = {}
    for name, j in pairs(enc.party_jobs) do
        local main = j.main
        if (not main or main == '?') and ff_entity_class_is_trust then
            local pid = name_to_id[name]
            if pid and ff_entity_class_is_trust(pid) then main = 'TRUST' end
        end
        out[#out + 1] = {
            id        = name_to_id[name] or nil,
            name      = name,
            mainJob   = (main and main ~= '?') and main or '',
            subJob    = j.sub or '',
            mainLevel = j.main_lvl or 0,
            subLevel  = j.sub_lvl or 0,
            maxHp     = enc.party_max_hp[name] or nil,
        }
    end
    return out
end

local function close_encounter()
    if not enc or enc._closing then return end
    enc._closing = true
    _do_refresh_party_pet_ids()
    ff_live_state_close()
    -- Live-only (content) encounter: it only drove the overlay - discard it, and
    -- leave the content module's gear capture untouched (we never started one).
    if enc.live_only then enc = nil; return end

    local _trace = {}
    local _last_t = os.clock()
    local function _ms_since() local n = os.clock(); local ms = (n - _last_t) * 1000; _last_t = n; return ms end

    local gear_log, state_sets
    if ff_gear_result then gear_log, state_sets = ff_gear_result() end
    if ff_gear_stop then ff_gear_stop(enc.gear_token) end
    _trace.gear = _ms_since()
    local duration = math.max(0, math.floor(os.difftime(os.time(), enc.start_os)))
    local enemies = derive_enemies()
    _trace.derive = _ms_since()
    _trace.action_log_n = #enc.action_log
    _trace.enemies_n = #enemies
    _trace.kill_log_n = #(enc.kill_log or {})
    -- Keep rules:
    --   session - explicit user bracket; keep if anything was captured.
    --   fight/zone - require genuine enemy combat (so trust-summon / buff-only
    --                stretches and combatless zone walks are discarded).
    local keep
    if ff_is_local() then
        keep = enc.had_combat
    elseif enc.segmentation == 'session' then
        keep = #enc.action_log > 0
    elseif enc.segmentation == 'content-auto' then
        keep = enc.had_combat and #enemies > 0
    else
        keep = enc.had_combat and #enemies > 0
    end
    if not keep then
        if enc.segmentation ~= 'content-auto' then
            gn_chat(('Encounter discarded [%s/%s]: had_combat=%s, actions=%d, enemies=%d, kills=%d')
                :format(tostring(enc.source), tostring(enc.segmentation),
                        tostring(enc.had_combat), #enc.action_log, #enemies, #(enc.kill_log or {})))
        end
        if enc.log_writer then enc.log_writer.discard() end
        enc = nil; return
    end

    local function arr(t) return (#t > 0) and t or json.null end
    local source = enc.source or 'generic'
    local mychar = ff_local_char and ff_local_char()
    local encounter = {
        id               = 'enc_' .. tostring(enc.start_os),
        source           = source,
        language         = FF_CLIENT_LANG or 'en',
        localCharacter   = mychar or json.null,
        segmentation     = enc.segmentation,
        zoneId           = enc.zone_id or json.null,
        zoneName         = enc.zone_name or json.null,
        -- Multi-zone trail (session-mode encounters span zone changes).
        -- One entry per zone the encounter visited, in order. Length-1 lists
        -- get rendered the same as the legacy single-zone case in the UI.
        zoneLog          = arr(enc.zone_log),
        startTime        = enc.start_os,
        durationSeconds  = duration,
        party            = build_party_list(),
        jobChangeLog     = arr(enc.job_change_log),
        playerIds        = next(enc.id_to_name) and (function()
            local m = {}
            for id, nm in pairs(enc.id_to_name) do m[nm] = id end
            return m
        end)() or nil,
        enemies          = arr(enemies),
        actionLog        = arr(enc.action_log),
        skillchainLog    = arr(enc.skillchain_log),
        buffLog          = arr(enc.buff_log),
        itemUseLog       = arr(enc.item_use_log),
        petLog           = arr(enc.pet_log),
        bossHpLog        = arr(enc.boss_hp_log),
        partyHpLog       = arr(enc.party_hp_log),
        partyTpLog       = arr(enc.party_tp_log),
        partyMpLog       = arr(enc.party_mp_log),
        partyMaxHp       = (next(enc.party_max_hp) and enc.party_max_hp) or json.null,
        partyMaxMp       = (next(enc.party_max_mp) and enc.party_max_mp) or json.null,
        points           = (function()
            if not ff_points_totals or not enc.points_start then return json.null end
            local now = ff_points_totals()
            local d = {
                xp = math.max(0, (now.xp or 0) - (enc.points_start.xp or 0)),
                cp = math.max(0, (now.cp or 0) - (enc.points_start.cp or 0)),
                ep = math.max(0, (now.ep or 0) - (enc.points_start.ep or 0)),
                lp = math.max(0, (now.lp or 0) - (enc.points_start.lp or 0)),
            }
            if d.xp + d.cp + d.ep + d.lp == 0 then return json.null end
            return d
        end)(),
        positionLog      = arr(enc.position_log),
        partyPositionLog = arr(enc.party_position_log),
        killLog          = arr(enc.kill_log),
        deathLog         = arr(enc.death_log),
        dropLog          = arr(enc.drop_log),
        progressionLog   = arr(enc.progression_log),
        progressionStart = enc.progression_start or json.null,
        progressionEnd   = enc.progression_end or json.null,
        currencyStart    = enc.currency_start or json.null,
        currencyEnd      = enc.currency_end or json.null,
        keyItemLog       = arr(enc.key_item_log),
        gearLog          = gear_log or json.null,
        stateSets        = state_sets or json.null,
        enemyReports     = json.null,
        content          = { type = source },
        notes            = '',
        addonVersion     = _addon and _addon.version or nil,
    }
    _trace.assemble = _ms_since()
    _trace.position_n = #(enc.position_log or {})
    _trace.party_hp_n = #(enc.party_hp_log or {})
    _trace.boss_hp_n = #(enc.boss_hp_log or {})

    downsample_log(enc.position_log, 1800)
    downsample_log(enc.party_hp_log, 1800)
    downsample_log(enc.party_tp_log, 1800)
    downsample_log(enc.boss_hp_log, 1800)
    _trace.downsample = _ms_since()

    local tag = ff_char_filetag and ff_char_filetag(mychar) or 'unknown'
    -- Per-zone subfolder. enc.zone_name updates for session-mode encounters
    -- that span zones - using current value puts the file under the zone the
    -- encounter ended in; single-zone encounters land where they happened.
    local zone_segment = (gn_zone_path_segment and gn_zone_path_segment(enc.zone_name)) or 'Unknown'
    local zone_dir    = windower.addon_path .. 'data/' .. zone_segment
    if gn_ensure_dir then gn_ensure_dir(zone_dir) end
    local save_basename = ('encounter_%d__%s'):format(enc.start_os, tag)
    local save_path = zone_dir .. '/' .. save_basename .. '.json'
    local enemy_count = #encounter.enemies

    if cfg and cfg.debug then
        gn_chat(('save trace pre-encode: gear=%dms derive=%dms assemble=%dms downsample=%dms | actions=%d enemies=%d kills=%d pos=%d phpL=%d bhpL=%d')
            :format(_trace.gear, _trace.derive, _trace.assemble, _trace.downsample,
                    _trace.action_log_n, _trace.enemies_n, _trace.kill_log_n,
                    _trace.position_n, _trace.party_hp_n, _trace.boss_hp_n))
    end

    -- Currency close-phase: fire the request now so the server's 0x0113 +
    -- 0x0118 replies arrive during the wait window and the handler can
    -- update enc.currency_end before we snapshot it into the encounter
    -- table. enc is nilled INSIDE the schedule (not before) so the late
    -- packet responses still find their target.
    --   _currency_close_phase=true freezes currency_start so the close
    -- response only overwrites currency_end and the delta math is correct.
    --   _currency_close_0113/0118 are flipped by the handler when each of
    -- the two replies actually arrives - the schedule polls these so we
    -- proceed immediately on arrival instead of always blocking a fixed
    -- timeout (which previously lost replies that landed > 0.7s after the
    -- request on slow boxes, producing delta=0).
    -- Capture both the encounter ref AND the writer ref BEFORE the schedule.
    -- `enc` gets nilled inside the callback (line below) but the writer needs
    -- to keep capturing late entries during the 3 s currency wait - its
    -- background tick reads from `enc_ref` (which is the same table).
    local enc_ref = enc
    local save_writer = enc.log_writer
    enc.log_writer = nil
    local track_currency = cfg.track_currency
    if track_currency then
        enc._currency_close_phase = true
        enc._currency_close_0113 = false
        enc._currency_close_0118 = false
        request_currency_snapshot()
    end

    coroutine.schedule(function()
        local cur_wait_ms = 0
        local cur_missing
        if track_currency then
            local t0 = os.clock()
            while os.clock() - t0 < 3.0 do
                if enc_ref._currency_close_0113 and enc_ref._currency_close_0118 then break end
                coroutine.sleep(0.05)
            end
            cur_wait_ms = (os.clock() - t0) * 1000
            if not enc_ref._currency_close_0113 and not enc_ref._currency_close_0118 then
                cur_missing = 'both'
            elseif not enc_ref._currency_close_0113 then
                cur_missing = '0x0113'
            elseif not enc_ref._currency_close_0118 then
                cur_missing = '0x0118'
            end
            encounter.currencyEnd = enc_ref.currency_end or json.null
        else
            encounter.currencyStart = json.null
            encounter.currencyEnd = json.null
        end
        enc = nil
        local _enc_t0 = os.clock()
        local ok, telemetry
        if save_writer then
            ok, telemetry = save_writer.finalize(encounter, save_path)
        else
            ok = _write_table_streamed(save_path, encounter, true)
        end
        local _enc_ms = (os.clock() - _enc_t0) * 1000
        if ok then
            local label = (source ~= 'generic') and (' [' .. source .. ']') or ''
            local cur_tail = ''
            if track_currency then
                if cur_missing then
                    cur_tail = (' [currency timeout %dms, missing %s]'):format(math.floor(cur_wait_ms), cur_missing)
                else
                    cur_tail = (' [currency %dms]'):format(math.floor(cur_wait_ms))
                end
            end
            gn_chat(('Encounter saved%s: %ds, %d enemies. save=%dms%s')
                :format(label, duration, enemy_count, _enc_ms, cur_tail))
            if telemetry and cfg and cfg.debug then gn_chat(('[perf] %s'):format(tostring(telemetry))) end
            if ff_perf_encounter_close_dump then
                local rel = ff_perf_encounter_close_dump(save_basename)
                if rel then gn_chat('Debug performance log saved: ' .. rel) end
            end
        else
            gn_chat_err('Encounter save failed.')
        end
    end, 0)
end

-- ── Combat detection ────────────────────────────────────────────────────────
-- "Combat" = a party member acts on an enemy mob, OR an enemy mob acts on a
-- party member. Buffs/heals/summons (party -> party) and other people's fights
-- (mob <-> non-party) are NOT combat, so they neither open nor sustain a
-- combat-idle encounter. Trusts count as party members (so a trust nuking a mob
-- is combat; a trust buffing you is not).

-- Cheap party-membership lookup, refreshed at most 1 Hz (get_party per action
-- packet would be wasteful in heavy AoE).
local roster, roster_t = {}, -1
local function refresh_roster()
    local c = os.clock()
    if c - roster_t < 1.0 then return end
    roster_t = c
    local r = {}
    -- Key by the CUSTOMIZED name (resolve via id) so combat detection matches the
    -- action log's names under a name-customizer; not the raw get_player name.
    local p = windower.ffxi.get_player()
    if p and p.id and p.id > 0 then r[(resolve_member_name and resolve_member_name(p.id, p.name)) or p.name] = true
    elseif p and p.name then r[p.name] = true end
    local pt = windower.ffxi.get_party()
    if pt then
        for _, v in pairs(pt) do
            if type(v) == 'table' and v.name and v.name ~= '' then
                if v.id and v.id > 0 then r[(resolve_member_name and resolve_member_name(v.id, v.name)) or v.name] = true
                else r[v.name] = true end
            end
        end
    end
    roster = r
end
local function is_party_name(name) return name ~= nil and roster[name] == true end

local function action_involves_enemy(act)
    local actor = windower.ffxi.get_mob_by_id(act.actor_id)
    local actor_party = actor and is_party_name(actor.name)
    for _, tgt in ipairs(act.targets or {}) do
        local m = tgt.id and windower.ffxi.get_mob_by_id(tgt.id)
        if m then
            local tgt_party = is_party_name(m.name)
            if actor_party and ff_entity_is_mob(m) and not tgt_party then return true end
            if actor and ff_entity_is_mob(actor) and not actor_party and tgt_party then return true end
        end
    end
    return false
end

-- ── Buff / death inference helpers ──────────────────────────────────────────
local TRACK_BUFF_GAIN_MSG = { [205]=true, [186]=true, [187]=true, [188]=true, [194]=true, [228]=true, [230]=true, [266]=true, [280]=true, [319]=true }
local TRACK_BUFF_WEAR_MSG = { [206]=true, [204]=true, [350]=true }
local TRACK_ADDEFFECT_GAIN_MSG = { [160]=true, [164]=true, [166]=true }
local TRACK_RESIST_MSG = { [85]=true, [284]=true, [655]=true, [656]=true, [75]=true, [653]=true, [654]=true }
local TRACK_SPECIFIC_DEBUFF = { [593]=147, [594]=149, [595]=175, [596]=167, [597]=148, [598]=146, [599]=13, [519]=386, [520]=391, [521]=396, [591]=448 }
-- KO message set lives in libs/log_builders.lua as FF_DEATH_MSG (single source
-- of truth shared with content modules - see [[project_death_tracking_strategy]]).
-- Alias kept under the local name so the rest of this file reads unchanged.
local TRACK_DEATH_MSG = FF_DEATH_MSG

local function track_is_party(name) return name ~= nil and enc ~= nil and enc.party_jobs[name] ~= nil end

local JOB_FULL = {
    WAR='Warrior', MNK='Monk', WHM='White Mage', BLM='Black Mage', RDM='Red Mage',
    THF='Thief', PLD='Paladin', DRK='Dark Knight', BST='Beastmaster', BRD='Bard',
    RNG='Ranger', SAM='Samurai', NIN='Ninja', DRG='Dragoon', SMN='Summoner',
    BLU='Blue Mage', COR='Corsair', PUP='Puppetmaster', DNC='Dancer', SCH='Scholar',
    GEO='Geomancer', RUN='Rune Fencer',
}

local function _trust_root(name)
    return (name and name:match('^([%w%-_]+)')) or 'Trust'
end

local function assign_outsider_label(tgt_id, tgt_mob)
    if not enc or not enc.outsider_labels then return nil end
    local existing = enc.outsider_labels[tgt_id]
    if existing then return existing end
    ff_entity_class_observe(tgt_id, tgt_mob)
    local cls = ff_entity_class_get_cached(tgt_id)
    local root
    if cls == FF_CLASS_TRUST or cls == FF_CLASS_NPC then
        root = _trust_root(tgt_mob.name)
    elseif cls == FF_CLASS_PC then
        local job = tgt_mob.main_job
        root = (job and JOB_FULL[job]) or job or 'Player'
    elseif tgt_mob.is_npc == true then
        root = _trust_root(tgt_mob.name)
    else
        local job = tgt_mob.main_job
        root = (job and JOB_FULL[job]) or job or 'Player'
    end
    enc.outsider_counts[root] = (enc.outsider_counts[root] or 0) + 1
    local label = root .. ' ' .. enc.outsider_counts[root]
    enc.outsider_labels[tgt_id] = label
    return label
end

local function track_log_buff(kind, target_name, target_id, buff_id, source, applied_by, applied_by_spell, duration)
    if target_id and track_is_party_pet(target_id) then
        if target_name then enc.pet_names_seen[target_id] = target_name end
        return
    end
    ff_log_buff_event(enc.buff_log, enc.recent_buff_ev, enc.start_os, {
        kind = kind, target_name = target_name, target_id = target_id, buff_id = buff_id,
        source = source, applied_by = applied_by, applied_by_spell = applied_by_spell,
        duration = duration,
    })
end

-- Walk an action's targets: capture buff gain/wear and mob deaths (msg 6).
-- The per-mob damage map, the engaged-mob set, and the player live_damage/
-- live_stats tally live in libs/live_state.lua now - the caller invokes
-- ff_live_state_accumulate alongside this function, and we focus on the
-- encounter-level work (buff_log + kill_log) the saved report needs.
local function track_capture_targets(act)
    if not act.targets then return end
    local actor_mob = windower.ffxi.get_mob_by_id(act.actor_id)
    local actor_name = actor_mob and actor_mob.name
    local actor_party = track_is_party(actor_name)
    for _, tgt in ipairs(act.targets) do
        if tgt and tgt.id then
            local tgt_mob = windower.ffxi.get_mob_by_id(tgt.id)
            local cached_name = enc.id_to_name and enc.id_to_name[tgt.id]
            local tgt_name = (tgt_mob and tgt_mob.name) or cached_name
            local tgt_party_resolved = tgt_name and track_is_party(tgt_name)
            if actor_party and not tgt_party_resolved and tgt.actions and not track_is_party_pet(tgt.id) then
                for _, a in ipairs(tgt.actions) do
                    if a.message and TRACK_DEATH_MSG[a.message] then
                        ff_log_entity_death(enc.kill_log, enc.dead_ids, enc.start_os, tgt.id, enc.zone_name, track_is_party, tgt_name)
                        break
                    end
                end
            end
            if tgt_mob and tgt_mob.name then
                local tgt_party = track_is_party(tgt_mob.name)
                local tgt_enemy = ff_entity_is_mob(tgt_mob) and not tgt_party
                local a = tgt.actions and tgt.actions[1]
                if a then
                    local msg = a.message
                    local cat = act.category
                    local on_trackable = tgt_party or ff_entity_is_mob(tgt_mob)
                    local action_name = ff_resolve_action_name_type(act, actor_name, enc.party_jobs)
                    local kind = (TRACK_BUFF_GAIN_MSG[msg] and 'gain') or (TRACK_BUFF_WEAR_MSG[msg] and 'wear') or nil
                    if kind and on_trackable then
                        local buff_id = a.param
                        local remap_ok = false
                        if cat == 14 or cat == 15 then
                            local ja = res.job_abilities and res.job_abilities[act.param]
                            if ja and ja.status and ja.status ~= 0 then buff_id = ja.status; remap_ok = true end
                        end
                        if cat == 4 or cat == 6 or ((cat == 14 or cat == 15) and remap_ok) then
                            local applied_by = (kind == 'gain' and actor_name) or nil
                            track_log_buff(kind, tgt_mob.name, tgt.id, buff_id, '0x028', applied_by, (kind == 'gain') and action_name or nil)
                        end
                    end
                    local spec = TRACK_SPECIFIC_DEBUFF[msg]
                    if spec and on_trackable then
                        track_log_buff('gain', tgt_mob.name, tgt.id, spec, '0x028', actor_name, action_name)
                    end
                    if on_trackable then
                        for _, sa in ipairs(tgt.actions) do
                            local ae = sa.add_effect_message
                            if ae and TRACK_ADDEFFECT_GAIN_MSG[ae] and sa.add_effect_param and sa.add_effect_param ~= 0 then
                                track_log_buff('gain', tgt_mob.name, tgt.id, sa.add_effect_param, '0x028', actor_name, action_name)
                            end
                        end
                    end
                    if tgt_enemy and (cat == 4 or cat == 8) and not TRACK_RESIST_MSG[msg] then
                        local sp = res.spells and res.spells[act.param]
                        if sp and sp.status and sp.status ~= 0 then
                            track_log_buff('gain', tgt_mob.name, tgt.id, sp.status, '0x028', actor_name, action_name)
                        end
                    end
                end
            end
        end
    end
end

-- Item icons are extracted by the shared ff_queue_icon service (host) so every
-- module benefits; we just queue the ids we capture below.

-- Gear + state-set capture (precast/midcast, Engaged/Idle/Resting/Ranged) lives
-- in the shared engine (libs/log_builders.lua: ff_gear_start/result/stop) so the
-- content modules get it too. We just start it on open and fold the result on
-- close - no gear/state event handling here anymore.

ff_register_action_handler(function(act)
    if not act then return end
    -- Lazy content-zone arm: if we entered a content zone before the addon
    -- loaded (no zone-change event fired for us), open the live-only enc on
    -- the first action we see. Cheap idempotent call.
    ensure_content_enc()
    if cfg.gate == 'off' and not enc then return end
    local cat = act.category
    if act.actor_id and act.param then
        local j
        if cat == 4 then
            local sp = res.spells and res.spells[act.param]
            j = sp and SPELL_TYPE_JOB[sp.type]
        elseif cat == 6 then
            local ja = res.job_abilities and res.job_abilities[act.param]
            j = ja and JA_TYPE_JOB[ja.type]
        end
        if j then
            local cur = job_cache[act.actor_id]
            if not cur or cur.main ~= j then
                local was_new = (cur == nil)
                job_cache[act.actor_id] = {
                    name = cur and cur.name, main = j,
                    main_lvl = (cur and cur.main_lvl) or 0,
                    sub = (cur and cur.sub) or '', sub_lvl = (cur and cur.sub_lvl) or 0,
                    seen = os.time(),
                }
                job_cache_dirty = true
                if was_new then trim_job_cache_if_full() end
            elseif cur then
                cur.seen = os.time()
            end
        end
    end
    -- 1 melee, 2 ranged, 3 WS, 4 spell finish, 6 JA, 11 mob TP, 13 pet, 14/15 DNC/RUN.
    -- (Cat 8 spell-begin excluded - unresolvable "Spell" noise, as in Sortie.
    -- Cat 5 items + cat 8 interrupts are captured separately below.)
    local is_combat_cat = (cat == 1 or cat == 2 or cat == 3 or cat == 4 or cat == 6 or cat == 11 or cat == 13 or cat == 14 or cat == 15)
    refresh_roster()
    -- combat-idle (By Fight): only genuine combat opens a new encounter - not a
    -- buff, item, or trust summon.
    if not enc then
        if cfg.boundary == 'combat-idle' and is_combat_cat and action_involves_enemy(act) then
            open_encounter('combat-idle')
        else
            return
        end
    end
    -- open_encounter defers (leaves enc nil) in recognized content zones - those
    -- are owned by the content modules, so there's nothing more to do here.
    if not enc then return end
    local jobs = enc.party_jobs
    -- Multibox role=local: skip the heavy combat parsing entirely (the host box
    -- owns the shared combat log). We still detect combat to bracket the
    -- encounter, and gear/position/buffs are captured by separate handlers.
    local lite = ff_is_local()
    if is_combat_cat then
        local combat = action_involves_enemy(act)
        -- live-only encounters skip the full action log (it would be discarded);
        -- track_capture_targets still feeds the overlay (live damage / enemy ids).
        if not enc.live_only and not lite then
            ff_log_action_event(enc.action_log, enc.skillchain_log, enc.start_os, act, {
                party_jobs       = jobs,
                is_actor_boss    = function(name) return jobs[name] == nil end,
                capture_swings   = true,
                party_id_to_name = enc.id_to_name,
                on_actor_reconcile = reconcile_enc,
                relabel_outsider = cfg.track_outsiders and assign_outsider_label or nil,
                pet_ids          = enc.pet_ids,
                pet_names        = enc.pet_names_seen,
                party_tp         = enc.last_party_tp,
            })
        end
        -- Shared live-overlay accumulation: per-mob-instance damage map
        -- (drives Focus Mob), enemy_ids gate (scopes the 0x000E HP sampler),
        -- and the name-keyed live_damage/live_stats tally (drives the
        -- players[] block in tracker_live.json). All of this lives in
        -- libs/live_state.lua now and runs for every encounter regardless of
        -- live_only state.
        if not lite then
            ff_live_state_accumulate(act, track_is_party)
            -- Encounter-only follow-up: buff_log + kill_log via msg-6.
            track_capture_targets(act)
        end
        -- (Self gear/state capture is handled by the shared engine in log_builders.)
        if combat then
            enc.had_combat = true
            enc.last_combat_clock = os.clock()
        end
    end
    if enc.live_only or lite then return end
    ff_log_item_use_event(enc.item_use_log, enc.start_os, act, { party_jobs = jobs, area = enc.zone_name })
    ff_log_action_start(enc.action_log, enc.start_os, act, { party_jobs = jobs })
    ff_log_action_interrupt(enc.action_log, enc.start_os, act, { party_jobs = jobs })
end)

local function _chunk_party_jobs(id, data)
    if id ~= 0xDD then return end
    local ok, packet = pcall(packets.parse, 'incoming', data)
    if not ok or not packet then return end
    local pid, nm, mj = packet['ID'], packet['Name'], packet['Main job']
    if pid and pid > 0 and mj and mj ~= 0 then
        ff_entity_classify(pid)
        local cls = ff_entity_class_get_cached(pid)
        local record = {
            name     = (nm and nm ~= '') and nm or (job_cache[pid] and job_cache[pid].name) or nil,
            main     = JOB_MAP[mj] or tostring(mj),
            main_lvl = packet['Main job level'] or 0,
            sub      = JOB_MAP[packet['Sub job']] or '',
            sub_lvl  = packet['Sub job level'] or 0,
            seen     = os.time(),
        }
        if cls == FF_CLASS_PC then
            local was_new = (job_cache[pid] == nil)
            job_cache[pid] = record
            job_cache_dirty = true
            if was_new then trim_job_cache_if_full() end
        elseif cls == FF_CLASS_UNKNOWN then
            ff_entity_class_set_pending_job(pid, record)
        end
    end

    -- Packet-driven TP sampling. The 1Hz get_party() poll missed brief TP
    -- spikes (auto-attack tick then immediate WS within the same second
    -- looked like no change). The server pushes this packet on every TP
    -- update, so sampling here captures every transition at the moment
    -- the client sees it. Dedup table is shared with the poll path so
    -- duplicates from both sources collapse cleanly.
    if not enc or enc.live_only or cfg.lightweight then return end
    -- Zone field is 0 when the member is in our zone; non-zero means a
    -- different zone (and HP/MP/TP in that packet are zeroed sentinels
    -- per the 0x0DD spec). Skip those - they'd record fake TP=0 samples.
    local zone_no = packet['Zone']
    if zone_no and zone_no ~= 0 then return end
    if not pid or pid == 0 then return end
    local mob = windower.ffxi.get_mob_by_id(pid)
    local resolved = mob and mob.name
    if not resolved or resolved == '' then return end
    local tp = packet['TP']
    if tp ~= nil and enc.last_party_tp[resolved] ~= tp then
        enc.last_party_tp[resolved] = tp
        ff_log_party_tp_sample(enc.party_tp_log,
            math.floor(os.difftime(os.time(), enc.start_os)),
            resolved, tp, pid)
    end
    local hp, hpp = packet['HP'], packet['HP%']
    if hp and hp > 0 and hpp and hpp > 0 then
        if hpp == 100 then
            enc.party_max_hp[resolved] = hp
        elseif not enc.party_max_hp[resolved] then
            enc.party_max_hp[resolved] = math.floor(hp / hpp * 100 + 0.5)
        end
    end
    local mp, mpp = packet['MP'], packet['MP%']
    if mp and mp > 0 and mpp and mpp > 0 then
        if mpp == 100 then
            enc.party_max_mp[resolved] = mp
        elseif not enc.party_max_mp[resolved] then
            enc.party_max_mp[resolved] = math.floor(mp / mpp * 100 + 0.5)
        end
    end
    if hpp ~= nil and enc.last_party_hpp[resolved] ~= hpp then
        enc.last_party_hpp[resolved] = hpp
        ff_log_party_hp_sample(enc.party_hp_log,
            math.floor(os.difftime(os.time(), enc.start_os)),
            resolved, hpp, pid)
    end
end

local function _chunk_misc(id, data)
    -- Baseline-tracking handlers run BEFORE the enc gate so cache state stays
    -- accurate across non-tracking periods. They only emit log entries when an
    -- encounter is open.

    -- 0x0055 Key Item bitmap. Server pushes one packet per Type (0..N) on zone
    -- entry plus whenever the player's KI set changes. We diff each Type's
    -- bitmap against our prior snapshot; bits that flipped 0->1 are KIs the
    -- player just acquired, logged with the current encounter elapsed.
    if id == 0x0055 then
        local ki_type = data:unpack('I', 0x84 + 1)
        if not ki_type then return end
        local new_flags = {}
        for i = 0, 15 do
            new_flags[i + 1] = data:unpack('I', 0x04 + i * 4 + 1) or 0
        end
        local prev = ki_state[ki_type]
        if prev and enc and enc.key_item_log then
            for i = 1, 16 do
                local diff = bit.band(new_flags[i], bit.bnot(prev[i] or 0))
                if diff ~= 0 then
                    for b = 0, 31 do
                        if bit.band(diff, bit.lshift(1, b)) ~= 0 then
                            local ki_id = ki_type * 512 + (i - 1) * 32 + b
                            local ki = res.key_items and res.key_items[ki_id]
                            ff_log_key_item_gain(enc.key_item_log,
                                math.floor(os.difftime(os.time(), enc.start_os)),
                                ki_id, ff_loc_name(ki, nil))
                        end
                    end
                end
            end
        end
        ki_state[ki_type] = new_flags
        return
    end

    -- 0x001F Item-in-container update. We track Bag 3 (Temporary Items) only:
    -- diff incoming Count + Item id against our cached slot state and log net
    -- positive deltas as drop_log entries (type='temporary') with the item id
    -- so the UI can render the icon. _temp_log_armed_at suppresses logging
    -- during the bulk inventory burst at addon load + zone change (server
    -- re-sends the full container state on those events).
    if id == 0x001F then
        local count   = data:unpack('I', 0x04 + 1) or 0
        local item_no = data:unpack('H', 0x08 + 1) or 0
        local bag     = data:unpack('C', 0x0A + 1) or 0
        local idx     = data:unpack('C', 0x0B + 1) or 0
        if bag == 3 then
            local prev = temp_slot_state[idx]
            local delta = 0
            if item_no > 0 then
                if not prev or prev.item_no ~= item_no then
                    delta = count
                elseif count > (prev.count or 0) then
                    delta = count - prev.count
                end
                temp_slot_state[idx] = { item_no = item_no, count = count }
            else
                temp_slot_state[idx] = nil
            end
            if delta > 0 and enc and enc.drop_log and os.clock() >= _temp_log_armed_at then
                local item = res.items and res.items[item_no]
                local nm = ff_loc_name(item, 'Item #' .. tostring(item_no))
                local entry = {
                    name    = nm,
                    itemId  = item_no,
                    count   = (delta > 1) and delta or nil,
                    elapsed = math.floor(os.difftime(os.time(), enc.start_os)),
                    type    = 'temporary',
                    by      = drop_owner_name(),
                }
                table.insert(enc.drop_log, entry)
                enc.recent_temp_names[nm] = entry.elapsed
                if ff_queue_icon then ff_queue_icon(item_no) end
            end
        end
        return
    end

    -- 0x0113 / 0x0118 Currencies (1) / (2). Always update the module-level
    -- cache regardless of encounter state, so a response that arrives between
    -- encounters (the brief gap before combat detected -> enc opened) isn't
    -- lost. When an encounter IS open, also update its currency_start/end
    -- snapshots. The close_encounter path sets _currency_close_phase=true to
    -- freeze currency_start so end-start = real delta.
    if id == 0x0113 or id == 0x0118 then
        local ok, p = pcall(packets.parse, 'incoming', data)
        if ok and p then
            ff_currency_snapshot_merge(currency_cache, p)
            if enc then
                if not enc.currency_end then enc.currency_end = {} end
                ff_currency_snapshot_merge(enc.currency_end, p)
                if enc._currency_close_phase then
                    if id == 0x0113 then enc._currency_close_0113 = true end
                    if id == 0x0118 then enc._currency_close_0118 = true end
                else
                    if not enc.currency_start then enc.currency_start = {} end
                    ff_currency_snapshot_merge(enc.currency_start, p)
                end
            end
        end
        return
    end

    -- HP updates feed the overlay's per-mob LIVE list, so we want them flowing
    -- in content zones even when cfg.gate is off. ensure_content_enc handles
    -- the lazy-arm; the enc-required check still gates non-content zones.
    ensure_content_enc()
    if not enc then return end

    if id == 0x044 then
        ff_log_job_extended(enc.job_extended_log, enc.job_extended_state, enc.start_os, data)
    end

    if id == 0x030 then
        ff_log_effect(enc.effect_log, enc.effect_state, enc.start_os, data)
    end

    if id == 0x076 then
        ff_log_party_buffs(enc.buff_log, enc.recent_buff_ev, enc.party_buff_state, enc.start_os, data, enc.party_jobs, enc.id_to_name)
    end

    if id == 0x000E then
        -- HP update for a mob we've engaged this encounter (enemy_ids scopes
        -- out town NPCs / other people's fights - gate lives in live_state
        -- now, populated by track_capture_targets).
        local eid = data:unpack('I', 0x04 + 1)
        if not eid or eid == 0 then return end
        if not ff_live_state_is_engaged(eid) then return end
        if track_is_party_pet(eid) then
            local pm = windower.ffxi.get_mob_by_id(eid)
            if pm and pm.name then enc.pet_names_seen[eid] = pm.name end
            return
        end
        local mask = data:unpack('C', 0x0A + 1) or 0
        if bit.band(mask, 0x04) == 0 then return end
        local mob = windower.ffxi.get_mob_by_id(eid)
        if mob and mob.name and ff_entity_is_mob(mob) and not track_is_party(mob.name) and mob.hpp ~= nil then
            -- Sample the per-mob HP series + the name-keyed shadow only on
            -- HP change. The shared last_boss_hpp_id tells us "did this hpp
            -- already get logged this tick?" before live_state mutates it.
            local live = ff_live_state_get()
            local prev_hpp = live and live.last_boss_hpp_id[eid]
            if prev_hpp ~= mob.hpp then
                enc.last_boss_hpp[mob.name] = mob.hpp
                ff_log_boss_hp_sample(enc.boss_hp_log, math.floor(os.difftime(os.time(), enc.start_os)), mob.name, mob.hpp, eid)
            end
            -- Delegate HP update + death snapshot to live_state. The shared
            -- killed_list / per-id clear all happens there; we get the
            -- one-shot kill_entry back to fire the IPC event for the
            -- overlay's HISTORY browser.
            local kill_entry = ff_live_state_hp_update(eid, mob.name, mob.hpp)
            if kill_entry and ff_ipc_send_kill then ff_ipc_send_kill(kill_entry) end
            -- Encounter-level kill_log entry on death (separate from the
            -- live-overlay killed_list; this is what the saved report uses).
            if mob.hpp == 0 then
                ff_log_entity_death(enc.kill_log, enc.dead_ids, enc.start_os, eid, enc.zone_name, track_is_party, mob.name)
            end
        end
        return
    end

    if id == 0x0063 then
        -- Self buff-list snapshot (Order 9). Diff against last to emit gain/wear.
        -- Buff ids + remaining durations come from the shared raw-packet parser
        -- (ff_parse_buff_list_packet) so this code path stores the duration the
        -- server granted at gain time alongside the buff id. 0x063 fires whenever
        -- the buff set changes (gain/wear) AND on a periodic refresh, so the
        -- diff still drives gain/wear events correctly.
        local ok, p = pcall(packets.parse, 'incoming', data)
        if ok and p and p['Order'] == 9 then
            local me = windower.ffxi.get_player()
            local nm = me and ((ff_local_char and ff_local_char()) or me.name)
            if nm then
                local durations = ff_parse_buff_list_packet(data)
                local new_set = {}
                for bid in pairs(durations) do new_set[bid] = true end
                local prev = enc.last_self_buffs[nm] or {}
                -- Use our entity id (not nil) so these dedupe against the 0x028
                -- action-path gains for the same self buff (same dedupe key).
                for b in pairs(new_set) do
                    if not prev[b] then
                        track_log_buff('gain', nm, me.id, b, '0x063', nil, nil, durations[b])
                    end
                end
                for b in pairs(prev) do
                    if not new_set[b] then track_log_buff('wear', nm, me.id, b, '0x063', nil) end
                end
                enc.last_self_buffs[nm] = new_set
            end
        end
        return
    end

    if id == 0x0029 then
        ff_log_battle_message_raw(enc.battle_msg_raw, enc.battle_msg_raw_state, enc.start_os, data)
        -- Battle-message wear-off backup (catches dispels/expirations the 0x028
        -- action path misses). MessageNum @0x18, target id @0x08, buff id @0x0C.
        local msg = data:unpack('H', 0x18 + 1)
        local tgt_id  = data:unpack('I', 0x08 + 1)
        if msg and tgt_id and tgt_id ~= 0 and TRACK_DEATH_MSG[msg] then
            local nm = enc.id_to_name[tgt_id]
            if not nm then
                local mob = windower.ffxi.get_mob_by_id(tgt_id)
                nm = mob and mob.name
            end
            if nm and enc.party_jobs[nm] then
                ff_log_party_death(enc.death_log, enc.dead_members, enc.start_os,
                                   nm, enc.zone_name, 'packet', { message = msg })
            else
                local actor_id = data:unpack('I', 0x04 + 1)
                local actor_name = actor_id and enc.id_to_name[actor_id]
                if actor_name and enc.party_jobs[actor_name] then
                    ff_log_entity_death(enc.kill_log, enc.dead_ids, enc.start_os, tgt_id, enc.zone_name, track_is_party, nm)
                end
            end
        end
        if msg and TRACK_BUFF_WEAR_MSG[msg] then
            local buff_id = data:unpack('I', 0x0C + 1)
            if tgt_id and tgt_id ~= 0 and not track_is_party_pet(tgt_id) then
                local mob = windower.ffxi.get_mob_by_id(tgt_id)
                if mob and mob.name and (track_is_party(mob.name) or ff_entity_is_mob(mob)) then
                    track_log_buff('wear', mob.name, tgt_id, buff_id, '0x029', nil)
                end
            end
        end
        -- Progression gains in Abyssea (0x029 Param 1 @ 0x0C). Same Param-1
        -- field the buff-id case reads, just under a different message id.
        if msg and FF_PROGRESSION_MSG[msg] then
            local val = data:unpack('I', 0x0C + 1)
            ff_log_progression_event(enc.progression_log,
                math.floor(os.difftime(os.time(), enc.start_os)),
                FF_PROGRESSION_MSG[msg], val, msg)
        end
        return
    end

    -- 0x02D Generic action message (XP/CP/LP/EP gains outside Abyssea).
    -- Param 1 @ 0x10, Message @ 0x18 per Windower's incoming[0x02D] field map.
    if id == 0x002D then
        local m = data:unpack('H', 0x18 + 1)
        if m and FF_PROGRESSION_MSG[m] then
            local val = data:unpack('I', 0x10 + 1)
            ff_log_progression_event(enc.progression_log,
                math.floor(os.difftime(os.time(), enc.start_os)),
                FF_PROGRESSION_MSG[m], val, m)
        end
        return
    end

    -- 0x061 Player char update: snapshot the local player's progression state
    -- (job/level/XP/EP/master level). First snapshot stamps progression_start;
    -- every subsequent one updates progression_end. The desktop diffs the two
    -- to derive "this encounter earned X XP" even when individual gain msgs
    -- were missed (addon loaded mid-fight, packet drop, etc.).
    if id == 0x0061 then
        local ok, p = pcall(packets.parse, 'incoming', data)
        if ok and p then
            local snap = ff_progression_snapshot(p)
            if snap then
                if not enc.progression_start then enc.progression_start = snap end
                enc.progression_end = snap
            end
        end
        return
    end

    -- (currency handler is above the enc gate now)

    -- 0x0D2 "Found Item": an item entered the treasure pool. Authoritative drop
    -- record - raw item id (no text/escape-code parsing), source mob from the
    -- dropper entity, and the pool Index for looter correlation via 0x0D3.
    -- Skips items flagged Old (already in the pool before we joined).
    if id == 0x00D2 then
        local old = (data:unpack('C', 0x15 + 1) or 0) ~= 0
        if old then return end
        local item_id = data:unpack('H', 0x10 + 1)
        if not item_id or item_id == 0 then return end   -- 0 = gil sentinel / empty; handled via text
        local dropper_id = data:unpack('I', 0x08 + 1)
        local count      = data:unpack('I', 0x0C + 1) or 1
        local pool_idx   = data:unpack('C', 0x14 + 1)
        local item = res.items and res.items[item_id]
        local dropper = (dropper_id and dropper_id ~= 0) and windower.ffxi.get_mob_by_id(dropper_id) or nil
        local entry = {
            name      = ff_loc_name(item, 'Item #' .. tostring(item_id)),
            itemId    = item_id,
            count     = (count and count > 1) and count or nil,
            source    = dropper and dropper.name or nil,
            elapsed   = math.floor(os.difftime(os.time(), enc.start_os)),
            type      = 'pool',
            poolIndex = pool_idx,
        }
        table.insert(enc.drop_log, entry)
        enc.recent_pool_names[entry.name] = entry.elapsed
        if ff_queue_icon then ff_queue_icon(item_id) end
        if pool_idx then enc.pool_drops[pool_idx] = entry end
        return
    end

    -- 0x0D3 "Item lot/drop": Drop==1 means the pooled item at Index was awarded -
    -- attribute the looter (highest lotter, else current) to the matching drop.
    if id == 0x00D3 then
        if (data:unpack('C', 0x15 + 1) or 0) ~= 1 then return end
        local pool_idx = data:unpack('C', 0x14 + 1)
        local entry = pool_idx and enc.pool_drops[pool_idx]
        if entry and not entry.by then
            -- Resolve the winner from the lotter entity id, NOT the packet's
            -- embedded char[16] name (that's the raw server name + padding bytes,
            -- which render as boxes and would bypass a name customizer). The
            -- entity gives the same clean display name used everywhere else.
            local lotter_id = data:unpack('I', 0x04 + 1)            -- Highest Lotter
            if not lotter_id or lotter_id == 0 then lotter_id = data:unpack('I', 0x08 + 1) end  -- Current Lotter
            local mob = (lotter_id and lotter_id ~= 0) and windower.ffxi.get_mob_by_id(lotter_id) or nil
            if mob and mob.name and mob.name ~= '' then entry.by = mob.name end
        end
        return
    end
end

windower.register_event('incoming chunk', ff_perf_event('incoming_chunk', function(id, data)
    _chunk_party_jobs(id, data)
    _chunk_misc(id, data)
end, function(id) return string.format('0x%X', id) end))


-- Treasure-pool drops + looter come from packets 0x0D2/0x0D3 above (robust,
-- language-independent). Text only covers loot that never enters the pool:
-- temporary items, and direct "Obtained:" grants. No chat output.
local function clean_item(s)
    return (s:gsub('\239', ''):gsub('^%s+', ''):gsub('%s+$', ''))
end
windower.register_event('incoming text', ff_perf_event('incoming_text', function(original)
    if not enc then return end
    local s = strip_escape_codes(original):gsub('[\r\n]', '')
    local elapsed = math.floor(os.difftime(os.time(), enc.start_os))

    -- Temporary item: "You obtain the temporary item: <name>!"
    -- Fallback path - the authoritative source is the 0x001F packet handler
    -- above, which carries the real item id (icon + accurate count). Suppress
    -- this text entry if the packet just logged the same name within 5s.
    local tmp = s:match("[Yy]ou obtain the temporary item: (.-)!")
    if tmp and tmp ~= '' then
        local name = clean_item(tmp)
        local last = enc.recent_temp_names and enc.recent_temp_names[name]
        if last and (elapsed - last) <= 5 then return end
        table.insert(enc.drop_log, { name = name, elapsed = elapsed, type = 'temporary', by = drop_owner_name() })
        return
    end

    -- Direct (non-pool) grant: "Obtained: <name>." FFXI also sends this line
    -- to the pool WINNER, so on the looter's box it duplicates the 0x0D2 entry
    -- we already recorded. Skip if 0x0D2 logged the same name within 10s.
    local direct = s:match("[Oo]btained: (.-)%.")
    if direct and direct ~= '' then
        local name = clean_item(direct):gsub('^[Aa]n? ', ''):gsub('^[Tt]he ', '')
        local last_pool = enc.recent_pool_names[name]
        if last_pool and (elapsed - last_pool) <= 10 then return end
        table.insert(enc.drop_log, { name = name, elapsed = elapsed, type = 'direct', by = drop_owner_name() })
        return
    end
end))

-- Auto-open a LIVE-ONLY encounter when we're in a recognized content zone
-- (Sortie/Odyssey/Limbus/Ambuscade), regardless of cfg.gate. The content
-- module (Gnosis.lua for Sortie) owns the SAVED data; tracker just runs
-- alongside to populate the per-mob engagement tables the desktop overlay's
-- Focus Mob filter and LIVE mob list need. Without this, Sortie users would
-- have to manually re-arm tracking from the desktop after every reset to see
-- anything in the overlay's mob picker.
-- Body for the local declared at the top of the file. Assigning into the
-- forward-declared local keeps the action / 0x000E handler closures wired
-- to the same upvalue.
ensure_content_enc = function()
    if enc then return end
    local zid = current_zone_id()
    local zname = zone_name_for(zid)
    local src = detect_source(zid, zname)
    -- Sortie is owned end-to-end by Gnosis.lua: it writes the saved report
    -- AND drives the shared live_state. Auto-arming tracker here would
    -- reset live_state mid-run AND spawn a redundant encounter_*.json
    -- alongside the Sortie report. So skip Sortie and only auto-arm in
    -- the other recognized content zones (Odyssey/Limbus/Ambuscade), where
    -- tracker owns the save flow now that those content modules are shelved.
    if src == 'sortie' then return end
    if src ~= 'generic' then
        open_encounter('content-auto')
    end
end

-- ── Boundary: zone changes ──────────────────────────────────────────────────
windower.register_event('zone change', function()
    save_job_cache(true)
    -- Server re-pushes inventory state on zone-in. Suppress temp-item logging
    -- for a few seconds so the existing-items burst isn't recorded as gains.
    _temp_log_armed_at = os.clock() + 3
    -- Content-zone lifecycle (runs regardless of cfg.gate): if leaving the
    -- content zone we'd been auto-tracking, close it; if entering a content
    -- zone we OWN, open a fresh encounter for the desktop overlay.
    -- Sortie is excluded - Gnosis.lua manages live_state + the saved report
    -- there end-to-end; tracker auto-arming would just stomp on it.
    do
        local zid = current_zone_id()
        local zname = zone_name_for(zid)
        local src = detect_source(zid, zname)
        local entering_owned_content = (src ~= 'generic' and src ~= 'sortie')
        if enc and enc.segmentation == 'content-auto' and (not zid or enc.zone_id ~= zid) then
            close_encounter()
        end
        if entering_owned_content and not enc then
            open_encounter('content-auto')
        end
    end
    if cfg.gate == 'off' then return end
    if cfg.boundary == 'zone' then
        close_encounter()
        open_encounter('zone')
        return
    elseif cfg.boundary == 'combat-idle' then
        close_encounter()  -- leaving the zone ends the current fight
        return
    end
    -- session intentionally spans zone changes (arm -> disarm). When that
    -- happens we re-point enc.zone_id / enc.zone_name to the NEW zone so
    -- subsequent log entries get the right area, AND we append to zone_log
    -- so the desktop history can surface every zone the session touched.
    if enc then
        local zid = current_zone_id()
        local zname = zone_name_for(zid)
        if zid and (enc.zone_id ~= zid) then
            enc.zone_id = zid
            enc.zone_name = zname
            local elapsed = math.floor(os.difftime(os.time(), enc.start_os))
            table.insert(enc.zone_log, { elapsed = elapsed, zoneId = zid, zoneName = zname or '' })
        end
    end
end)

-- Movement dedup: only log a position when it moved >= 1 unit since the last
-- logged sample for that key, so standing still doesn't accrue thousands of rows.
local function pos_moved(store, key, x, y, z)
    local p = store[key]
    if not p then store[key] = { x = x, y = y, z = z }; return true end
    local dx, dy, dz = x - p.x, y - p.y, z - p.z
    if dx * dx + dy * dy + dz * dz >= 1.0 then
        p.x, p.y, p.z = x, y, z
        return true
    end
    return false
end

local last_ipc = 0
local _tracker_tick_extra = function() end
windower.register_event('prerender', ff_perf_event('prerender', function()
    local c = os.clock()
    if c - last_ipc >= 1.0 then
        last_ipc = c
        if ff_ipc_ensure then ff_ipc_ensure() end
        if ff_ipc_send_self then ff_ipc_send_self() end
        _tracker_tick_extra(c)
        if ff_perf_tick then ff_perf_tick(c) end
    end
    -- Same gate principle as the action/HP handlers: if cfg.gate is off we
    -- still want per-mob HP polling to fill the overlay's LIVE list while
    -- in a content zone, where ensure_content_enc has auto-armed a
    -- live_only encounter.
    if not enc then return end
    -- Live-only encounters (recognized non-generic zones) are discarded on
    -- close - their only job is to drive the live overlay. Hold them open
    -- until zone change so the UI doesn't flap "Recording <-> waiting".
    if cfg.boundary == 'combat-idle' and not enc.live_only and (c - enc.last_combat_clock) >= cfg.idle_timeout then
        if enc.segmentation == 'content-auto' and not enc.had_combat then
            enc.last_combat_clock = c
        else
            close_encounter()
            return
        end
    end
    if (c - last_poll) >= 1.0 then
        last_poll = c
        ff_entity_class_pump()
        sync_party_jobs(enc.party_jobs)  -- pick up jobs that synced after open
        log_party_job_changes()          -- record any mid-encounter job swaps
        refresh_party_pet_ids()           -- catch any pet just (un)summoned
        save_job_cache()  -- persist newly-learned jobs promptly (no-op when clean)
        local elapsed = math.floor(os.difftime(os.time(), enc.start_os))
        -- Lightweight mode keeps death detection but drops the HP/TP/position
        -- timeline sampling (the bulk of per-run memory).
        local record_samples = not enc.live_only and not cfg.lightweight
        -- Position-only sub-gate: independent of `lightweight`, lets users keep
        -- HP/TP curves while dropping just the Map data. Hides the Map tab in
        -- reports automatically (position_log empty = no Map).
        local record_positions = record_samples and not cfg.disable_movement
        local my_zone = (windower.ffxi.get_info() or {}).zone
        local pt = windower.ffxi.get_party()
        if pt then
            for _, v in pairs(pt) do
                if type(v) == 'table' and v.name and v.name ~= '' then
                    local hpp = v.hpp
                    if v.hp and v.hp > 0 and hpp and hpp > 0 then
                        if hpp == 100 then
                            enc.party_max_hp[v.name] = v.hp
                        elseif not enc.party_max_hp[v.name] then
                            enc.party_max_hp[v.name] = math.floor(v.hp / hpp * 100 + 0.5)
                        end
                    end
                    local mpp = v.mpp
                    if v.mp and v.mp > 0 and mpp and mpp > 0 then
                        if mpp == 100 then
                            enc.party_max_mp[v.name] = v.mp
                        elseif not enc.party_max_mp[v.name] then
                            enc.party_max_mp[v.name] = math.floor(v.mp / mpp * 100 + 0.5)
                        end
                    end
                    local same_zone = (v.zone == nil) or (my_zone and v.zone == my_zone)
                    if hpp ~= nil and same_zone and enc.last_party_hpp[v.name] ~= hpp then
                        enc.last_party_hpp[v.name] = hpp
                        if record_samples then ff_log_party_hp_sample(enc.party_hp_log, elapsed, v.name, hpp, v.id) end
                        if hpp > 0 then enc.seen_alive[v.name] = true end
                        if hpp > 0 and enc.dead_members[v.name] then
                            enc.dead_members[v.name] = nil
                        end
                    end
                    if record_samples then
                        if v.tp ~= nil and enc.last_party_tp[v.name] ~= v.tp then
                            enc.last_party_tp[v.name] = v.tp
                            ff_log_party_tp_sample(enc.party_tp_log, elapsed, v.name, v.tp, v.id)
                        end
                        if v.mpp ~= nil and enc.last_party_mp[v.name] ~= v.mpp then
                            enc.last_party_mp[v.name] = v.mpp
                            ff_log_party_mp_sample(enc.party_mp_log, elapsed, v.name, v.mpp, v.id)
                        end
                        -- Buff diff: party member buff arrays come from get_party()
                        -- (path #4, the only source that sees pre-encounter buffs
                        -- on OTHER party members - 0x063 is local-only and 0x028
                        -- only fires for events applied DURING the encounter).
                        -- Mirrors the same diff Gnosis.lua runs for Sortie.
                        if same_zone and v.buffs then
                            local current = {}
                            for _, bid in ipairs(v.buffs) do
                                if bid and bid ~= 255 and bid ~= 0 then current[bid] = true end
                            end
                            local prev = enc.last_party_buffs[v.name] or {}
                            for bid in pairs(current) do
                                if not prev[bid] then
                                    ff_log_buff_event(enc.buff_log, enc.recent_buff_ev, enc.start_os, {
                                        kind = 'gain', target_name = v.name, target_id = v.id,
                                        buff_id = bid, source = 'party_poll',
                                    })
                                end
                            end
                            for bid in pairs(prev) do
                                if not current[bid] then
                                    ff_log_buff_event(enc.buff_log, enc.recent_buff_ev, enc.start_os, {
                                        kind = 'wear', target_name = v.name, target_id = v.id,
                                        buff_id = bid, source = 'party_poll',
                                    })
                                end
                            end
                            enc.last_party_buffs[v.name] = current
                        end
                        if record_positions then
                            local mob = v.mob
                            if mob and mob.x and mob.y and mob.z and pos_moved(enc.last_pos, v.name, mob.x, mob.y, mob.z) then
                                ff_log_party_position(enc.party_position_log, elapsed, v.name, mob.x, mob.y, mob.z, mob.heading)
                            end
                        end
                    end
                end
            end
        end
        if record_samples then
            local me = windower.ffxi.get_player()
            if record_positions and me and me.index then
                local sm = windower.ffxi.get_mob_by_index(me.index)
                if sm and sm.x and sm.y and sm.z and pos_moved(enc.last_pos, '@self', sm.x, sm.y, sm.z) then
                    ff_log_self_position(enc.position_log, elapsed, sm.x, sm.y, sm.z, sm.heading, enc.zone_name)
                end
            end
            local pet = windower.ffxi.get_mob_by_target and windower.ffxi.get_mob_by_target('pet')
            if me and me.name and pet then
                ff_log_pet_snapshot(enc.pet_log, enc.start_os, enc.last_pet_state, me.name, pet)
            end
            if enc.pet_ids then
                for pid, owner in pairs(enc.pet_ids) do
                    local pmob = windower.ffxi.get_mob_by_id(pid)
                    if pmob and pmob.name and pmob.name ~= '' then
                        ff_log_pet_snapshot(enc.pet_log, enc.start_os, enc.last_pet_state, owner, pmob)
                    end
                end
            end
        end
    end
end))

-- Don't lose an in-progress encounter on logout/unload.
windower.register_event('logout', function() close_encounter(); save_job_cache(true) end)
windower.register_event('unload', function() close_encounter(); save_job_cache(true) end)

local PREFS_PATH   = windower.addon_path .. 'data/tracker_prefs.json'
local last_status_key = nil
local last_status_write = 0
local last_live_recording = false

local function read_json_file(path)
    local f = io.open(path, 'r')
    if not f then return nil end
    local txt = f:read('*a'); f:close()
    if not txt or txt == '' then return nil end
    local ok, t = pcall(json.decode, txt)
    return ok and t or nil
end

local function count_keys(t)
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n
end

local function write_tracker_prefs()
    local f = io.open(PREFS_PATH, 'w')
    if f then
        f:write(json.encode({ mode = cfg.mode, idleTimeout = cfg.idle_timeout, lightweight = cfg.lightweight, disableMovement = cfg.disable_movement, trackOutsiders = cfg.track_outsiders, trackCurrency = cfg.track_currency }))
        f:close()
    end
end

local function apply_control_cmd(cmd)
    if type(cmd) ~= 'table' then return end
    if cmd.action == 'save' then close_encounter(); return end
    if type(cmd.idleTimeout) == 'number' then ff_tracker_set_timeout(cmd.idleTimeout) end
    if type(cmd.lightweight) == 'boolean' then cfg.lightweight = cmd.lightweight; write_tracker_prefs() end
    if type(cmd.disableMovement) == 'boolean' then cfg.disable_movement = cmd.disableMovement; write_tracker_prefs() end
    if type(cmd.trackOutsiders) == 'boolean' then cfg.track_outsiders = cmd.trackOutsiders; write_tracker_prefs() end
    if type(cmd.trackCurrency) == 'boolean' then cfg.track_currency = cmd.trackCurrency; write_tracker_prefs() end
    if cmd.mode then ff_tracker_set_mode(cmd.mode) end
end

local function push_tracker_status(c)
    local live = ff_live_state_get()
    local recording = (enc ~= nil) or (live ~= nil)
    local zid = current_zone_id()
    local zone = (enc and enc.zone_name) or (live and live.zone_name) or zone_name_for(zid)
    local source = (enc and enc.source) or (live and live.source) or detect_source(zid, zone)
    local key = string.format('%s|%s|%s|%s|%d', cfg.mode, tostring(recording), tostring(zone), tostring(source), cfg.idle_timeout)
    if key == last_status_key then
        if recording and (c - last_status_write) < 2 then return end
        if not recording and (c - last_status_write) < 15 then return end
    end
    last_status_key, last_status_write = key, c
    local start_os = (enc and enc.start_os) or (live and live.start_os)
    local engaged = 0
    if live then for _ in pairs(live.enemy_ids) do engaged = engaged + 1 end end
    if ff_ipc_send_status then
        ff_ipc_send_status({
            mode        = cfg.mode,
            idleTimeout = cfg.idle_timeout,
            recording   = recording,
            zone        = zone or json.null,
            source      = (source and source ~= 'generic') and source or json.null,
            elapsed     = (recording and start_os) and math.floor(os.difftime(os.time(), start_os)) or 0,
            enemies     = engaged,
            updatedAt   = os.time(),
        })
    end
end

local function push_tracker_live()
    if not ff_live_state_is_open() then
        if last_live_recording then
            last_live_recording = false
            if ff_ipc_send_live then ff_ipc_send_live({ recording = false }) end
        end
        return
    end
    last_live_recording = true
    if ff_ipc_send_live then ff_ipc_send_live(ff_live_state_emit()) end
end

_tracker_tick_extra = function(c)
    if ff_ipc_drain_inbound then ff_ipc_drain_inbound(apply_control_cmd) end
    push_tracker_status(c)
    push_tracker_live()
end

function ff_tracker_set_mode(mode)
    local preset = MODE_PRESETS[mode]
    if not preset then
        gn_chat_err('Unknown track mode: ' .. tostring(mode))
        return
    end
    close_encounter()  -- switching modes closes whatever was open
    cfg.mode, cfg.gate, cfg.boundary = mode, preset.gate, preset.boundary
    write_tracker_prefs()
    if mode == 'off' then
        gn_chat('Tracking OFF.')
    elseif mode == 'session' then
        open_encounter('session')
        gn_chat('Tracking: Full Session (recording now).')
    elseif mode == 'zone' then
        open_encounter('zone')
        gn_chat('Tracking: By Zone (one encounter per zone).')
    elseif mode == 'fight' then
        gn_chat('Tracking: By Encounter (opens on combat, closes after idle).')
    end
end

function ff_tracker_set_timeout(sec)
    sec = tonumber(sec)
    if not sec or sec < 1 then
        gn_chat_err(('track timeout: provide seconds >= 1 (current: %ds).'):format(cfg.idle_timeout))
        return
    end
    cfg.idle_timeout = math.floor(sec)
    write_tracker_prefs()
    gn_chat(('Encounter inactivity timeout: %ds.'):format(cfg.idle_timeout))
end

-- Shared with Sortie tracking in Gnosis.lua so it can skip its own position
-- sampling when the desktop has movement tracking disabled.
function ff_movement_disabled()
    return cfg.disable_movement == true
end

do
    local prefs = read_json_file(PREFS_PATH)
    if type(prefs) == 'table' then
        if type(prefs.lightweight) == 'boolean' then cfg.lightweight = prefs.lightweight end
        if type(prefs.disableMovement) == 'boolean' then cfg.disable_movement = prefs.disableMovement end
        if type(prefs.trackOutsiders) == 'boolean' then cfg.track_outsiders = prefs.trackOutsiders end
        if type(prefs.trackCurrency) == 'boolean' then cfg.track_currency = prefs.trackCurrency end
        if type(prefs.idleTimeout) == 'number' and prefs.idleTimeout >= 1 then
            cfg.idle_timeout = math.floor(prefs.idleTimeout)
        end
        if type(prefs.mode) == 'string' and MODE_PRESETS[prefs.mode] and prefs.mode ~= 'off' then
            ff_tracker_set_mode(prefs.mode)
        end
    end
    ensure_content_enc()
end

windower.register_event('action', ff_perf_event('action', function(act)
    for i = 1, #ff_action_handlers do ff_action_handlers[i](act) end
end, function(act)
    if not act then return 'nil' end
    return string.format('cat=%s param=%s actor=%s', tostring(act.category), tostring(act.param), tostring(act.actor_id))
end))

windower.register_event('outgoing chunk', ff_perf_event('outgoing_chunk', function(id, data, modified, injected, blocked)
    for i = 1, #ff_outgoing_chunk_handlers do ff_outgoing_chunk_handlers[i](id, data, modified, injected, blocked) end
end, function(id) return string.format('0x%X', id) end))
