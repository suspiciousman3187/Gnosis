FF_CLASS_PC      = 'pc'
FF_CLASS_TRUST   = 'trust'
FF_CLASS_PET     = 'pet'
FF_CLASS_MOB     = 'mob'
FF_CLASS_NPC     = 'npc'
FF_CLASS_UNKNOWN = 'unknown'

local SPAWN_TYPE_PC  = 1
local SPAWN_TYPE_MOB = 16
local SPAWN_TYPE_PET = 18

local CLASS = {}
local LISTENERS = {}
local PENDING_JOB = {}

local function _classify_from_mob(mob)
    if type(mob) ~= 'table' then return FF_CLASS_UNKNOWN end
    local st = mob.spawn_type
    local is_npc = mob.is_npc
    if st == SPAWN_TYPE_MOB then return FF_CLASS_MOB end
    if st == SPAWN_TYPE_PET then return FF_CLASS_PET end
    if is_npc == false then return FF_CLASS_PC end
    if is_npc == true and st == SPAWN_TYPE_PC then return FF_CLASS_TRUST end
    if is_npc == true then return FF_CLASS_NPC end
    return FF_CLASS_UNKNOWN
end

local function _emit_resolved(pid, prev_class, new_class)
    for _, fn in ipairs(LISTENERS) do
        local ok = pcall(fn, pid, new_class, prev_class)
        if not ok then end
    end
end

function ff_entity_class_get_cached(pid)
    if not pid or pid == 0 then return FF_CLASS_UNKNOWN end
    return CLASS[pid] or FF_CLASS_UNKNOWN
end

function ff_entity_classify(pid)
    if not pid or pid == 0 then return FF_CLASS_UNKNOWN end
    local cached = CLASS[pid]
    if cached and cached ~= FF_CLASS_UNKNOWN then return cached end
    local mob = windower.ffxi.get_mob_by_id(pid)
    local result = _classify_from_mob(mob)
    if result ~= FF_CLASS_UNKNOWN then
        if CLASS[pid] ~= result then
            local prev = CLASS[pid]
            CLASS[pid] = result
            _emit_resolved(pid, prev, result)
        end
        return result
    end
    return cached or FF_CLASS_UNKNOWN
end

function ff_entity_class_observe(pid, mob)
    if not pid or pid == 0 then return FF_CLASS_UNKNOWN end
    local cached = CLASS[pid]
    if cached and cached ~= FF_CLASS_UNKNOWN then return cached end
    local result = _classify_from_mob(mob)
    if result ~= FF_CLASS_UNKNOWN then
        local prev = CLASS[pid]
        CLASS[pid] = result
        _emit_resolved(pid, prev, result)
        return result
    end
    return cached or FF_CLASS_UNKNOWN
end

function ff_entity_class_mark_pending(pid)
    if not pid or pid == 0 then return end
    if CLASS[pid] == nil then CLASS[pid] = FF_CLASS_UNKNOWN end
end

function ff_entity_class_subscribe(fn)
    if type(fn) == 'function' then table.insert(LISTENERS, fn) end
end

function ff_entity_class_pump()
    for pid, cls in pairs(CLASS) do
        if cls == FF_CLASS_UNKNOWN then
            local mob = windower.ffxi.get_mob_by_id(pid)
            local result = _classify_from_mob(mob)
            if result ~= FF_CLASS_UNKNOWN then
                CLASS[pid] = result
                _emit_resolved(pid, FF_CLASS_UNKNOWN, result)
            end
        end
    end
end

function ff_entity_class_set_pending_job(pid, job_record)
    if not pid or pid == 0 or type(job_record) ~= 'table' then return end
    PENDING_JOB[pid] = job_record
end

function ff_entity_class_take_pending_job(pid)
    if not pid then return nil end
    local rec = PENDING_JOB[pid]
    PENDING_JOB[pid] = nil
    return rec
end

function ff_entity_class_clear_pending_job(pid)
    if not pid then return end
    PENDING_JOB[pid] = nil
end

function ff_entity_class_is_pc(pid)    return ff_entity_classify(pid) == FF_CLASS_PC    end
function ff_entity_class_is_trust(pid) return ff_entity_classify(pid) == FF_CLASS_TRUST end
function ff_entity_class_is_mob(pid)   return ff_entity_classify(pid) == FF_CLASS_MOB   end
function ff_entity_class_is_pet(pid)   return ff_entity_classify(pid) == FF_CLASS_PET   end

function ff_entity_class_count()
    local total, by = 0, { pc=0, trust=0, mob=0, pet=0, npc=0, unknown=0 }
    for _, cls in pairs(CLASS) do
        total = total + 1
        by[cls] = (by[cls] or 0) + 1
    end
    return total, by
end
